# FinDost AI — Baseline Audit (pass 2)

Date: 2026-10-10 · Baseline commit: `05ac45a` (deployed to production earlier the same day) ·
Earlier pass: [TECHNICAL_AUDIT.md](TECHNICAL_AUDIT.md) (defects D1–D15, all fixed).

## 1. Architecture (verified)

See [ARCHITECTURE.md](ARCHITECTURE.md). Next.js 15.5.27 frontend (Vercel `findost-ai`, https://findostai.vercel.app)
proxies `/api/v1/*` to FastAPI (Vercel `findost-api`, https://findost-api.vercel.app); Supabase Postgres (RLS on,
no policies) and Supabase Auth (email/password + Cloudflare Turnstile, Google provider not yet configured).

## 2. Baseline checks (run before any change)

| Check | Result |
|---|---|
| Backend `pytest` | 80 passed |
| Frontend `tsc`, `eslint`, `vitest` | pass, 0 lint findings, 4 passed |
| Production build | pass |
| Live `/api/v1/health` | `{"status":"ok","environment":"production","ai":{"groq":true,"gemini":true}}` |
| Live pages `/`, `/login`, `/signup` | 200; `/dashboard` → 307 to `/login` when signed out |
| Auth edge cases (script against the API) | expired → 401 `token_expired`; malformed, wrong audience, missing `sub`, `alg=none` → 401 `invalid_token`; non-`authenticated` role → 401 |

## 3. Defects and risks

| ID | Pri | Finding | Evidence / reproduction |
|---|---|---|---|
| B1 | **P0** | Shared demo logins: four public email/password accounts; any visitor could edit or **reset** data every other visitor sees. | README listed the password; `/business/reset-demo` is allowed for any owner. |
| B2 | **P0** | `DEV_AUTH_SECRET` would be accepted as a token-signing key if ever set in production. | `auth._decode` used it whenever present (env currently unset — verified via `vercel env ls`). |
| B3 | P1 | Copilot: "Which payments are overdue?" not understood. | Probe: intent `unknown`. |
| B4 | P1 | Copilot: "What is my biggest **upcoming** expense?" answered with **past** 30-day spending. | Probe: intent `spending`, answer about last 30 days. |
| B5 | P1 | Copilot: Roman Urdu what-if "Agar sales 20% kam ho jayein…" not understood. | Probe: intent `unknown`. |
| B6 | P1 | Copilot: questions about a named customer/supplier not understood. | "How much has Al-Madina Caterers paid so far?" → `unknown`. |
| B7 | P1 | Forecast band labelled "≈80%" but realised day-14 balance fell inside it for only **43.3%** of benchmark businesses (31.4% with open invoices, 73.5% without). | New coverage metric in the benchmark. |
| B8 | P1 | No email verification (confirmations were off), no resend, no password reset. | `supabase/config.toml`; no reset page. |
| B9 | P1 | SEO: no canonical URLs, Open Graph/Twitter cards, robots.txt, sitemap, structured data, manifest; app pages indexable. | Page source; `/robots.txt` 404. |
| B10 | P2 | Text contrast below WCAG AA on the logo "AI" and primary CTA (`#059669` on white, 3.8:1). | Lighthouse accessibility audit. |
| B11 | P2 | Frontend tests did not cover API failure handling (risk of success shown on failure). | Only formatting tests existed. |
| B12 | P3 | Local builds fail to download Google Fonts on this machine (Node happy-eyeballs timeout). | `ETIMEDOUT`; fixed locally with `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=2000`; Vercel unaffected. |

Measured, no change needed: API requests use 1–25 SQL queries, 4–150 ms server time and < 30 KB payloads
(in-process SQLite measurement, see [TESTING.md](TESTING.md)); transaction listing is paginated (≤ 200).

## 4. Checks that could not run

| Check | Why |
|---|---|
| Signed-in browser test on the live site | Turnstile blocks automated browsers (by design); minting sessions with the service key was refused by the session's safety policy |
| Live Groq / Gemini calls | Keys are write-only Vercel secrets; verified by the owner via Settings → Test AI connection |
| Postgres row-lock behaviour under concurrency | No load-test environment |

## 5. Plan (executed — see IMPLEMENTATION_REPORT.md)

P0 B1–B2 → P1 B3–B9 → P2 B10–B11 → docs → production rollout with owner approval.
