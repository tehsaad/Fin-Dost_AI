# FinDost AI — Test Report

Run date: 2026-10-10 · Machine: Linux, Python 3.14 (local venv; Vercel uses 3.12), Node 22 ·
All results below were produced by actually running the commands shown. Nothing here was run against
production: the live site still runs the previous release until the changes are deployed.

## Summary

| Check | Command | Result |
|---|---|---|
| Backend unit + API tests | `cd backend && .venv/bin/python -m pytest` | **80 passed**, 0 failed |
| Frontend unit tests | `cd frontend && npm test` | **4 passed** |
| Type checking | `cd frontend && npm run typecheck` | pass |
| Lint | `cd frontend && npm run lint` (eslint 9, next/core-web-vitals + typescript) | 0 errors, 0 warnings |
| Production build | `cd frontend && npm run build` (lint + types enforced) | pass, 20 routes + middleware |
| Browser journey | `node scripts/e2e-journey.cjs` against local stack (SQLite, no AI keys) | **15/15 steps pass**, 0 console errors, 0 API 5xx |
| Dependency audit | `npm audit --omit=dev` | 1 moderate + 1 high, both PostCSS bundled in Next 15 build tooling (fix requires Next 16); `sharp` fixed |

## Backend tests by area (80)

| File | Tests | Covers |
|---|---|---|
| `test_ledger.py` | 6 | Hand-calculated reconciliation (cash 18,500 / revenue 13,000 / expenses 8,000 / profit 5,000 / receivables 5,000 / payables 5,000) across dashboard, report, report CSV and ledger CSV; paisa precision; credit-sale date edit moves invoice + audit; delete audit; overpayment refusal; **cross-user isolation on 14 routes**; JSON 500 with request id and no leaked message |
| `test_forecast_scenarios.py` | 10 | No future data; zero vs negative balance; hand-calculated path with history + bill + invoice; large future expense; runway extrapolation; month-end and 29 Feb; exact shock deltas (rent, utility, unexpected expense, supplier price, sales decline); rent shock with no rent; simulation never mutates the snapshot; API simulation leaves records and dashboard unchanged |
| `test_alerts_recovery.py` | 5 | Every alert has impact + record references that resolve to real records; reserve breach names the bill; duplicate alert points at both entries; collect-invoice vs delay-purchase quantified; recovery endpoint changes nothing |
| `test_import.py` | 5 | Two payments cannot over-settle one invoice (D2); payment matches a credit sale earlier in the same file; identical rows importable only when confirmed (D3); rejected row corrected then imported with provenance + audit (D7); confirm is atomic when a failure happens mid-way |
| `test_ai.py` | 12 | Groq first with strict json_schema and masked names; 429 → capped Retry-After → Gemini fallback, key in header not URL; invalid/ungrounded output → template; timeouts and missing keys never raise; strict schema shape; consent + daily quota (429 `ai_quota`); health exposes booleans only; Roman Urdu detection; receipt → reviewable proposal, Decimal amounts, nothing saved before confirm; low-confidence/odd receipts held back; spoofed file types refused; unavailable without Gemini |
| `test_benchmark.py` | 3 | Stored benchmark equals a fresh run; definitions, confusion totals, FPR, error baseline present; public endpoint labelled synthetic |
| `test_engine.py`, `test_api.py` | 39 | Original engine and API suite (money parsing, balances, forecast weighting, back-test, simulation, recovery, CSV parsing, auth, module separation, onboarding, payments, reminders, reports, reset/clear, inventory, impact, demo rebasing) |

AI tests mock `httpx.post`; no API key is used and no request leaves the machine.

## Browser journey (15 checks)

Dashboard with synthetic-data label and Rs. 118,000 · transaction edit appears in change history · shortage alert
with impact and record count · forecast band method + runway · rent shock vs baseline · quantified recovery ·
Copilot Urdu answer from computed data · report cash bridge · report CSV with period and limitations · import:
row correction + confirmed duplicate → 3 imported · receipt card honest without a Gemini key · Settings AI panel ·
Impact page false alarms + definitions · no horizontal overflow at 390 px.

## Defects fixed (see TECHNICAL_AUDIT.md)

D1–D15 all addressed; each fix has a test except D6 (row locks), which is exercised on SQLite where `FOR UPDATE`
is a no-op — the Postgres behaviour was not load-tested.

## Not verified / blocked

| Item | Why | How to verify |
|---|---|---|
| Real Groq and Gemini calls | No Groq key exists yet; the Gemini key is a sensitive Vercel variable that cannot be read back | After deploy + `GROQ_API_KEY`, Settings → **Test AI connection**; upload one receipt photo |
| Gemini model `gemini-3.5-flash-lite` with `generateContent` + JSON mode | Chosen from Google's docs (Oct 2026); not exercised live | Same test button; change `GEMINI_MODEL` if it reports HTTP 404 |
| Postgres row locks under concurrency | No load test | Two parallel payments against one invoice on a staging DB |
| New tables in production | Migration not applied (needs owner approval) | `supabase db push` |
| Live captcha sign-in after redeploy | Turnstile blocks automated browsers by design | Manual sign-in with a demo card |
