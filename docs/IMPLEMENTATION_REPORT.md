# Implementation report — Enterprise workflow upgrade

Branch `feat/enterprise-workflow-upgrade` (not merged or deployed). Statuses use: IMPLEMENTED AND VERIFIED,
IMPLEMENTED BUT UNVERIFIED, PARTIALLY IMPLEMENTED, BLOCKED, NOT IMPLEMENTED. "Verified" here means local
automated tests and local browser runs; nothing below was verified on production.

| Feature | Status | Evidence | Limitation |
|---|---|---|---|
| Per-account-type navigation and wording | IMPLEMENTED AND VERIFIED | `nav-config.test.ts`, e2e student/enterprise nav | Wording of a few deep page sections (e.g. Khata tabs) is still shared |
| Backend module enforcement per type | IMPLEMENTED AND VERIFIED | `test_modules_follow_the_account_type` (4 kinds) | — |
| Student/household personal finance (budget, goals, personal scenarios, spending-adjustment wording) | IMPLEMENTED AND VERIFIED | budget/goal/preset tests, e2e | Savings "saved" amount is entered by the user, not tracked from accounts |
| SDG impact on public landing page only | IMPLEMENTED AND VERIFIED | `/impact` API 403 + page redirect; landing e2e | Benchmark remains synthetic (labelled) |
| Floating global Copilot (real API, history, stages, retry, Escape, mobile) | IMPLEMENTED AND VERIFIED | e2e greeting + records answer + close; shared `CopilotChat` with `/copilot` | No streaming of answer tokens by design (numbers are verified first) |
| Copilot agent tools for budget, approvals, data checks, goals | IMPLEMENTED BUT UNVERIFIED (live AI) | mocked-provider tests for agent path | Needs AI consent + Groq/Gemini live |
| Budget vs actual + over-budget alerts + report section | IMPLEMENTED AND VERIFIED | `test_budget_vs_actual_and_overrun_alert` | Monthly category budgets only; no multi-period plans |
| Financial controls (data checks) | IMPLEMENTED AND VERIFIED | `test_data_checks_flag_records_without_changing_them` | Not bank reconciliation (no bank feed) |
| Controlled actions: propose → approval → completion, audit | IMPLEMENTED AND VERIFIED | workflow test + e2e | Approval policy is "owners approve"; no amount thresholds or maker-checker for single-owner workspaces |
| Shared enterprise workspace, roles, membership checks | IMPLEMENTED AND VERIFIED | 6 authorization tests + e2e editor | Ownership transfer not implemented (creator is permanent owner) |
| Team invitations | PARTIALLY IMPLEMENTED | secure flow tested; email path coded | Email delivery needs `RESEND_API_KEY` on the backend (not set); without it the owner shares the link |
| Viewer exports / editor permissions | IMPLEMENTED AND VERIFIED | viewer/editor tests | UI hides some editing controls, but not every form is disabled for viewers (server refuses) |
| Reports include budget, actions, checks | IMPLEMENTED AND VERIFIED | workflow test asserts report counts | — |
| Migration `20261013000000_enterprise_workspaces` | IMPLEMENTED BUT UNVERIFIED (prod) | generated from models, 5 tables, RLS on | Not applied to production |
| Deployment | NOT DONE | — | Requires approval: migration + deploy |

## Files

Backend: `app/auth.py` (Access, roles, default-deny), `app/models.py` (5 models), `app/routers/{planning,workflow,team}.py`
(new), `app/routers/{account,analytics,scenarios}.py`, `app/services/{planning,controls}.py` (new),
`app/services/{risk,recovery,simulation,audit}.py`, `app/services/ai/agent.py`, `tests/test_enterprise.py`.
Frontend: `components/app/{nav-config.ts,shell.tsx,app-provider.tsx,workflow-panel.tsx,propose-action.tsx}`,
`components/copilot/{chat,floating}.tsx`, `app/(app)/{budget,goals,controls,actions,team}/page.tsx`,
`app/invite/page.tsx`, `lib/{api,terms,types}.ts`, `components/landing/landing.tsx`, `middleware.ts`.
Database: `supabase/migrations/20261013000000_enterprise_workspaces.sql`.

## Reused, not duplicated

Ledger, import preview/confirm, forecast, simulation, recovery, risk and report services; the existing
`/copilot/stream` pipeline and its client; audit log; AI consent and quota; JWT verification.
