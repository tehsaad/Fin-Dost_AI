# Forecast methodology

Code: `backend/app/services/forecast.py` (projection), `simulation.py` (scenarios), `impact.py` (benchmark).
Tests: `tests/test_engine.py`, `tests/test_forecast_scenarios.py`, `tests/test_benchmark.py`.

## 1. Daily projection (default 30 days, 7–90 allowed)

`balance(day) = cash today + Σ inflows(1..day) − Σ outflows(1..day)`, with cash today taken from the ledger
(cash + bank + wallet; credit sales and purchases move no cash). Components:

| Component | Source | Certainty label |
|---|---|---|
| Open payables | Recorded bills, full outstanding on the due date (overdue → tomorrow) | recorded |
| Open receivables | Outstanding × age weight (95% not yet due, 80% 1–30 days late, 60% 31–60, 40% 61–90, 0% > 90 → listed as doubtful); expected on due date + the customer's own average delay; already later than usual → today + 14 days | estimated |
| Monthly patterns | Same description/category/amount seen in ≥ 2 months (rent, salary, bills); skipped when already entered as a bill; day 29–31 lands on the month's last day | estimated |
| Supplier-credit pipeline | Recent credit purchases continue at their weekly rate, paid after the usual lag | estimated |
| Everyday flows | Cash sales and expenses by group (stock, operating, utilities, discretionary) | model |

Everyday flows use the better of two models on the business's own history (complete days only, recurring
items removed, one-off spikes capped at median + 4 MAD):

* **Flat 28-day average** (baseline)
* **Weekday-seasonal** weighted average (8 weeks, recent weeks weigh more)

Selection is by **rolling-origin back-test**: 4 origins × 7-day horizon, each fitted only on data before its
origin (no leakage). The lower mean absolute error wins; the improvement over the baseline and the weekly error
(WAPE) are shown to the user. With < 28 days of history the flat average is used and labelled "not back-tested";
with < 7 days only recorded items are projected.

**Outputs:** daily balance, shortage date (first day < Rs. 0), minimum and its date, reserve-breach date,
runway (= days to shortage), average daily net, an *extrapolated* runway when cash falls but stays positive within
the horizon (clearly labelled), contributors (largest outflows before the low point), excluded/doubtful money,
assumptions, warnings and a confidence level with reasons.

## 2. Uncertainty band

`band(day) = projection ± 1.28 × σ × √day`, where σ is the back-test RMSE of daily net everyday flows (or the
standard deviation of daily net flows when not back-tested; no band at all with < 7 days of history).

**Measured calibration (benchmark v3): the band contained the realised day-14 balance for 43.3% of businesses —
73.5% of those without open invoices, but only 31.4% of those with them.** The band models everyday sales and
spending noise only; late customer payments and unrecorded bills make the real range wider. The UI therefore
describes it as "everyday sales/spending variation", not as an 80% interval. Modelling payment-timing
uncertainty is listed as future work; an experiment adding a simple timing variance only reached ~62% coverage,
and further tuning on synthetic data would be over-fitting.

## 3. Scenarios

Every shock, what-if and recovery action edits a *copy* of the forecast components and re-runs the same
projection; the ledger is never modified (tested). Types: sales decline, delayed payment, supplier price increase,
unexpected expense, utility increase, rent increase, business interruption, flood, customer loss; what-ifs that move
invoices/bills or change sales/opex/purchases; recovery actions (collect receivables, part payments, defer bills,
cut discretionary spend, buy less non-essential stock for a period, clearance sale, cash injection). A bill deferred
past the forecast window is kept on the window's last day, so paying later is never shown as money saved. Exact
arithmetic is asserted in tests.

## 4. Benchmark (synthetic, held-out) — `benchmark-v3`

Reproduce: `cd backend && .venv/bin/python scripts/run_benchmark.py` → `app/data/benchmark.json`
(test `test_stored_benchmark_matches_a_fresh_run` fails if the stored file drifts from the code).

* 120 synthetic kiryana-style businesses, fixed seed 2026; 63 days of visible history; recorded future bills and
  invoices; a hidden 14-day future generated afterwards with fresh noise and random customer lateness
  (0/3/10/25 days). Labels come only from the hidden future.
* 56 of 120 (46.7%) had a real shortage within 14 days.

| Metric | FinDost | Naive rule (cash − bills) |
|---|---|---|
| Recall (shortages caught) | 96.4% (54/56) | 100% (56/56) |
| False-positive rate | **7.8%** (5/64) | 31.2% (20/64) |
| Precision | 91.5% | 73.7% |
| Accuracy | 94.2% | 83.3% |
| Median absolute day-14 balance error | Rs. 20,998 | Rs. 135,474 (historical-average baseline: Rs. 275,814) |
| Average warning lead time (correct warnings) | 7.8 days | — |

**Limitations:** the generator follows our own assumptions about small-shop cash flows (including weekday
patterns the model is built to capture), so these numbers describe software behaviour, not real-world accuracy.
No real-business validation has been done yet.
