"""Create (or reset) the four shared demo logins in Supabase and seed their workspaces.

Needs DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Safe to re-run: existing users are
reused and their demo data is re-seeded.

    python scripts/seed_demo_accounts.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import today as get_today  # noqa: E402
from app.db import get_sessionmaker  # noqa: E402
from app.models import Business  # noqa: E402
from app.services.seed import DEMO_PROFILES, seed_demo  # noqa: E402

DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "FinDost-Demo-2026")
KINDS = ("sme", "enterprise", "household", "student")


def admin_client() -> httpx.Client:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return httpx.Client(base_url=f"{url}/auth/v1/admin", timeout=30,
                        headers={"apikey": key, "Authorization": f"Bearer {key}"})


def ensure_user(client: httpx.Client, email: str, kind: str) -> str:
    metadata = {"account_type": kind, "business_name": DEMO_PROFILES[kind]["name"], "full_name": "Demo user"}
    res = client.post("/users", json={"email": email, "password": DEMO_PASSWORD, "email_confirm": True,
                                      "user_metadata": metadata})
    if res.status_code < 300:
        return res.json()["id"]
    page = 1
    while True:
        users = client.get("/users", params={"page": page, "per_page": 200}).raise_for_status().json()["users"]
        for u in users:
            if u.get("email") == email:
                client.put(f"/users/{u['id']}", json={"password": DEMO_PASSWORD, "user_metadata": metadata}).raise_for_status()
                return u["id"]
        if len(users) < 200:
            raise RuntimeError(f"Could not create or find {email}: {res.status_code} {res.text[:200]}")
        page += 1


def main() -> None:
    today = get_today()
    with admin_client() as client:
        ids = {kind: ensure_user(client, f"{kind}@demo.findost.app", kind) for kind in KINDS}
    db = get_sessionmaker()()
    try:
        for kind, user_id in ids.items():
            business = db.scalar(select(Business).where(Business.owner_id == user_id))
            if business is None:
                business = Business(owner_id=user_id, name=DEMO_PROFILES[kind]["name"], kind=kind,
                                    city=DEMO_PROFILES[kind]["city"], opening_date=today, language="en")
                db.add(business)
                db.flush()
            seed_demo(db, business, today)
            business.name = DEMO_PROFILES[kind]["name"]
            db.commit()
            print(f"{kind}: {kind}@demo.findost.app -> business {business.id}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
