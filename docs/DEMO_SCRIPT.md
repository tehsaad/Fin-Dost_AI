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
- Show the health index and the top risks: big supplier payable and rent due, overdue udhaar from regular customers.
- "Profit isn't the problem — timing is."

## 1:50 – 2:30 · Why (Forecast + Alerts)
- **Forecast:** the 30-day line with its uncertainty band; open the drivers — receivables weighted by age and each
  customer's usual delay, detected monthly bills, the weekday sales pattern. The model was picked by backtesting
  on the shop's own past weeks.
- **Alerts:** shortage, overdue receivables, customer concentration, an unusual/duplicate entry. Severity is urgency,
  not probability.

## 2:30 – 3:15 · Stress test (Shock simulator)
- Click **Sales fall 20% for 3 weeks** → baseline vs shocked path; the shortage arrives earlier and deeper.
- Optionally stack **Top 3 customers pay 30 days late**. Save the scenario.

## 3:15 – 4:00 · Recovery plan
- Note: options are simulations — nothing is marked as collected or paid until you record it in the Khata.
- Open **Recovery**: ranked actions generated from this shop's data — collect specific udhaar, ask for part payments,
  defer a supplier payment, cut discretionary spend, sell slow stock.
- Each shows the cash effect and how it moves the shortage date; the combined plan removes the shortage.
- From **Khata → Receivables**, open a WhatsApp reminder (pre-filled English/Urdu message).

## 4:00 – 4:30 · Copilot in Urdu
- Ask **"Can I afford Rs. 50,000 next week?"** → a grounded yes/no with the lowest balance and date.
- Ask **"Explain my dashboard in simple Urdu"** → Urdu summary with the exact same figures.

## 4:30 – 5:00 · Breadth and impact
- **Import:** upload the messy sample CSV → dates, amounts and categories normalised, duplicates flagged; fix a
  rejected row with the pencil, then import. **Reports → CSV** downloads the same figures shown on screen.
- Sign out, open a **Student** private demo → a smaller budget app with no inventory module; `/inventory` says it's not part
  of this account type.
- **Impact:** on a held-out synthetic benchmark of 120 businesses, the forecast catches **96%** of shortages within
  14 days with about **8 days** of warning. A naive "cash minus bills" rule catches them all too, but wrongly warns
  **31%** of healthy businesses; FinDost wrongly warns **8%**. Say clearly that the data is synthetic. Close on SDG 1, 8 and 9.

## Backup plan
- If live login is slow, the API health check is https://findost-api.vercel.app/api/v1/health.
- Locally: see the README's "Run locally" section (developer sign-in, no Supabase needed).
