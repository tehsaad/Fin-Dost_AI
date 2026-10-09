import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * LOCAL DEVELOPMENT ONLY. Mints an HS256 token the backend accepts when it has the
 * same DEV_AUTH_SECRET. Disabled unless NEXT_PUBLIC_AUTH_MODE=dev and the secret is set;
 * production deployments use Supabase Auth instead.
 */
function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function POST(request: Request) {
  const secret = process.env.DEV_AUTH_SECRET;
  if (process.env.NEXT_PUBLIC_AUTH_MODE !== "dev" || !secret || process.env.VERCEL) {
    return NextResponse.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { email?: string; kind?: string; name?: string };
  const email = String(body.email || "dev@findost.local").slice(0, 120).toLowerCase();
  const sub = `dev-${createHmac("sha256", "uid").update(email).digest("hex").slice(0, 24)}`;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    sub, email, aud: "authenticated", role: "authenticated", iat: now, exp: now + 8 * 3600,
    user_metadata: { account_type: body.kind, full_name: body.name },
  }));
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return NextResponse.json({ access_token: `${header}.${payload}.${sig}` });
}
