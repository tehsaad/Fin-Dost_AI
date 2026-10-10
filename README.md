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
```

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
| B | Digital Khata | Transactions, customers/suppliers, udhaar receivables & payables, part-payments, WhatsApp reminder links, CSV export |
| C | CSV import | Upload any bank/khata CSV → column mapping, date-format inference, categorisation, duplicate detection, preview → confirm |
| D | Forecasting | Opening balance + receivables (age-weighted collection) + payables + detected recurring bills + variable flows. Weekday-seasonal vs flat model chosen by rolling backtest; 80% band |
| E | Early warnings | 13 rules: projected shortage, reserve breach, overdue udhaar, concentration, bill increases, spikes, anomalies/duplicates, slow stock … Severity is urgency, not probability |
| F | Shock simulator | Sales decline, delayed payments, supplier price rise, flood/interruption, customer loss, utility hikes — side-by-side baseline vs shocked path |
| G | Recovery engine | Generates candidate actions from your data (collect udhaar, defer payables, cut discretionary spend, liquidate slow stock …), re-projects each, scores liquidity/feasibility/cost/risk, builds a combined plan |
| H | What-if | Move a receivable/payable, change sales/opex/purchases, add an emergency expense, saved scenarios and comparison |
| I | Inventory | Stock value, days of cover, slow movers, reorder hints (SME/enterprise only) |
| J | Reports | P&L-style summary, cash vs revenue, category breakdown, CSV download |
| K | Copilot | English / Roman Urdu / Urdu questions ("Can I afford Rs. 50,000 next week?"). Answers come from the engine; optional Gemini rephrasing only with consent, names masked, numbers checked |
| L | Urdu | Urdu summaries and glossary with right-to-left-safe figures |
| M | SDG impact | Held-out synthetic benchmark (120 businesses): shortage detection vs a naive rule, lead time; SDG 1 / 8 / 9 / 10 target mapping |

## Repository layout

```
frontend/   Next.js app (landing, login/signup/onboarding, 13 app pages)
backend/    FastAPI app (app/services = engine, app/routers = API), tests, scripts
supabase/   config.toml (auth settings) and the SQL migration for the schema
```

## Run locally

Backend (Python 3.12+):

```bash
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
DATABASE_URL=sqlite:///./local.db DEV_AUTH_SECRET=local-dev-secret-change-me-0123456789 \
  .venv/bin/uvicorn app.main:app --port 8000
.venv/bin/python -m pytest          # 40 tests
```

Frontend (Node 20+), developer sign-in without Supabase:

```bash
cd frontend
npm install
NEXT_PUBLIC_AUTH_MODE=dev DEV_AUTH_SECRET=local-dev-secret-change-me-0123456789 \
  API_URL=http://localhost:8000 npm run dev      # http://localhost:3000
npm run typecheck && npm run build
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
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `LLM_TIMEOUT_SECONDS` | Optional copilot rephrasing |
| `FINDOST_TODAY` | Pin "today" for reproducible tests |
| `MAX_UPLOAD_BYTES`, `ENVIRONMENT` | Upload limit, environment label |

Frontend (`frontend/.env.example`): `API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`, `NEXT_PUBLIC_AUTH_MODE`, `DEV_AUTH_SECRET` (dev only).

## Deployment

- **Supabase:** `supabase link`, `supabase db push` (creates tables with RLS), `supabase config push`
  (site URL, redirects, Turnstile captcha — secret supplied as `TURNSTILE_SECRET_KEY`).
  Demo logins: `DATABASE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python backend/scripts/seed_demo_accounts.py`.
- **Vercel:** two projects — `backend/` (framework `fastapi`) and `frontend/` (framework `nextjs`), each with a
  `vercel.json`. Deploy with `vercel deploy --prod` from each folder.
- **Google sign-in:** create a Google Cloud OAuth client (Web) with redirect URI
  `https://<project-ref>.supabase.co/auth/v1/callback`, enable the Google provider in Supabase with its client ID and
  secret, then set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` on the frontend and redeploy.

## Testing

- `backend/tests`: 40 tests — engine (ledger maths, forecast, collection weights, recurring detection, shocks,
  recovery, risk rules, anomalies, CSV parsing, Urdu formatting, benchmark) and API (auth, module separation,
  ownership isolation, validation, imports, reports, copilot).
- End-to-end: headless Chrome over every page for the SME and student accounts, checking for console errors and
  failed API calls, on desktop and mobile widths.

## Known limitations

- Forecasts are estimates from the user's own records, not guarantees; the benchmark is synthetic, not real-business data.
- Import is CSV only (no PDF/receipt OCR yet).
- WhatsApp reminders open a pre-filled `wa.me` link; nothing is sent automatically.
- Copilot uses curated templates unless a Gemini key is configured.
- Email confirmation is off so judges can sign up instantly; turn it on in Supabase Auth for real users.
- Demo logins are shared; anyone can reset their data from Settings.
- Supabase free projects pause after a week of inactivity.

See [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) for the 5-minute demo.
