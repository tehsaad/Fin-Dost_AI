# Security

## Authentication

| Path | Control |
|---|---|
| Email + password sign-up / sign-in | Supabase Auth, Cloudflare Turnstile captcha verified by Supabase, minimum 8 characters, **email confirmation required** (sent via Resend from `no-reply@tehsaad.site`) |
| Password reset | Captcha-protected request; generic "if an account exists" response; 1-hour single-use token-hash link |
| Google | Supabase OAuth provider (button hidden until a Google OAuth client is configured) |
| Private demo | Supabase anonymous sign-in, captcha-protected, rate-limited by Supabase (30/hour/IP) |
| Backend | Every protected route depends on `get_current_user`: bearer JWT, `aud=authenticated`, `sub` and `exp` required, ES256 via JWKS; expired/malformed/`alg=none`/wrong audience/role → 401 (tested) |
| Developer tokens | `DEV_AUTH_SECRET` is ignored when `ENVIRONMENT=production` (tested); the Next `/api/dev-token` route is disabled on Vercel and unless `NEXT_PUBLIC_AUTH_MODE=dev` |
| Sessions | Cookie session refreshed by middleware; a 401 from the API redirects to sign-in; Sign out clears the Supabase session |

## Authorization and isolation

* One workspace per user (`businesses.owner_id` unique). Every query filters by the caller's `business_id`;
  `owned()` returns **404** (not 403) for other users' records, so IDs cannot be probed.
* Tested with separate users on 14 read/write/payment/import/scenario/alert routes, exports, forecasts and the
  audit log (`test_ledger.py`, `test_workflow.py`, `test_demo_security.py`).
* Account type and module access come from the database row, never from the client.
* Postgres RLS is enabled on all tables with **no policies**, so the public anon key cannot read or write data
  through Supabase's REST API; only the backend's server-side connection can.

## Shared-demo risk (fixed)

The four shared demo logins were replaced by per-visitor private demo workspaces. A reset or edit in one demo
cannot affect any other visitor or real user (tested). Private demos have a 3,000-transaction cap, 10 AI calls per
day, no receipt reading, and are deleted after 7 days by `/api/v1/internal/cleanup-demos` (Vercel Cron,
`CRON_SECRET` compared in constant time; refuses to run without the secret; only rows with `is_anonymous = true`
are deleted — tested). The old shared accounts are retired by setting them random passwords during rollout.

## Input and output handling

* Pydantic validation with `extra="forbid"`; amounts are integers within ±Rs. 100 billion; dates validated.
* Uploads: CSV ≤ 2 MB (`.csv` only); receipts ≤ 4 MB, JPG/PNG/WEBP/PDF with magic-byte check.
* CSV exports neutralise spreadsheet formulas (`= + - @` prefixes).
* Unhandled errors return `{"error":{"code":"internal_error","details":{"request_id"}}}`; logs record the
  exception type and code locations only — never messages, SQL parameters or financial values.

## AI

Consent per workspace; names masked before any text leaves the server; Groq/Gemini keys only in backend
environment variables (Gemini key sent as a header, not in URLs); model output validated against a schema;
explanations rejected if they contain numbers not in the evidence; uploaded documents treated as untrusted
(instructions inside them ignored); per-workspace daily quota stored in the database.

## Secrets

Server-only: `DATABASE_URL`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `CRON_SECRET`, Supabase service key (not used by the
app), Turnstile secret and `RESEND_API_KEY` (stored in Supabase Auth settings, not in the app). Public by design:
Supabase anon key, Turnstile site key. `.env*` files are git-ignored; examples contain placeholders only.

## Remaining risks

* PostCSS advisory inside Next 15 build tooling (build-time only; fix requires Next 16).
* No application-level per-IP rate limit beyond Supabase Auth limits, Turnstile and the AI quota.
* Row locks for concurrent payments are not load-tested on Postgres.
* Supabase anonymous auth users are not deleted by the cleanup job (their workspaces are); they hold no data.
