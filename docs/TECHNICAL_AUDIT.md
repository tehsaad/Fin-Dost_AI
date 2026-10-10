# FinDost AI — Technical Audit

Audit date: 2026-10-10 · Commit audited: `cd4deec` (main) · Live: https://findostai.vercel.app

Everything below was checked against the source code; defects marked **Reproduced** were confirmed with a
script against the running API (`TestClient`, SQLite) before any fix was written.

## 1. Current architecture (verified)

| Layer | Implementation |
|---|---|
| Frontend | Next.js 15.5.27 App Router, React 19, TypeScript (`strict: true`), Tailwind 3, Recharts, framer-motion. Vercel project `findost-ai`. |
| API access | Browser calls same-origin `/api/v1/*`; `next.config.ts` rewrites to `API_URL` (no CORS, backend URL never in the bundle). |
| Backend | FastAPI 0.143 + Pydantic 2 + SQLAlchemy 2, Python 3.12 on Vercel (project `findost-api`, `framework: fastapi`). |
| Database | Supabase Postgres (transaction pooler, psycopg 3, `prepare_threshold=None`). SQLite for local dev/tests. Schema in `supabase/migrations/20261010000000_findost_schema.sql`; RLS enabled on all 13 tables with **no** policies (anon key cannot read business data). |
| Auth | Supabase Auth: email/password with Cloudflare Turnstile captcha (server-side verification by Supabase), Google OAuth (button hidden until a Google client is configured). Backend verifies ES256 JWTs via JWKS; HS256 only for legacy secret / local dev. |
| Tenancy | One business per user (`owner_id` unique). Every query is scoped by `business_id` through `get_business`; `owned()` returns 404 for foreign records. Account type → feature set enforced server-side by `require_feature` (403) and mirrored in the UI. |
| Money | Integer paisa everywhere in storage and engine arithmetic (`BigInteger`); amounts are parsed from strings without float rounding (`money.parse_amount`). |
| AI | Optional Gemini rephrasing of copilot answers, only with per-business consent, names masked, number-grounding guard. No Groq. |

## 2. Verified working features

Confirmed by the 40 backend tests, a headless-Chrome run over every page (SME + student) against Supabase
Postgres with 0 console errors / 0 failed API calls, and code reading:

- Ledger with 10 transaction kinds; revenue ≠ cash (credit sale creates a receivable, no cash); payments settle
  receivables/payables with overpayment rejection (single-request path); CSV export with formula-injection guard.
- Forecast: opening balance + age-weighted receivables + payables + detected monthly recurring items +
  weekday-seasonal vs flat model chosen by rolling-origin back-test; spike capping; 80% band; assumptions,
  warnings and confidence reasons returned with every forecast.
- Simulator: 8 shocks, 7 what-ifs, 7 recovery actions, all applied to forecast components and re-projected with
  the same engine; baseline vs scenario comparison; saved scenarios and comparison.
- Alerts: 13 deterministic rules with evidence lines, contributing transaction IDs/records, amounts, dates,
  next step and limitations; severity is documented as urgency, not probability.
- Recovery: candidates generated from records, each re-projected; weighted ranking; combined plan.
- CSV import: adapters, column mapping, day-first inference, Pakistani number formats, categorisation, preview,
  exclusion of rows, confirm in one DB transaction, batch provenance (`import_batch_id`, `source=import`).
- Reports: JSON + CSV + browser print-to-PDF built from the same engine calls as the dashboard.
- Benchmark: synthetic held-out 14-day horizon, labels from a hidden future, naive baseline.
- Demo: four fictional personas seeded relative to today; the SME story shows a shortage on day 9.

## 3. Broken features and reproducible defects

| ID | Severity | Defect | Evidence |
|---|---|---|---|
| D1 | P0 ledger | Editing the date of a credit sale/purchase leaves the linked receivable/payable `issued_on` unchanged, so ageing and reports disagree with the ledger. | **Reproduced**: tx moved to 2026-10-05, receivable still `issued_on 2026-10-01`. |
| D2 | P0 ledger | CSV confirm applies several customer/supplier payments to the **same** open invoice using the pre-import outstanding amount, over-settling it. | **Reproduced**: two Rs. 800 payments applied to a Rs. 1,000 invoice → paid Rs. 1,600. |
| D3 | P0 ledger | Rows flagged as duplicates are always dropped on confirm; two legitimate identical sales cannot both be imported. | **Reproduced**: two identical Rs. 500 cash sales → 1 imported, 1 silently skipped. |
| D4 | P0 forecast | With < 7 days of history the uncertainty band has zero width, which visually implies certainty. | **Reproduced**: band width 0 at day 30, model `none`. |
| D5 | P1 ledger | No audit history for edits/deletes of transactions, receivables and payables. | Code: no audit table or writes. |
| D6 | P1 ledger | Payment endpoints check outstanding and insert without a row lock; two concurrent payments can over-settle an invoice on Postgres. | Code reading (race, not reproduced). |
| D7 | P1 import | No way to correct a parsed row (amount, date, type, category) before committing; only exclude. Unmatched customer payments are silently converted to income. | Code: `ImportConfirmIn` has only `exclude_rows`. |
| D8 | P1 simulator | No rent-increase shock (prompt requirement "rent or utility increase"). | Code: `utility_increase` only scales utility categories. |
| D9 | P1 reports | Report lacks an explicit reporting period, period opening/closing cash, forecast horizon and a timestamp (date only). CSV omits scenarios and limitations. | Code: `financial_report`. |
| D10 | P1 benchmark | No false-positive rate; no forecast-error baseline; `wape_terms` computed but unused; lead-time definition not stated; results recomputed at runtime, not stored. | Code: `impact.run_benchmark`. |
| D11 | P1 AI | Default Gemini model was `gemini-2.0-flash`, which Google lists as shut down; 2.5 models are limited to existing users. No provider abstraction, no Groq, no rate limit on AI calls. | Official docs (checked 2026-10-10); code. |
| D12 | P1 security | No application rate limiting on AI endpoints; unhandled exceptions return plain-text 500 without a correlation id. | Code: `errors.py`, `analytics.copilot`. |
| D13 | P2 tooling | Frontend has no working lint (eslint not installed; config only has ignores) and no frontend tests. | `npx eslint .` downloads eslint and hangs. |
| D14 | P2 config | `next.config.ts` silently falls back to `http://localhost:8000` if `API_URL` is missing on Vercel. | Code. |
| D15 | P2 forecast | No explicit runway figure. | Code: forecast summary. |

## 4. Missing implementations

- Receipt/invoice extraction (OCR) — not implemented anywhere.
- Groq provider, provider routing, AI connection test.
- Audit trail and change history UI.
- Frontend unit tests and linting.

## 5. Security and privacy review

| Area | Finding |
|---|---|
| Authentication | Backend rejects missing/expired/invalid tokens (tests). JWKS verification with audience `authenticated`. HS256 dev secret is not set in production (verified env list). |
| Authorization | All business routes resolve the caller's business; foreign IDs return 404 (tested for transactions, receivables). Coverage of scenarios, alerts, imports, inventory, exports is not tested → add tests. |
| Workspace type | Taken from the DB row, never from the client; cannot be switched after onboarding (409). |
| Database exposure | RLS on, no policies, so PostgREST with the anon key returns nothing. Backend uses a direct DB role. |
| Secrets | Service-role key, DB URL, captcha secret and Gemini key are server-side only (Vercel sensitive vars / Supabase). Public bundle contains only the anon key and Turnstile site key (both public by design). |
| AI data | Sent only with per-business consent; customer/supplier names masked; numeric grounding check. The Gemini key is a URL query parameter, so failures are logged by status code only. |
| Uploads | `.csv` only, 2 MB limit, binary/oversized-column rejection, no files stored. |
| Errors | Uniform JSON for handled errors; unhandled errors give Starlette plain text (no stack trace) — add JSON handler with request id. |
| Encryption at rest | Supabase encrypts storage at the platform level; FinDost adds no application-level encryption and does not claim it. |
| Rate limits | Supabase Auth limits sign-in/sign-up (default auth rate limits + captcha). The FastAPI app has none → add for AI endpoints. |

## 6. External dependencies

- Supabase (Postgres + Auth), Cloudflare Turnstile (via Supabase), Vercel (two projects).
- Optional: Google Gemini API (`GEMINI_API_KEY`), Groq API (`GROQ_API_KEY`, not yet integrated).
- Python: fastapi, sqlalchemy, psycopg, numpy, httpx, pyjwt. JS: next, react, @supabase/ssr, recharts, framer-motion.

## 7. Prioritised remediation plan

1. **P0** D1–D4: ledger sync on edit, per-batch outstanding tracking, user-controlled duplicate inclusion, honest
   band when the model has no back-test.
2. **P1** D5–D6 audit trail + row locks; D7 row corrections; D8 rent shock; D9 report completeness; D10 benchmark
   metrics stored with metadata; D11–D12 AI provider abstraction (Groq primary for explanations, Gemini for receipt
   extraction and fallback), AI rate limits, JSON 500 handler.
3. **P2** D13–D15 lint/tests, API_URL guard, runway; Gemini receipt extraction as reviewable proposals.

See `IMPLEMENTATION_PLAN.md` for phases and acceptance criteria and `TEST_REPORT.md` for results.

## 8. Status after this pass (2026-10-10)

| ID | Status | Where |
|---|---|---|
| D1 | Fixed | `routers/ledger.py` update_transaction · `test_ledger.py` |
| D2 | Fixed | `services/ingestion.Settler`, `routers/imports.confirm` · `test_import.py` |
| D3 | Fixed | `include_duplicates` on confirm, Import page "anyway" · `test_import.py` |
| D4 | Fixed | forecast `band` method + `band_available` · `test_forecast_scenarios.py` |
| D5 | Fixed | `audit_events` table, `/audit`, change history UI · `test_ledger.py` |
| D6 | Fixed (not load-tested) | `owned(..., lock=True)` on payments |
| D7 | Fixed | `PUT /import/batches/{id}/rows/{n}`, row editor · `test_import.py` |
| D8 | Fixed | `rent_increase` shock + preset · `test_forecast_scenarios.py` |
| D9 | Fixed | report `period`, `generated_at`, CSV sections · `test_ledger.py` |
| D10 | Fixed | benchmark v2 + stored JSON · `test_benchmark.py` |
| D11 | Fixed (live calls unverified) | `services/ai` · `test_ai.py` |
| D12 | Fixed | JSON 500 + request id; DB-backed AI quota · `test_ledger.py`, `test_ai.py` |
| D13 | Fixed | ESLint + Vitest |
| D14 | Fixed | `next.config.ts` build guard |
| D15 | Fixed | `runway_days`, `runway_extrapolated_days` |

Remaining risks: PostCSS advisory inside Next 15 build tooling (fix needs Next 16); AI providers not exercised
live; no load test of concurrent payments; the benchmark is synthetic; enterprise features are not built.
