# FinDost AI — 5-minute demo script

Open https://findostai.vercel.app. All demo data is fictional and re-anchors to today's date, so the story
below is the same on any day. Each private demo is your own copy, so **Settings → Reset demo data** only affects you.

## 0:00 – 0:30 · The problem (landing page)
- "Pakistani shopkeepers run on udhaar. A shop can be profitable on paper and still run out of cash, because
  customers pay late while suppliers and bills don't wait."
- Scroll the landing page once: early warning → shock test → recovery plan. Click **Sign in**.

## 0:30 – 1:00 · Secure login and account types
- Point out the Cloudflare captcha and that real accounts need email verification.
- Under **Try a private demo**, complete the check and click **Small business**: a private workspace with
  synthetic data opens — nobody else can see or reset it.
- "Each login belongs to one account type — shop, enterprise, household or student — and that decides which
  modules exist for it, enforced by the server, not just hidden in the UI."

## 1:00 – 1:50 · Command Center (Bilal General Store, Lahore)
- Cash today **Rs. 118,000** — looks fine.
- The forecast says cash goes **negative on day 9** and bottoms out around **−Rs. 128,000** on day 12.
- Show the health index (FinDost's own 0–100 index, not a credit score) and the top risks: Rs. 215,000 of overdue
  udhaar from 4 customer invoices, 3 bills due in the next 14 days that may not be covered, revenue down 24% in the
  last 14 days.
- "Profit isn't the problem — timing is."

## 1:50 – 2:30 · Why (Forecast + Alerts)
- **Forecast:** the 30-day line with its uncertainty band; open the drivers — receivables weighted by age and each
  customer's usual delay, detected monthly bills, the weekday sales pattern. The model was picked by backtesting
  on the shop's own past weeks.
- **Alerts:** projected shortage, overdue receivables, bills at risk, revenue decline, slow-moving stock and an
  unusual expense, each with the records behind it. Severity is urgency, not probability.

## 2:30 – 3:15 · Stress test (Shock simulator)
- Click **Sales fall 20% for 3 weeks** → baseline vs shocked path. The shortage still starts on day 9, but it goes
  much deeper: the lowest point falls from about −Rs. 128,800 to about −Rs. 213,000.
- Optionally stack **Top 3 customers pay 30 days late**. Save the scenario.

## 3:15 – 4:00 · Recovery plan
- Note: options are simulations — nothing is marked as collected or paid until you record it in the Khata.
- Open **Recovery**: ranked actions generated from this shop's data — collect specific udhaar, ask for part payments,
  defer a supplier payment, cut discretionary spend, sell slow stock.
- Each shows the cash effect on the lowest projected balance. In this demo, asking suppliers for 14 more days
  removes the projected shortage on its own (if the suppliers agree — that is the stated assumption). The score is a
  ranking from your priority weights, not a probability of success.
- Optional: click **Propose as action** on an option — it becomes a tracked task. FinDost never moves money.
- From **Khata → Receivables**, open a WhatsApp reminder (pre-filled English/Urdu message).

## 4:00 – 4:30 · Copilot in Urdu (floating button, bottom-right on every page)
- Ask **"Can I afford Rs. 50,000 next week?"** → "Not safely…": the balance would fall to about −Rs. 178,800, and it
  notes a shortage is already projected without this payment.
- Ask **"Explain my dashboard in simple Urdu"** → Urdu summary with the exact same figures.

## 4:30 – 5:00 · Breadth and impact
- **Import:** upload the messy sample CSV → dates, amounts and categories normalised, duplicates flagged; fix a
  rejected row with the pencil, then import. **Reports → CSV** downloads the same figures shown on screen.
- Sign out, open a **Student** private demo → a smaller budget app with no inventory module; `/inventory` says it's not part
  of this account type.
- **Impact** (home page → Impact section): on 120 synthetic test businesses (not real businesses), the forecast caught
  **96%** of 14-day shortages with about **8 days** of notice on average. A naive "cash minus bills" rule catches them
  all too, but wrongly warns **31%** of healthy businesses; FinDost wrongly warns **8%**. The forecast range held the
  real day-14 balance for only **43%** of test businesses (it covers everyday variation, not late customer payments) —
  say this if asked about uncertainty. Close on SDG targets 1.4, 1.5, 8.3, 9.3 and 10.2, and on the stated caveat: the
  impact pathway is hypothetical; FinDost has not yet been evaluated with real businesses.

## Optional (+1 min) · Enterprise workflow
- Open an **Enterprise** private demo: navigation is grouped as Overview → Records → Planning → Risk & controls →
  Operations.
- **Budget vs Actual:** add a monthly budget for a category; it is compared with spending recorded this month.
- **Data Checks:** possible duplicates, uncategorised entries, payments not matched to invoices — read-only flags,
  not a bank reconciliation.
- **Tasks & Approvals:** a proposed action is submitted, an owner approves it, someone marks it completed; each step
  records who and when.
- **Team & Access:** invite a colleague as Editor or Viewer; roles are enforced by the server.

## Backup plan
- If live login is slow, the API health check is https://findost-api.vercel.app/api/v1/health.
- Locally: see the README's "Run locally" section (developer sign-in, no Supabase needed).
