# FinDost AI — Implementation Plan

> Historical snapshot kept for the record. For the current product see [PRESENTATION_GUIDE.md](PRESENTATION_GUIDE.md).

Defect IDs refer to `TECHNICAL_AUDIT.md`. Each phase ends with the backend test suite, frontend typecheck and
(from Phase 9) lint and build. Nothing is deployed and no production migration is applied without the owner's
explicit go-ahead; new tables are additive.

| Phase | Scope | Acceptance criteria | Depends on |
|---|---|---|---|
| 1 | Repository inspection, audit, plan | `TECHNICAL_AUDIT.md`, this file; every listed defect reproduced or cited to code | — |
| 2 | Critical connectivity/config | Production build fails loudly if `API_URL` is missing on Vercel (D14); JSON 500 handler with request id (D12) | 1 |
| 3 | Ledger correctness | D1 fixed (dates synced, due date still ≥ issue date); D6 payment row locks; D5 `audit_events` table written on create/update/delete/payment/import and readable per record; hand-calculated reconciliation tests (cash vs revenue vs receivables vs payables vs profit) | 2 |
| 4 | Forecast + scenarios | D4: band only when a back-tested or sample-based sigma exists, labelled method otherwise; D15 runway; D8 `rent_increase` shock + preset; tests: no future txns, large expense, delayed payment, missing records, negative/zero balance, leap day, hand-calculated path, shock numeric deltas | 3 |
| 5 | Alerts + recovery | Every alert exposes `impact_paisa` and record references; reserve-breach alert names the bill(s) that cause it; recovery comparison test (collect invoice vs delay purchase) | 4 |
| 6 | CSV + reports | D2 per-batch outstanding; D3 per-row "import anyway" for duplicates; D7 row corrections validated server-side; unmatched payments reported; D9 report period/opening/closing/horizon/timestamp + CSV sections; report↔dashboard↔ledger reconciliation test | 3 |
| 7 | AI providers | `AIProvider` abstraction, `GroqProvider` (explanations, Urdu/Roman Urdu), `GeminiProvider` (receipt extraction, fallback); timeouts, bounded retry on 429/5xx, schema validation, consent, masking, number guard, DB-backed daily AI quota (D11–D12); authenticated AI status check; mocked tests only | 2 |
| 8 | Demo + benchmark | D10: FPR, error vs naive baseline, definitions, stored JSON with metadata + test that it matches recomputation; UI shows definitions and "synthetic"; demo journey steps 1–10 verified | 4, 6 |
| 9 | Quality | ESLint (next config) + script; Vitest for money formatting/parsing; accessibility checks on new UI (labels, focus, keyboard) | 1–8 |
| 10 | Release prep | Backend tests, typecheck, lint, production build, browser run; `TEST_REPORT.md`; deployment steps incl. migration order | 1–9 |

## Deployment order (when authorised)

1. Apply the additive Supabase migration (`audit_events`, `ai_usage`).
2. Deploy backend (`findost-api`), then frontend (`findost-ai`).
3. Optional: add `GROQ_API_KEY` to the backend project; keep `GEMINI_API_KEY`.

## Out of scope for this pass (documented as planned)

Enterprise multi-site features, tax previews, credit profiles, bank/wallet API integrations, PDF statement OCR.
