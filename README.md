# FinDost AI

Cash-flow early warning and recovery planning for Pakistani shops (SMEs), enterprises, households and students.
FinDost turns a digital khata (ledger + udhaar) into a 30-day cash forecast, flags trouble before it happens,
stress-tests shocks, and ranks concrete recovery actions — in English and Urdu.

**Live:** https://findostai.vercel.app  ·  API: https://findost-api.vercel.app/api/v1/health

Demo logins (fictional data, password `FinDost-Demo-2026`): `sme@demo.findost.app`, `enterprise@demo.findost.app`,
`household@demo.findost.app`, `student@demo.findost.app`. The login page has one-click buttons that fill these in.

## Architecture

```
Browser ──► Next.js 15 frontend (Vercel: findost-ai)
              │  Supabase Auth (email/password + Cloudflare Turnstile captcha, Google OAuth)
              │  /api/v1/* rewritten server-side to the API (same origin, no CORS)
              ▼
            FastAPI backend (Vercel Python: findost-api)
              │  verifies Supabase JWTs via JWKS (ES256)
              ▼
            Supabase Postgres (transaction pooler, RLS on, no public policies)

            Optional, server-side only:  Groq (explanations)  ·  Google Gemini (receipt reading, fallback)
```

The core promise — **records → validated ledger → deterministic forecast → explainable warning → shock simulation →
quantified recovery options → exportable report** — works with no AI provider configured. AI only words answers
the engine already computed and reads receipts into proposals the user must review.

- **Account types → modules.** Each user owns one workspace whose type (sme / enterprise / household / student)
  is picked at sign-up. The type decides the modules: the nav hides the others and the API rejects them
  (`403 feature_unavailable`). Students and households get no inventory; the type cannot be switched later.
- **Money** is stored as integer paisa. Revenue is not cash: a credit sale creates a receivable and only moves cash
  when the customer pays.
- **The browser never talks to the database.** Row-level security is enabled on every table with no policies, so
  the anon key cannot read business data; only the backend (direct DB connection) can, scoped to the signed-in owner.

## Modules

| | Module | What it does |
|---|---|---|
| A | Command Center | Cash today, 30-day runway, health index (0–100), top risks, next best action |
| B | Digital Khata | Transactions, customers/suppliers, udhaar receivables & payables, part-payments, WhatsApp reminder links, CSV export, change history (audit trail) on every edit/delete |
| C | Import | CSV: column mapping, date-format inference, Pakistani number formats, categorisation, per-row corrections, duplicates skipped unless confirmed, payments matched to open invoices (never over-settled), one atomic commit. Optional receipt/bill photo read by Gemini into a reviewable row |
| D | Forecasting | Opening balance + receivables (age-weighted collection) + payables + detected recurring bills + variable flows. Weekday-seasonal vs flat model chosen by rolling back-test; 80% band from back-test error (none shown without enough history); runway |
| E | Early warnings | 13 rules: projected shortage, reserve breach (names the bills), overdue udhaar, concentration, bill increases, spikes, anomalies/duplicates, slow stock … each with amount at stake and the records behind it. Severity is urgency, not probability |
| F | Shock simulator | Sales decline, delayed payments, supplier price rise, rent increase, utility hikes, unexpected expense, flood/interruption, customer loss — baseline vs shocked path on the same engine |
| G | Recovery engine | Generates candidate actions from your data (collect udhaar, defer payables, cut discretionary spend, liquidate slow stock …), re-projects each, scores liquidity/feasibility/cost/risk, builds a combined plan |
| H | What-if | Move a receivable/payable, change sales/opex/purchases, add an emergency expense, saved scenarios and comparison |
| I | Inventory | Stock value, days of cover, slow movers, reorder hints (SME/enterprise only) |
| J | Reports | Reporting period with opening → cash in/out → closing cash, revenue/expenses/profit, risks, scenarios, recovery options, data quality, limitations, timestamp; CSV and print-to-PDF; totals reconcile with the dashboard (tested) |
| K | Copilot | English / Roman Urdu / Urdu questions ("Can I afford Rs. 50,000 next week?"). Answers come from the engine; with consent, Groq (or Gemini as backup) rewords them — names masked, any added number rejected |
| L | Urdu | Urdu summaries and glossary with right-to-left-safe figures |
| M | SDG impact | Held-out synthetic benchmark (120 businesses, 14-day horizon): recall, false alarms, balance error and lead time vs a naive rule, with written definitions; SDG 1 / 8 / 9 / 10 target mapping |

## Repository layout

```
frontend/   Next.js app (landing, login/signup/onboarding, 13 app pages)
backend/    FastAPI app (app/services = engine, app/routers = API), tests, scripts
supabase/   config.toml (auth settings) and SQL migrations (initial schema + audit/AI-usage tables)
docs/       TECHNICAL_AUDIT, IMPLEMENTATION_PLAN, TEST_REPORT, DEMO_SCRIPT
scripts/    e2e-journey.cjs (browser check of the demo journey)
```

## Run locally

Backend (Python 3.12+):

```bash
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
DATABASE_URL=sqlite:///./local.db DEV_AUTH_SECRET=local-dev-secret-change-me-0123456789 \
  .venv/bin/uvicorn app.main:app --port 8000
.venv/bin/python -m pytest          # 80 tests, no network or API keys needed
```

Frontend (Node 20+), developer sign-in without Supabase:

```bash
cd frontend
npm install
NEXT_PUBLIC_AUTH_MODE=dev DEV_AUTH_SECRET=local-dev-secret-change-me-0123456789 \
  API_URL=http://localhost:8000 npm run dev      # http://localhost:3000
npm run typecheck && npm run lint && npm test && npm run build
```

To run against Supabase locally instead, fill `frontend/.env.local` from `frontend/.env.example`
and leave `NEXT_PUBLIC_AUTH_MODE` empty.

## Environment variables

Backend (`backend/.env.example`):

| Name | Purpose |
|---|---|
| `DATABASE_URL` | SQLite locally; Supabase transaction-pooler URL (port 6543) in production |
| `SUPABASE_URL` | Used to fetch the JWKS that verifies access tokens |
| `SUPABASE_JWT_SECRET` | Only for projects still on legacy HS256 tokens |
| `DEV_AUTH_SECRET` | Local developer tokens only — never set in production |
| `CORS_ORIGINS` | Allowed browser origins (the frontend proxies, so normally only needed for direct calls) |
| `GROQ_API_KEY`, `GROQ_MODEL` | Optional. Explanations in English / Urdu / Roman Urdu. Default model `openai/gpt-oss-20b` (strict JSON schema) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional. Receipt/bill reading and fallback for explanations. Default `gemini-3.5-flash-lite` |
| `LLM_TIMEOUT_SECONDS`, `AI_DAILY_LIMIT` | AI request timeout (12 s) and per-workspace daily AI request cap (60), stored in the database |
| `FINDOST_TODAY` | Pin "today" for reproducible tests |
| `MAX_UPLOAD_BYTES`, `ENVIRONMENT` | Upload limit, environment label |

Frontend (`frontend/.env.example`): `API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`, `NEXT_PUBLIC_AUTH_MODE`, `DEV_AUTH_SECRET` (dev only).

## AI providers

| Task | Provider (fallback) | What is sent | Safeguards |
|---|---|---|---|
| Copilot explanation | Groq → Gemini | The question and the engine's computed evidence, names replaced by `[P1]`… | Consent toggle; strict JSON schema; Pydantic validation; answer discarded if it contains a number not in the evidence |
| Receipt / bill photo | Gemini only | The uploaded image/PDF | Consent; JPG/PNG/WEBP/PDF magic-byte check, 4 MB; document treated as untrusted (instructions in it ignored); Decimal amounts; low confidence, odd dates or non-PKR are held back until the user corrects them; nothing reaches the ledger until the user confirms |

One provider is called per request; the next is tried only on failure (timeout, 429 after one capped retry, 5xx,
invalid output). Free tiers change and are not unlimited — Groq lists e.g. 30 requests/min and 1,000/day for
`openai/gpt-oss-20b`; check the providers' current limits. When AI is unavailable or the daily cap is reached,
FinDost answers with its own calculated templates. Settings → **Test AI connection** checks the live setup with a
fixed fictional sentence (no user data).

Get keys at https://console.groq.com/keys and https://aistudio.google.com/apikey, add them as **sensitive**
environment variables to the backend Vercel project only, and redeploy. Never add them to the frontend.

## Deployment

Order matters when the schema changes: **migrate first, then deploy the backend, then the frontend.**

- **Supabase:** `supabase link`, `supabase db push` (applies `supabase/migrations/*`, all tables with RLS),
  `supabase config push`
  (site URL, redirects, Turnstile captcha — secret supplied as `TURNSTILE_SECRET_KEY`).
  Demo logins: `DATABASE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python backend/scripts/seed_demo_accounts.py`.
- **Vercel:** two projects — `backend/` (framework `fastapi`) and `frontend/` (framework `nextjs`), each with a
  `vercel.json`. Deploy with `vercel deploy --prod` from each folder. The frontend build fails on purpose if
  `API_URL` is missing. Health check: `GET /api/v1/health` (status + which AI providers are configured, booleans only).
- **Benchmark:** after changing the forecast code run `python backend/scripts/run_benchmark.py`; a test fails if the
  stored `backend/app/data/benchmark.json` no longer matches the code.
- **Google sign-in:** create a Google Cloud OAuth client (Web) with redirect URI
  `https://<project-ref>.supabase.co/auth/v1/callback`, enable the Google provider in Supabase with its client ID and
  secret, then set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` on the frontend and redeploy.

## Testing

- `backend/tests` — 80 tests: hand-calculated ledger reconciliation across dashboard/report/exports, forecast edge
  cases (leap day, negative balance, no data), exact shock arithmetic, alert evidence, CSV import (settlement,
  duplicates, corrections, atomicity), cross-user isolation on 14 routes, AI routing/fallback/validation with mocked
  HTTP, benchmark reproducibility, auth and module separation.
- `frontend` — `npm test` (Vitest: money parsing/formatting), `npm run lint`, `npm run typecheck`, `npm run build`.
- `scripts/e2e-journey.cjs` — headless Chrome through the 10-step demo journey.

Results and what is still unverified: [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

## Known limitations

- Forecasts are estimates from the user's own records, not guarantees; the benchmark is synthetic, not real-business data.
- Receipt reading needs a Gemini key and consent, reads one document at a time, and has not been validated on a
  set of real Pakistani receipts. Bank-statement PDFs are not supported (CSV only).
- WhatsApp reminders open a pre-filled `wa.me` link; nothing is sent automatically.
- Copilot uses curated templates unless an AI key is configured and the owner consents.
- The demo is a single-currency (PKR) design; amounts in other currencies are flagged, not converted.
- Enterprise multi-site, tax previews and credit profiles are not built; the enterprise workspace uses the SME modules.
- AI quotas are per workspace per day; there is no per-minute application rate limit beyond the providers' own.
- Email confirmation is off so judges can sign up instantly; turn it on in Supabase Auth for real users.
- Demo logins are shared; anyone can reset their data from Settings.
- Supabase free projects pause after a week of inactivity.

See [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) for the 5-minute demo.
