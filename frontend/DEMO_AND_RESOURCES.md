# FinDost AI — Demo & Resources Guide

> **AICON'26 Build With AI Competition Documentation**  
> Product: FinDost AI (Financial Operations Assistant for Pakistan)  
> Stack: Next.js 15 (App Router), TypeScript, Tailwind CSS, Recharts, Lucide Icons  
> Evaluation Target: Coherent, inspectable demo running offline or with local FastAPI backend.

---

## 1. Executive Summary & Problem Chain

FinDost AI addresses the critical working capital, cash-flow blindness, and uncollected debt (Udhaar) challenges faced by Pakistani micro-entrepreneurs, salaried households, students, and enterprises.

```
Real Financial Operations Problem
  ↓ (Cash flow volatility, uncollected khata credit, blurred paper receipts)
Synthetic / Authorized Input
  ↓ (Urdu/English receipt scans, bank statement PDFs, B2B khata ledgers)
AI-Supported Extraction & Anomaly Detection
  ↓ (OCR field confidence tags, outlier spikes, price hike alerts)
Human-in-the-Loop Audit & Verification
  ↓ (Operator inline review corrects uncertain fields; audit log retained)
Deterministic Computation & Actionable Impact
  ↓ (Exact BigInt paisa math updates 90-day runway curve & closes shortage gaps)
```

---

## 2. Personas & Synthetic Datasets

All records in FinDost AI are **100% fictional, synthetic, and privacy-safe**. No real consumer accounts, CNICs, or proprietary bank statements are used.

| Persona | Kind | Key Realities Modeled | Starting Balance | Features Enabled |
| :--- | :--- | :--- | :--- | :--- |
| **Bilal General Store** *(Hero Demo)* | **SME / Kiryana** | FMCG wholesale restock, LESCO power, customer Udhaar, supplier tariff hikes | **Rs. 420,000** | Dashboard, Ingestion Review, Udhaar Manager, Shock Simulator, Reports |
| **Ayesha Noor** | **Student** | FAST hostel mess dues, family allowance, freelance programming tutoring | **Rs. 28,500** | Dashboard, Ingestion Review, Shock Simulator, Reports |
| **Khan Family** | **Household** | Salaried income, school tuition fee challans, domestic LESCO/SNGPL utilities | **Rs. 185,000** | Dashboard, Ingestion Review, Shock Simulator, Reports, Tax Preview |
| **Indus Textiles Ltd.** | **Enterprise** | Spinning & weaving roll-up across Lahore, Faisalabad, Karachi; export LCs | **Rs. 14,800,000** | Multi-branch Dashboard, Ingestion, Corporate Receivables, Simulator, Reports |

---

## 3. The 5 Core MVP Routes & Hero Demonstration Flow

### Route 1: `/dashboard` — Executive Cash Flow Overview
- **Exact Working Capital Metrics**: Net balance formatted as comma-grouped Pakistani Rupees (`Rs. 420,000`) and scale summary (`4.2 Lakh PKR`).
- **30-Day Cash Runway**: Shows survival days at current net drain rate.
- **Recharts Cash-Flow Forecast**: Historical baseline and 90-day trajectory with clearly marked P10 (conservative) and P90 (favorable) illustrative run-rate envelopes.
- **Operational Risk Anomalies**: Spikes, supplier price changes, and overdue Udhaar alerts with direct links to supporting evidence.

### Route 2: `/upload` — Ingestion & Review Station
- **Drag & Drop Affordance**: Accepts `.jpg`, `.png`, `.pdf`, `.csv`, `.xlsx` up to 10MB with validation.
- **Sample Ingestion Engine**: Click *"Load Demo Batch (FMCG Sample)"* to observe multi-stage simulated parsing.
- **Human-in-the-Loop Review Station**: 
  - Highlights row `SCAN-RECEIPT-4029.jpg` with low OCR confidence (`62%`, *Needs Review*).
  - Click **Review** to edit merchant name, category, or amount.
  - Saving the edit updates confidence to `100% (Audited)`, logs a before/after audit trail, and **immediately recomputes the dashboard cash-flow forecast and runway!**

### Route 3: `/udhaar` — Customer Receivables & Debt Recovery *(SME & Enterprise)*
- **Customer Khata Ledger**: Lists debtors (e.g. Tariq Caterers, Butt Sweets) with aging buckets (`30d`, `60d`, `90d+`) and physical leaf references (`KATA-LEAF-041`).
- **“What If I Collect?” Interactive Calculator**: 
  - Select debtors to simulate collecting Rs. 150,000.
  - Dynamically computes added runway days (`+38 Days`) using inspectable daily-drain formulas.
- **FIFO Settlement Drawer**: Supports full or partial cash recovery, automatically crediting the business cash balance and updating the ledger.
- *For Student & Household personas, this route gracefully displays an informative role-boundary notice.*

### Route 4: `/simulator` — Deterministic Shock Simulator
- **Stress-Test Presets**:
  - *Supplier Wholesale Price Rise (+15%)*
  - *Top 3 Overdue Customers Delay by 45 Days*
  - *Summer Electricity Spike*
- **Shortage Line & Breach Date**: Plots stressed trajectory against a 0 PKR liquidity breach threshold.
- **Managerial Recovery Levers**: Click *"Collect Top 3 Receivables"* or *"Defer Discretionary Bulk Stock Purchase"* to observe immediate deficit gap closure and recovery of solvency.

### Route 5: `/reports` — Grounded Evidence, Credit Health & Tax Preview
- **Actionable Recommendations**: 3–5 recommendations with exact PKR impact, plain-language reason, and time horizon.
- **Evidence Modal**: Click *"Inspect Evidence"* to trace any recommendation back to contributing synthetic invoice filenames and ledger rows.
- **Credit Readiness Assessment**: 0–100 score across 4 pillars, equipped with a **Shariah Terminology Toggle** adapting vocabulary to Islamic Murabaha/Musawamah criteria.
- **Pakistan Tax & Withholding Preview**: Categorizes deductible expenses under the FBR Income Tax Ordinance, displaying mandatory **“Preliminary Estimate — FBR Validation Required”** disclaimers.
- **Export PDF Report**: Click *"Export PDF Report"* to generate a clean, executive print-ready PDF using standard browser print dialog.

---

## 4. Architectural Guarantees & Integrity Rules

1. **Exact BigInt Financial Arithmetic (`lib/domain/money.ts`)**:
   - All amounts are stored internally as integer paisa strings (1 PKR = 100 Paisa).
   - Zero IEEE-754 floating point imprecision (`0.1 + 0.2` drift is strictly eliminated).
2. **Transparent AI Labelling**:
   - Deterministic calculations are labeled as such.
   - P10/P90 projection envelopes and credit scores carry explicit non-certified methodology notices.
   - No mock claims of connected cloud OCR when running standalone.
3. **No Leaked Browser Credentials**:
   - Zero database service keys or Supabase secrets in client bundles.
   - API client connects via configurable `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`).
   - Graceful offline fallback: if backend is unreachable, app runs 100% of features locally via demo fixtures.

---

## 5. Verification & Testing

Run the included verification checks:

```bash
# 1. Typecheck the entire codebase
npm run typecheck

# 2. Run deterministic financial math unit checks
node scripts/verify-financial-math.mjs

# 3. Compile optimized production build
npm run build

# 4. Start production server
npm run start
```
