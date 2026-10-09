import type { Anomaly, Forecast, Transaction, Workspace } from "./domain";

/** KPI amounts are integer paisa strings, matching Money.amountPaisa. */
export interface DashboardKpis {
  netBalance: string;
  runwayDays: number;
  monthlyOutflow: string;
  monthlyInflow: string;
  totalOutstandingUdhaar: string;
  overdueUdhaarCount: number;
}

export interface DashboardData {
  workspace: Workspace;
  kpis: DashboardKpis;
  forecast: Forecast;
  anomalies: Anomaly[];
  recentTransactions: Transaction[];
  freshnessTimestamp: string;
}

export interface SettlementPayload {
  amountPaisa: string;
  note?: string;
}

export interface UpdateTransactionPayload {
  merchant?: string;
  category?: string;
  amountPaisa?: string;
  note?: string;
}
