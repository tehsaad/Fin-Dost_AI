import type { Kind } from "./types";

/** Wording per account type. Personal accounts (student, household) never see shop or supplier language. */
export interface Terms {
  personal: boolean;
  dashboard: string;
  ledger: string;
  forecast: string;
  forecastDescription: string;
  alerts: string;
  alertsDescription: string;
  simulator: string;
  simulatorDescription: string;
  recovery: string;
  recoveryDescription: string;
  reports: string;
  payables: string;
  income: string;
}

const BUSINESS: Terms = {
  personal: false,
  dashboard: "Command Center",
  ledger: "Digital Khata",
  forecast: "Cash Forecast",
  forecastDescription: "Daily projected balance built from your recorded bills and invoices, detected monthly patterns and a back-tested model of everyday sales and spending.",
  alerts: "Risk & Alerts",
  alertsDescription: "Explainable rules over your ledger and forecast, prioritised by urgency.",
  simulator: "Shock Simulator",
  simulatorDescription: "Stress-test your cash against real-world shocks and what-if decisions on the same engine as the forecast.",
  recovery: "Recovery",
  recoveryDescription: "Options generated from your own records — overdue invoices, upcoming bills, spending and stock — each priced by re-running the forecast.",
  reports: "Reports",
  payables: "Bills & payables",
  income: "Revenue",
};

const ENTERPRISE: Terms = {
  ...BUSINESS,
  dashboard: "Financial Overview",
  ledger: "Transactions & AR/AP",
  forecast: "Cash Forecast",
  alerts: "Risks & Alerts",
  simulator: "Scenario Simulation",
  recovery: "Recovery Plans",
};

const PERSONAL: Terms = {
  personal: true,
  dashboard: "My Money",
  ledger: "Income & Expenses",
  forecast: "Personal Cash Forecast",
  forecastDescription: "Your projected balance day by day, from your recorded bills, monthly income patterns (salary, allowance) and everyday spending.",
  alerts: "Budget Warnings",
  alertsDescription: "Warnings from your own records: bills you may not cover, overspending and unusual expenses.",
  simulator: "What-if Planner",
  simulatorDescription: "See what happens to your money if income arrives late, drops, or an unexpected expense comes up.",
  recovery: "Spending Adjustment Plan",
  recoveryDescription: "Ways to avoid running short — moving a bill, cutting optional spending, postponing purchases — each priced on your own forecast.",
  reports: "Monthly Summary",
  payables: "Bills",
  income: "Income",
};

export function termsFor(kind: Kind): Terms {
  if (kind === "student" || kind === "household") return PERSONAL;
  return kind === "enterprise" ? ENTERPRISE : BUSINESS;
}
