"""Enterprise team: members, roles and email invitations for one shared workspace.

Security model
* The workspace creator (`businesses.owner_id`) is the permanent owner; they cannot be removed or demoted, so a
  workspace always keeps an owner. Other owners/editors/viewers live in `workspace_members`.
* Invitations hold only a SHA-256 hash of a 32-byte random token, expire after 7 days, are single-use, and can be
  accepted only by a signed-in (non-anonymous) user whose verified email matches the invited address.
* Email is sent through Resend when RESEND_API_KEY is configured; otherwise the API says so (email_sent=false) and
  returns the link so the owner can share it themselves.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import FEATURES, Access, CurrentUser, get_access, get_current_user
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError
from ..models import Business, WorkspaceInvitation, WorkspaceMember
from ..schemas import AcceptInviteIn, InviteIn, RoleIn
from ..services import audit

router = APIRouter(tags=["team"])
log = logging.getLogger("findost.team")
INVITE_TTL = timedelta(days=7)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _team_access(access: Access = Depends(get_access)) -> Access:
    if "team" not in FEATURES.get(access.business.kind, frozenset()):
        raise ApiError(403, "feature_unavailable", f"'team' is not part of the {access.business.kind} account type")
    return access


def _admin(access: Access = Depends(_team_access)) -> Access:
    if not access.can("admin"):
        raise ApiError(403, "forbidden", "Only workspace owners can manage the team")
    return access


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


@router.get("/team")
def team(access: Access = Depends(_team_access), db: Session = Depends(get_db)):
    b = access.business
    members = [{"user_id": b.owner_id, "email": None, "role": "owner", "status": "active", "is_creator": True}]
    for m in db.scalars(select(WorkspaceMember).where(WorkspaceMember.business_id == b.id, WorkspaceMember.status == "active")
                        .order_by(WorkspaceMember.created_at)):
        members.append({"user_id": m.user_id, "email": m.email, "role": m.role, "status": m.status, "is_creator": False})
    invites = []
    if access.can("admin"):
        now = datetime.now(timezone.utc)
        for i in db.scalars(select(WorkspaceInvitation).where(WorkspaceInvitation.business_id == b.id)
                            .order_by(WorkspaceInvitation.created_at.desc()).limit(50)):
            status = "expired" if i.status == "pending" and _aware(i.expires_at) < now else i.status
            invites.append({"id": i.id, "email": i.email, "role": i.role, "status": status, "email_sent": i.email_sent,
                            "expires_at": _aware(i.expires_at).isoformat()})
    for m in members:
        m["is_you"] = m["user_id"] == access.user.id
    return {"members": members, "invitations": invites, "your_role": access.role, "can_manage": access.can("admin"),
            "email_delivery": bool(get_settings().resend_api_key)}


def _send_invite(email: str, workspace: str, role: str, link: str) -> bool:
    s = get_settings()
    if not s.resend_api_key:
        return False
    html = (f"<p>You have been invited to join <strong>{workspace}</strong> on FinDost AI as <strong>{role}</strong>.</p>"
            f"<p><a href=\"{link}\">Accept the invitation</a> (expires in 7 days). Sign in or create an account with "
            f"this email address ({email}) first.</p><p>If you did not expect this, ignore this email.</p>")
    try:
        r = httpx.post("https://api.resend.com/emails", timeout=10,
                       headers={"Authorization": f"Bearer {s.resend_api_key}"},
                       json={"from": s.email_from, "to": [email], "subject": f"Join {workspace} on FinDost AI", "html": html})
    except httpx.HTTPError as exc:
        log.warning("invite email failed: %s", type(exc).__name__)
        return False
    if r.status_code >= 300:
        log.warning("invite email failed: HTTP %s", r.status_code)
        return False
    return True


@router.post("/team/invitations", status_code=201)
def invite(body: InviteIn, access: Access = Depends(_admin), db: Session = Depends(get_db)):
    b = access.business
    email = body.email.strip().lower()
    if access.user.email and email == access.user.email.lower():
        raise ApiError(422, "validation_error", "You are already in this workspace")
    existing = db.scalar(select(WorkspaceMember).where(WorkspaceMember.business_id == b.id, WorkspaceMember.email == email,
                                                       WorkspaceMember.status == "active"))
    if existing:
        raise ApiError(409, "already_member", "This person is already a member")
    # one live invitation per email: revoke older pending ones
    for old in db.scalars(select(WorkspaceInvitation).where(WorkspaceInvitation.business_id == b.id,
                                                            WorkspaceInvitation.email == email,
                                                            WorkspaceInvitation.status == "pending")):
        old.status = "revoked"
    token = secrets.token_urlsafe(32)
    inv = WorkspaceInvitation(business_id=b.id, email=email, role=body.role, token_hash=_hash(token),
                              expires_at=datetime.now(timezone.utc) + INVITE_TTL, invited_by=access.user.id)
    db.add(inv)
    db.flush()
    link = f"{get_settings().app_url}/invite?token={token}"
    inv.email_sent = _send_invite(email, b.name, body.role, link)
    audit.record(db, b, "invitation", inv.id, "create", after={"email": email, "role": body.role,
                                                                "email_sent": inv.email_sent})
    db.commit()
    return {"id": inv.id, "email": email, "role": inv.role, "status": "pending", "email_sent": inv.email_sent,
            "expires_at": _aware(inv.expires_at).isoformat(),
            # Shown only to the inviting owner, so they can share it if email is not configured or fails.
            "invite_link": link,
            "message": "Invitation email sent." if inv.email_sent else
                       "Email delivery is not configured or failed, so no email was sent. Share the link yourself."}


@router.delete("/team/invitations/{invite_id}", status_code=204)
def revoke_invite(invite_id: str, access: Access = Depends(_admin), db: Session = Depends(get_db)):
    inv = db.get(WorkspaceInvitation, invite_id)
    if inv is None or inv.business_id != access.business.id:
        raise ApiError(404, "not_found", "Invitation not found")
    if inv.status == "pending":
        inv.status = "revoked"
        audit.record(db, access.business, "invitation", inv.id, "revoke", extra={"email": inv.email})
        db.commit()


def _member(db: Session, business: Business, user_id: str) -> WorkspaceMember:
    m = db.scalar(select(WorkspaceMember).where(WorkspaceMember.business_id == business.id,
                                                WorkspaceMember.user_id == user_id, WorkspaceMember.status == "active"))
    if m is None:
        raise ApiError(404, "not_found", "Member not found")
    return m


@router.put("/team/members/{user_id}")
def change_role(user_id: str, body: RoleIn, access: Access = Depends(_admin), db: Session = Depends(get_db)):
    if user_id == access.business.owner_id:
        raise ApiError(409, "owner_protected", "The workspace creator is always an owner")
    m = _member(db, access.business, user_id)
    before = m.role
    m.role = body.role
    audit.record(db, access.business, "member", m.id, "update", before={"role": before}, after={"role": m.role})
    db.commit()
    return {"user_id": m.user_id, "role": m.role}


@router.delete("/team/members/{user_id}", status_code=204)
def remove_member(user_id: str, access: Access = Depends(_team_access), db: Session = Depends(get_db)):
    if user_id == access.business.owner_id:
        raise ApiError(409, "owner_protected", "The workspace creator cannot be removed")
    leaving_self = user_id == access.user.id
    if not leaving_self and not access.can("admin"):
        raise ApiError(403, "forbidden", "Only workspace owners can remove members")
    m = _member(db, access.business, user_id)
    m.status = "removed"
    audit.record(db, access.business, "member", m.id, "remove", extra={"email": m.email, "self": leaving_self})
    db.commit()


def _pending_invite(db: Session, token: str) -> WorkspaceInvitation:
    inv = db.scalar(select(WorkspaceInvitation).where(WorkspaceInvitation.token_hash == _hash(token)))
    if inv is None or inv.status != "pending":
        raise ApiError(404, "invitation_invalid", "This invitation is invalid or was already used or revoked")
    if _aware(inv.expires_at) < datetime.now(timezone.utc):
        raise ApiError(410, "invitation_expired", "This invitation has expired; ask for a new one")
    return inv


def _check_recipient(user: CurrentUser, inv: WorkspaceInvitation) -> None:
    if user.is_anonymous or not user.email:
        raise ApiError(403, "account_required", "Sign in with a verified account to accept invitations")
    if user.email.strip().lower() != inv.email:
        raise ApiError(403, "wrong_recipient", "This invitation was sent to a different email address")


@router.get("/invitations/{token}")
def preview_invite(token: str, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    inv = _pending_invite(db, token)
    business = db.get(Business, inv.business_id)
    return {"workspace": business.name if business else None, "role": inv.role,
            "expires_at": _aware(inv.expires_at).isoformat(),
            "email_matches": bool(user.email) and not user.is_anonymous and user.email.lower() == inv.email}


@router.post("/invitations/accept")
def accept_invite(body: AcceptInviteIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    inv = _pending_invite(db, body.token)
    _check_recipient(user, inv)
    business = db.get(Business, inv.business_id)
    if business is None:
        raise ApiError(404, "invitation_invalid", "This workspace no longer exists")
    if business.owner_id == user.id:
        raise ApiError(409, "already_member", "You own this workspace")
    m = db.scalar(select(WorkspaceMember).where(WorkspaceMember.business_id == business.id, WorkspaceMember.user_id == user.id))
    if m is None:
        m = WorkspaceMember(business_id=business.id, user_id=user.id, email=inv.email, role=inv.role,
                            invited_by=inv.invited_by)
        db.add(m)
    else:  # rejoining after removal
        m.status, m.role, m.email = "active", inv.role, inv.email
    inv.status, inv.accepted_by, inv.accepted_at = "accepted", user.id, datetime.now(timezone.utc)
    db.flush()
    from ..auth import current_actor
    current_actor.set(user.id)
    audit.record(db, business, "member", m.id, "join", extra={"email": inv.email, "role": inv.role, "invitation": inv.id})
    db.commit()
    return {"workspace_id": business.id, "workspace": business.name, "role": m.role}
