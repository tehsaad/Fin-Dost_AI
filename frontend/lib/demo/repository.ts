import {
  Workspace,
  Transaction,
  UdhaarRecord,
  Anomaly,
  Scenario,
  Recommendation,
  CreditReadiness,
  TaxPreview,
  Money,
  Forecast,
} from "@/types/domain";
import { DashboardData } from "@/types/api";
import {
  WORKSPACES,
  SME_STARTING_BALANCE,
  SME_TRANSACTIONS,
  SME_UDHAAR,
  SME_ANOMALIES,
  SME_SCENARIO,
  SME_RECOMMENDATIONS,
  SME_CREDIT_READINESS,
  SME_TAX_PREVIEW,
  STUDENT_STARTING_BALANCE,
  STUDENT_TRANSACTIONS,
  STUDENT_ANOMALIES,
  STUDENT_RECOMMENDATIONS,
  HOUSEHOLD_STARTING_BALANCE,
  HOUSEHOLD_TRANSACTIONS,
  HOUSEHOLD_ANOMALIES,
  HOUSEHOLD_RECOMMENDATIONS,
  ENTERPRISE_STARTING_BALANCE,
  ENTERPRISE_TRANSACTIONS,
  ENTERPRISE_UDHAAR,
  ENTERPRISE_ANOMALIES,
  ENTERPRISE_RECOMMENDATIONS,
  ENTERPRISE_CREDIT_READINESS,
  ENTERPRISE_TAX_PREVIEW,
} from "./fixtures";
import { computeDeterministicForecast, calculateRunwayDays } from "@/lib/domain/forecast";
import { addMoney, createMoneyFromPaisa, subtractMoney } from "@/lib/domain/money";

export interface WorkspaceStoreState {
  workspaces: Workspace[];
  transactions: Record<string, Transaction[]>;
  udhaar: Record<string, UdhaarRecord[]>;
  anomalies: Record<string, Anomaly[]>;
  scenarios: Record<string, Scenario>;
  recommendations: Record<string, Recommendation[]>;
  creditReadiness: Record<string, CreditReadiness>;
  taxPreviews: Record<string, TaxPreview>;
  startingBalances: Record<string, Money>;
}

// Initial state builder
export function getInitialStoreState(): WorkspaceStoreState {
  return {
    workspaces: WORKSPACES,
    transactions: {
      "sme-bilal": [...SME_TRANSACTIONS],
      "student-ayesha": [...STUDENT_TRANSACTIONS],
      "household-khan": [...HOUSEHOLD_TRANSACTIONS],
      "enterprise-indus": [...ENTERPRISE_TRANSACTIONS],
    },
    udhaar: {
      "sme-bilal": [...SME_UDHAAR],
      "student-ayesha": [],
      "household-khan": [],
      "enterprise-indus": [...ENTERPRISE_UDHAAR],
    },
    anomalies: {
      "sme-bilal": [...SME_ANOMALIES],
      "student-ayesha": [...STUDENT_ANOMALIES],
      "household-khan": [...HOUSEHOLD_ANOMALIES],
      "enterprise-indus": [...ENTERPRISE_ANOMALIES],
    },
    scenarios: {
      "sme-bilal": { ...SME_SCENARIO },
      "student-ayesha": {
        id: "scen-stu",
        workspaceId: "student-ayesha",
        title: "Semester Expense Scenario",
        description: "Examine effects of extra certification or exam fees.",
        shocks: [
          {
            id: "cert_fee",
            kind: "custom",
            label: "AWS / Cloud Certification Exam Fee",
            description: "One-off examination registration charge",
            amount: createMoneyFromPaisa("2500000"), // Rs. 25,000
            active: true,
          },
        ],
        recoveryActions: [
          {
            id: "tutoring_extra",
            label: "Take on 2 weekend tutoring students",
            description: "Additional monthly freelance teaching",
            estimatedImpact: createMoneyFromPaisa("1500000"), // Rs. 15,000
            active: false,
          },
        ],
        assumptions: ["Student budget model"],
      },
      "household-khan": {
        id: "scen-hh",
        workspaceId: "household-khan",
        title: "Household Inflation Buffer Test",
        description: "Assess family emergency fund buffer against fuel and utility tariffs.",
        shocks: [
          {
            id: "fuel_surge",
            kind: "price_rise",
            label: "Petrol price rise (+20%)",
            description: "Daily commute costs increase",
            percent: 20,
            active: true,
          },
          {
            id: "summer_bill",
            kind: "utility_spike",
            label: "Peak summer LESCO bill spike",
            description: "High slab summer AC units",
            amount: createMoneyFromPaisa("3500000"), // Rs. 35,000
            active: false,
          },
        ],
        recoveryActions: [
          {
            id: "defer_leisure",
            label: "Defer discretionary dining & shopping",
            description: "Pause restaurant and recreation budget",
            estimatedImpact: createMoneyFromPaisa("2500000"), // Rs. 25,000
            active: false,
          },
        ],
        assumptions: ["Household budget model"],
      },
      "enterprise-indus": {
        id: "scen-ent",
        workspaceId: "enterprise-indus",
        title: "Enterprise Export & Raw Material Stress Test",
        description: "Model impacts of raw cotton spikes and delayed export LC payments.",
        shocks: [
          {
            id: "cotton_surge",
            kind: "price_rise",
            label: "Raw Cotton Commodity Surge (+18%)",
            description: "Ginned cotton international price increase",
            percent: 18,
            active: true,
          },
          {
            id: "buyer_delay",
            kind: "delayed_receivables",
            label: "European Buyer LC Clearance Delayed 60 Days",
            description: "Port inspection hold on yarn consignment",
            amount: createMoneyFromPaisa("1200000000"), // Rs. 12,000,000
            delayDays: 60,
            active: true,
          },
        ],
        recoveryActions: [
          {
            id: "trade_factoring",
            label: "Invoice Discounting via Bank (Factoring)",
            description: "Discount domestic receivables at 8% bank margin",
            estimatedImpact: createMoneyFromPaisa("800000000"), // Rs. 8,000,000
            active: false,
          },
        ],
        assumptions: ["Enterprise balance sheet model"],
      },
    },
    recommendations: {
      "sme-bilal": [...SME_RECOMMENDATIONS],
      "student-ayesha": [...STUDENT_RECOMMENDATIONS],
      "household-khan": [...HOUSEHOLD_RECOMMENDATIONS],
      "enterprise-indus": [...ENTERPRISE_RECOMMENDATIONS],
    },
    creditReadiness: {
      "sme-bilal": { ...SME_CREDIT_READINESS },
      "student-ayesha": {
        workspaceId: "student-ayesha",
        overallScore: 65,
        factors: [
          { name: "Consistent Income Inflow", score: 68, weight: 40, status: "moderate", details: "Regular monthly allowance and tutoring deposits." },
          { name: "Emergency Buffer", score: 60, weight: 30, status: "moderate", details: "Current balance covers 3-4 months of student costs." },
          { name: "Zero Debt Record", score: 95, weight: 30, status: "good", details: "No active overdraft or borrowing." },
        ],
        isShariahCompliantWording: true,
        disclaimer: "Student Financial Discipline Score. Not a formal credit rating.",
      },
      "household-khan": {
        workspaceId: "household-khan",
        overallScore: 74,
        factors: [
          { name: "Debt-to-Income Stability", score: 80, weight: 35, status: "good", details: "Zero consumer loan liabilities." },
          { name: "Utility Payment Track Record", score: 88, weight: 30, status: "good", details: "Clean billing history on LESCO and SNGPL meters." },
          { name: "Savings Rate", score: 58, weight: 35, status: "moderate", details: "Current savings rate is 15.7% of gross salary." },
        ],
        isShariahCompliantWording: true,
        disclaimer: "Household Financial Health Index.",
      },
      "enterprise-indus": { ...ENTERPRISE_CREDIT_READINESS },
    },
    taxPreviews: {
      "sme-bilal": { ...SME_TAX_PREVIEW },
      "student-ayesha": {
        workspaceId: "student-ayesha",
        taxYear: "TY 2026-2027",
        estimatedGrossInflow: createMoneyFromPaisa("54000000"), // Rs. 540,000
        totalExpenses: createMoneyFromPaisa("45840000"),
        deductibleExpenses: createMoneyFromPaisa("0"),
        estimatedTaxableIncome: createMoneyFromPaisa("0"),
        illustrativeEstimatedTax: createMoneyFromPaisa("0"),
        deductibleCategories: [],
        disclaimer: "Below taxable threshold of Rs. 600,000 under Income Tax Ordinance. Preliminary Estimate — FBR Validation Required.",
      },
      "household-khan": {
        workspaceId: "household-khan",
        taxYear: "TY 2026-2027",
        estimatedGrossInflow: createMoneyFromPaisa("420000000"), // Rs. 4,200,000 annual
        totalExpenses: createMoneyFromPaisa("354000000"),
        deductibleExpenses: createMoneyFromPaisa("88800000"), // school tuition & withholding
        estimatedTaxableIncome: createMoneyFromPaisa("331200000"),
        illustrativeEstimatedTax: createMoneyFromPaisa("34200000"), // Salaried slab tax
        deductibleCategories: [
          {
            category: "School Fee Advance Tax (Sec 60D)",
            spent: createMoneyFromPaisa("88800000"),
            deductiblePercentage: 100,
            deductibleAmount: createMoneyFromPaisa("88800000"),
            note: "Advance tax paid on children's education challan adjustable against final liability.",
          },
        ],
        disclaimer: "Preliminary Estimate — FBR Validation Required. Salaried tax calculation assumes full filing documentation.",
      },
      "enterprise-indus": { ...ENTERPRISE_TAX_PREVIEW },
    },
    startingBalances: {
      "sme-bilal": SME_STARTING_BALANCE,
      "student-ayesha": STUDENT_STARTING_BALANCE,
      "household-khan": HOUSEHOLD_STARTING_BALANCE,
      "enterprise-indus": ENTERPRISE_STARTING_BALANCE,
    },
  };
}

/**
 * Computes live dashboard data from state
 */
export function getLiveDashboardData(
  state: WorkspaceStoreState,
  workspaceId: string
): DashboardData {
  const workspace = state.workspaces.find((w) => w.id === workspaceId) || state.workspaces[0];
  const txs = state.transactions[workspaceId] || [];
  const udhaarRecords = state.udhaar[workspaceId] || [];
  const anomalies = state.anomalies[workspaceId] || [];
  const startBal = state.startingBalances[workspaceId] || createMoneyFromPaisa("0");

  let monthlyInflowPaisa = 0n;
  let monthlyOutflowPaisa = 0n;

  for (const tx of txs) {
    const amt = BigInt(tx.amount.amountPaisa);
    if (tx.direction === "inflow") {
      monthlyInflowPaisa += amt;
    } else {
      monthlyOutflowPaisa += amt;
    }
  }

  let totalOutstandingUdhaarPaisa = 0n;
  let overdueUdhaarCount = 0;

  for (const ud of udhaarRecords) {
    if (ud.status !== "settled") {
      const amt = BigInt(ud.outstanding.amountPaisa);
      totalOutstandingUdhaarPaisa += amt;
      if (ud.status === "overdue") {
        overdueUdhaarCount++;
      }
    }
  }

  const monthlyInflow = createMoneyFromPaisa(monthlyInflowPaisa);
  const monthlyOutflow = createMoneyFromPaisa(monthlyOutflowPaisa);
  const netBalance = addMoney(startBal, subtractMoney(monthlyInflow, monthlyOutflow));

  const runwayDays = calculateRunwayDays(netBalance, monthlyOutflow, monthlyInflow);
  const forecast = computeDeterministicForecast(workspaceId, netBalance, txs);

  return {
    workspace,
    kpis: {
      netBalance: netBalance.amountPaisa,
      runwayDays,
      monthlyOutflow: monthlyOutflow.amountPaisa,
      monthlyInflow: monthlyInflow.amountPaisa,
      totalOutstandingUdhaar: totalOutstandingUdhaarPaisa.toString(),
      overdueUdhaarCount,
    },
    forecast,
    anomalies,
    recentTransactions: txs.slice(0, 10),
    freshnessTimestamp: "Just now (Local demo engine)",
  };
}
