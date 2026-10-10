# FinDost AI — Architecture

```
 Browser (Next.js 15 App Router, React 19, Tailwind)
   │  Supabase Auth in the browser: email+password (Turnstile), Google OAuth, anonymous "private demo"
   │  every API call: same-origin /api/v1/*  + Authorization: Bearer <Supabase access token>
   ▼
 Vercel project findost-ai  ──rewrite──►  Vercel project findost-api (FastAPI, Python 3.12)
   middleware.ts: session refresh,           auth.py: JWT verified via Supabase JWKS (ES256)
   protects app routes                       get_business → one workspace per user (owner_id)
                                             require_feature → modules allowed for the account type
                                                 │
                                                 ▼
                                     services/ (pure functions on a Snapshot)
                                     ledger · forecast · simulation · recovery · risk · insights
                                     ingestion · copilot · impact · ai (Groq / Gemini)
                                                 │ SQLAlchemy 2 (psycopg, transaction pooler)
                                                 ▼
                                     Supabase Postgres — 15 tables, RLS enabled, no policies
 Supabase Auth ──SMTP──► Resend (no-reply@tehsaad.site)      Vercel Cron ──► /internal/cleanup-demos
```

## Request flow

1. The browser obtains a Supabase session (cookie-backed via `@supabase/ssr`).
2. `lib/api.ts` sends `/api/v1/...` to the same origin with the bearer token; Next rewrites it to `API_URL`.
3. FastAPI verifies the JWT (`aud=authenticated`, ES256 via JWKS; HS256 only for the legacy secret or local dev,
   never `DEV_AUTH_SECRET` in production), loads the caller's single `Business`, checks the module is allowed.
4. Routers load a `Snapshot` (all of the workspace's records, converted to plain dataclasses) and call services.
5. Services are deterministic and side-effect free; routers persist only user actions, audit events, forecast
   summaries and alert acknowledgement state.

## Data model (Postgres)

`businesses` (one created per user; `kind`, opening balances, reserve, `is_demo`, `is_anonymous`, AI consent) +
`workspace_members` / `workspace_invitations` (shared enterprise workspaces) →
`transactions`, `customers`, `suppliers`, `receivables`, `payables`, `products`, `inventory_movements`,
`financial_scenarios` + `scenario_actions`, `forecast_runs`, `risk_alerts`, `import_batches`, `audit_events`,
`ai_usage`, `budgets`, `savings_goals`, `finance_actions`. Every child row has `business_id … ON DELETE CASCADE`. Money is `BIGINT` paisa.

## Module boundaries

| Layer | Location | Rule |
|---|---|---|
| Financial arithmetic | `backend/app/services/*` | Only here. Pure functions, unit-tested with hand-calculated values |
| HTTP, validation, ownership | `backend/app/routers/*`, `schemas.py` | Pydantic with `extra="forbid"`; `owned()` returns 404 for foreign records |
| AI | `backend/app/services/ai/*` | Providers only word or extract; never compute balances |
| UI | `frontend/app`, `frontend/components` | Displays API values; no financial calculations except formatting |

## Workspaces and demos

* Account type (sme / enterprise / household / student) is chosen at onboarding and fixes the module set
  (`auth.FEATURES`), enforced server-side.
* "Try a private demo" signs the visitor in anonymously (captcha-protected) and seeds a private workspace with
  synthetic data. Limits: 3,000 transactions, 10 AI calls/day, no receipt reading. It is deleted after 7 days by
  a daily Vercel Cron unless the visitor adds an email (Settings → Keep this workspace).

## Copilot pipeline (`routers/analytics._copilot_steps`, streamed by `POST /copilot/stream`)

1. **Rules** (`copilot_nlu` + `copilot.py`): scored intents in English, Urdu and Roman Urdu, follow-ups from the
   echoed context; greetings and thanks get a friendly reply (no AI).
2. **Interpreter** (AI on): maps a question the rules can't place to one engine tool with range-checked inputs.
3. **Agent** (`services/ai/agent.py`, AI on, still unplaced): plans up to 3 engine tools (incl. inventory and
   alerts) or a short conversational reply without figures, then words the computed results. Any number not in the
   tool results is rejected and the engine's own wording is shown. Names are masked; the last 8 messages are context.
4. **Rewording** (AI on): the rule answer is reworded by Groq (Gemini fallback) with the same number guard.

Every figure comes from the engine. AI off, unavailable, failing or over the daily limit → the rule answer, with
`ai_fallback` saying why.

## Shared workspaces and roles (`auth.get_access`)

* A request's workspace is the user's own, or one they are an **active member** of, chosen with the
  `X-Workspace-Id` header. The header is only honoured after a membership check; anything else → 404.
* Roles: **owner** (all, incl. approvals, team, settings), **editor** (records, imports, reports, propose actions),
  **viewer** (read and export). Unknown roles have no permissions.
* Default-deny for read-only roles: any non-GET request is refused unless it is a calculation-only endpoint
  (simulate, compare, recovery, copilot). Owner-only routes additionally require the `admin` permission; approvals
  require `approve`.
* The workspace creator (`businesses.owner_id`) is the permanent owner and is not stored as a member, so a
  workspace always keeps an owner. Audit events record the acting user.

## Enterprise workflow

Import (CSV/receipt, preview, corrections) → ledger → forecast, budget vs actual, data checks → alerts with
records → scenarios and recovery options (simulated, ledger untouched) → **Propose as action** (impact re-simulated
server-side) → submit → owner approves/rejects → a person marks it completed → reports show budget, actions and
checks. FinDost never moves money; "completed" is what a person recorded.

## Account types

| Kind | Navigation and wording | Modules |
|---|---|---|
| enterprise | Financial Overview, Records, Planning, Risk & controls, Operations (Tasks & Approvals, Reports, Team) | all business modules + budget, controls, actions, team |
| sme | Command Center, Digital Khata, shop wording | business modules + budget, controls, actions |
| household, student | My Money, Income & Expenses, Monthly Budget, Savings Goals, What-if Planner, Spending Adjustment Plan, Budget Warnings | ledger, bills, import, forecast, alerts, simulator (personal presets: income late/drops), recovery (personal wording), reports, budget, goals |

SDG impact is on the public landing page (`/public/benchmark`), not in any workspace.
