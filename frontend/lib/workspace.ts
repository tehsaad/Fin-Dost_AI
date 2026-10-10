/**
 * Which workspace the user chose, bound to the current sign-in session.
 *
 * Identity (who is signed in) and the active workspace are separate. A user may own one workspace and be a member
 * of others, so the app asks which one to open at the start of every sign-in session. The choice is stored with the
 * session it was made in: after signing out and in again (or when another person signs in on this browser) it no
 * longer matches and the user is asked again. The server checks membership on every request regardless — this
 * value is only a preference sent as the X-Workspace-Id header.
 */

export const SELECTION_KEY = "findost_workspace_selection";
const LEGACY_KEY = "findost_workspace"; // pre-selection-screen versions stored a bare id with no session

interface Selection { session: string; id: string }

function decodeSegment(segment: string): string {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** A stable key for one sign-in session: Supabase's session_id claim, or the subject + issue time of a dev token. */
export function sessionKeyFromToken(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const claims = JSON.parse(decodeSegment(token.split(".")[1] ?? "")) as { session_id?: string; sub?: string; iat?: number };
    if (claims.session_id) return `${claims.sub ?? ""}:${claims.session_id}`;
    if (claims.sub && claims.iat) return `${claims.sub}:${claims.iat}`;
    return null;
  } catch {
    return null;
  }
}

export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The workspace chosen in this session, or null if the user has not chosen one since signing in. */
export function readSelection(storage: Storage | null, session: string | null): string | null {
  if (!storage || !session) return null;
  try {
    storage.removeItem(LEGACY_KEY);
    const raw = storage.getItem(SELECTION_KEY);
    if (!raw) return null;
    const sel = JSON.parse(raw) as Partial<Selection>;
    return sel.session === session && typeof sel.id === "string" && sel.id ? sel.id : null;
  } catch {
    return null;
  }
}

export function writeSelection(storage: Storage | null, session: string | null, id: string): boolean {
  if (!storage || !session || !id) return false;
  try {
    storage.setItem(SELECTION_KEY, JSON.stringify({ session, id } satisfies Selection));
    return true;
  } catch {
    return false;
  }
}

export function clearSelection(storage: Storage | null) {
  try {
    storage?.removeItem(SELECTION_KEY);
    storage?.removeItem(LEGACY_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Only same-site paths are allowed as a destination after choosing a workspace. */
export function safeAppPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/workspaces")) return fallback;
  return next;
}
