# Testing

All results below come from commands actually run on 2026-10-10 (Linux, Python 3.14 venv — Vercel runs 3.12 —
Node 22). AI providers are always mocked in tests; no API key is needed and no request leaves the machine.

## How to run

```bash
cd backend && .venv/bin/python -m pytest            # unit + API + integration
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
node scripts/e2e-journey.cjs                        # browser journey (see header of the file for setup)
npx lighthouse http://localhost:3001/ --only-categories=seo,accessibility,best-practices,performance
```

## Results (workspace selection, branch `feat/workspace-selection`)

| Check | Result |
|---|---|
| Backend pytest | **168 passed** (adds `test_workspaces.py`: 11 tests, `test_public_claims.py`: 2) |
| Frontend Vitest | **28 passed** (adds `lib/workspace.test.ts`: 9) |
| `tsc --noEmit`, ESLint | pass, 0 findings |
| Production build | pass |
| `scripts/e2e-enterprise.cjs` | **26/26** (adds: invited student opens company as viewer; switcher lists both; switch to own account shows no company data; own type kept; new sign-in shows the selector with both; revoked member returned to the selector) |
| `scripts/e2e-journey.cjs` | 15/15, 0 issues |

## Results (enterprise upgrade, branch `feat/enterprise-workflow-upgrade`)

| Check | Result |
|---|---|
| Backend pytest | **154 passed** (baseline before the upgrade: 139) |
| Frontend Vitest | **19 passed** (baseline 14; adds per-account-type navigation and wording tests) |
| `tsc --noEmit`, ESLint | pass, 0 findings |
| Production build | pass |
| `scripts/e2e-enterprise.cjs` (local, SQLite, dev sign-in, no AI/email keys) | **19/19**: enterprise nav and workflow tiles; floating Copilot greeting + records answer + Escape; budget; data checks; recovery → propose → submit → approve → complete; invitation (honest "no email sent"); editor joins with editor rights; student personal nav, URL block, personal scenarios; mobile layout; SDG on landing |
| `scripts/e2e-journey.cjs` (regression) | 15/15, 0 issues |

New backend tests (`test_enterprise.py`, 15): single-use, recipient-bound invitations; revoked and expired
invitations; viewer can read/export/simulate but every write is refused; editor works records but cannot
administer or approve; outsiders get 404 by workspace id on data, export, team and audit routes; removed members
lose access immediately; creator protected; `/me` lists workspaces; modules per account type (4 kinds); personal
presets and income delay; budget vs actual + over-budget alert + report; savings goal maths; data checks flag
without changing records; the 12-step enterprise workflow (import with correction → totals → forecast → evidence →
simulate → priced action → editor submits → owner approves → completed → report and audit trail agree).

## Results (pass 2)

| Check | Result |
|---|---|
| Backend pytest | **88 passed**, 0 failed, 0 skipped |
| Frontend Vitest | **9 passed** (money parsing/formatting, API failure handling) |
| TypeScript `tsc --noEmit` | pass |
| ESLint (next/core-web-vitals + typescript) | 0 errors, 0 warnings |
| Production build | pass (lint and types enforced), 30 routes + middleware |
| Browser journey (local stack, SQLite, dev sign-in, no AI keys) | **15/15 steps pass**, 0 console errors, 0 API 5xx |
| Lighthouse (local production build) | `/`: SEO 100, Accessibility 100, Best practices 100, Performance 82 · `/login` and `/signup`: 100/100/100, Performance 87 |
| Live checks | see IMPLEMENTATION_REPORT.md → Deployment verification |

## Backend tests by file (88)

| File | # | What it proves |
|---|---|---|
| `test_workflow.py` | 2 | The 12-step path: workspace → income/expense → credit sale → partial payment → cash Rs. 31,000 / receivable Rs. 10,000 / revenue Rs. 25,000 → forecast shortage on the bill date → alert linked to the bill → shock moves the minimum by exactly the shock → report CSV matches the ledger → second user sees nothing; empty-workspace exports |
| `test_ledger.py` | 6 | Hand-calculated reconciliation across dashboard, report, report CSV and ledger CSV; paisa precision; credit-sale date edits move the invoice and are audited; delete audit; overpayment refused; isolation on 14 routes; JSON 500 with request id |
| `test_forecast_scenarios.py` | 10 | No future data, zero vs negative balance, hand-calculated path, large expense, runway, 29 Feb / month ends, exact shock deltas, rent shock without rent, simulations never mutate the ledger |
| `test_alerts_recovery.py` | 5 | Alert record references resolve to real records; reserve breach names its bill; duplicate alert points at both entries; collect-invoice vs delay-purchase quantified; recovery changes nothing |
| `test_import.py` | 5 | No over-settlement across a file; matching a sale earlier in the same file; duplicates only with confirmation; corrections + provenance; atomic confirm |
| `test_ai.py` | 12 | Groq first with strict schema and masked names; capped retry → Gemini fallback; invalid/ungrounded output → template; timeouts; strict schema; consent + quota; health booleans; Roman Urdu; receipts as reviewable proposals; spoofed files; Decimal amounts |
| `test_demo_security.py` | 6 | Private demos isolated (one visitor's reset leaves another's data untouched); demo limits; upgrade keeps the workspace; cleanup deletes only stale anonymous workspaces and requires the cron secret; developer tokens rejected in production; 9 copilot questions (English, Roman Urdu, out-of-scope, unknown) answered from records |
| `test_benchmark.py` | 3 | Stored benchmark equals a fresh run; definitions/FPR/error baselines present; public endpoint labelled synthetic |
| `test_engine.py`, `test_api.py` | 39 | Original engine and API suite |

## Copilot questions verified (from records, no LLM)

| Question | Intent | Answer starts with |
|---|---|---|
| How much cash will I have next week? | balance | "You have Rs. 118,000 in total today … In 7 days the forecast is about …" |
| Which payments are overdue? | overdue | "4 customer invoice(s) totalling Rs. 215,000 are overdue (oldest: …, 95 days)." |
| What is my biggest upcoming expense? | upcoming_expense | "Your biggest upcoming payment is … Rs. 165,000 on … (a recorded bill)." |
| Agar sales 20% kam ho jayein to kya hoga? | sales_decline | "If sales fall 20% for the next 30 days, the lowest projected balance moves from …" |
| Mere paas aglay haftay kitna cash hoga? | balance | as above |
| Can I afford 1.5 lakh next week? | affordability | "Not safely. Spending Rs. 150,000 in 7 day(s) would push …" |
| How much has Al-Madina Caterers paid so far? | party | "… Rs. 145,000 invoiced, Rs. 60,000 paid so far and Rs. 85,000 still owed …" |

Roman Urdu questions are answered in English by the templates; with AI consent, Groq rewords them in Roman Urdu.

## Performance measurements (in-process, SQLite, demo SME workspace)

| Endpoint | SQL queries | Server time | Payload |
|---|---|---|---|
| onboarding with demo data | 149 | 151 ms | 0.6 KB |
| dashboard (first / cached forecast) | 25 / 10 | 106 / 75 ms | 21.8 KB |
| forecast · alerts · transactions | 10 · 11 · 5 | 33 · 32 · 14 ms | 22 · 12 · 19 KB |
| report · recovery · copilot | 12 · 8 · 8 | 66 · 33 · 24 ms | 30 · 30 · 1 KB |

On Vercel each query adds the pooler round trip (same region), so these remain well under a second.

## Not verified

| Item | Reason | How to verify |
|---|---|---|
| Live Groq/Gemini answers | keys are write-only secrets | Settings → Test AI connection (signed in) |
| Live private-demo sign-in and Resend emails | require the production rollout + a human solving the captcha | sign up with a real inbox; click "Try a private demo" |
| Postgres row locks under concurrent payments | no load-test environment | two parallel payment requests on staging |
| Real-business forecast accuracy | only synthetic benchmark | pilot with consenting businesses |
