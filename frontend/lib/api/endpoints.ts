import { apiClient } from "./client";
import {
  Workspace,
  Transaction,
  UdhaarRecord,
  Scenario,
  Recommendation,
  CreditReadiness,
  TaxPreview,
} from "@/types/domain";
import { DashboardData, SettlementPayload, UpdateTransactionPayload } from "@/types/api";

export const api = {
  getWorkspaces: () => apiClient<Workspace[]>("/api/workspaces"),

  getDashboard: (workspaceId: string) =>
    apiClient<DashboardData>(`/api/workspaces/${encodeURIComponent(workspaceId)}/dashboard`),

  getTransactions: (workspaceId: string) =>
    apiClient<Transaction[]>(`/api/workspaces/${encodeURIComponent(workspaceId)}/transactions`),

  importTransactions: (workspaceId: string, transactions: Array<Omit<Transaction, "id">>) =>
    apiClient<Transaction[]>(`/api/workspaces/${encodeURIComponent(workspaceId)}/transactions/import`, {
      method: "POST",
      body: JSON.stringify({ transactions }),
    }),

  updateTransaction: (transactionId: string, payload: UpdateTransactionPayload) =>
    apiClient<Transaction>(`/api/transactions/${encodeURIComponent(transactionId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  getUdhaar: (workspaceId: string) =>
    apiClient<UdhaarRecord[]>(`/api/workspaces/${encodeURIComponent(workspaceId)}/udhaar`),

  settleUdhaar: (udhaarId: string, payload: SettlementPayload) =>
    apiClient<{ record: UdhaarRecord; updatedBalancePaisa: string }>(
      `/api/udhaar/${encodeURIComponent(udhaarId)}/settlements`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),

  runScenario: (workspaceId: string, scenario: Scenario) =>
    apiClient<Scenario>(`/api/workspaces/${encodeURIComponent(workspaceId)}/scenarios`, {
      method: "POST",
      body: JSON.stringify(scenario),
    }),

  getReports: (workspaceId: string) =>
    apiClient<{
      recommendations: Recommendation[];
      creditReadiness: CreditReadiness;
      taxPreview: TaxPreview;
    }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/reports`),
};
