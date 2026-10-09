"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
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
} from "@/types/domain";
import { DashboardData } from "@/types/api";
import {
  WorkspaceStoreState,
  getInitialStoreState,
  getLiveDashboardData,
} from "@/lib/demo/repository";
import { addMoney, createMoneyFromPaisa, subtractMoney } from "@/lib/domain/money";
import { api } from "@/lib/api/endpoints";

interface AppContextType {
  // Mode & connection
  isDemoMode: boolean;
  setDemoMode: (val: boolean) => void;
  apiStatus: "connected" | "offline" | "checking";
  checkApiConnection: () => Promise<void>;

  // Workspaces
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  activeWorkspaceId: string;
  setActiveWorkspaceId: (id: string) => void;

  // Live Data for active workspace
  dashboardData: DashboardData;
  transactions: Transaction[];
  udhaarRecords: UdhaarRecord[];
  anomalies: Anomaly[];
  scenario: Scenario;
  recommendations: Recommendation[];
  creditReadiness: CreditReadiness;
  taxPreview: TaxPreview;

  // Actions
  editTransaction: (
    id: string,
    updates: { merchant?: string; category?: string; amountRupees?: string; note?: string }
  ) => void;
  importTransactions: (newTxs: Array<Omit<Transaction, "id">>) => void;
  settleUdhaar: (id: string, amountPaisa: string, note?: string) => { settledAmountPaisa: string };
  toggleShock: (shockId: string) => void;
  toggleRecovery: (recoveryId: string) => void;
  resetScenario: () => void;
  toggleShariahWording: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<WorkspaceStoreState>(getInitialStoreState);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("sme-bilal");
  const [isDemoMode, setDemoMode] = useState<boolean>(true);
  const [apiStatus, setApiStatus] = useState<"connected" | "offline" | "checking">("checking");

  // Check backend availability on mount
  const checkApiConnection = useCallback(async () => {
    try {
      setApiStatus("checking");
      await api.getWorkspaces();
      setApiStatus("connected");
      // If connected and user hasn't explicitly locked demo mode, can use API
    } catch {
      setApiStatus("offline");
      setDemoMode(true); // Default to demo mode if backend is offline
    }
  }, []);

  useEffect(() => {
    checkApiConnection();
  }, [checkApiConnection]);

  const activeWorkspace = useMemo(() => {
    return (
      store.workspaces.find((w) => w.id === activeWorkspaceId) || store.workspaces[0]
    );
  }, [store.workspaces, activeWorkspaceId]);

  // Derive live computed dashboard data
  const dashboardData = useMemo(() => {
    return getLiveDashboardData(store, activeWorkspaceId);
  }, [store, activeWorkspaceId]);

  const transactions = useMemo(() => {
    return store.transactions[activeWorkspaceId] || [];
  }, [store.transactions, activeWorkspaceId]);

  const udhaarRecords = useMemo(() => {
    return store.udhaar[activeWorkspaceId] || [];
  }, [store.udhaar, activeWorkspaceId]);

  const anomalies = useMemo(() => {
    return store.anomalies[activeWorkspaceId] || [];
  }, [store.anomalies, activeWorkspaceId]);

  const scenario = useMemo(() => {
    return store.scenarios[activeWorkspaceId];
  }, [store.scenarios, activeWorkspaceId]);

  const recommendations = useMemo(() => {
    return store.recommendations[activeWorkspaceId] || [];
  }, [store.recommendations, activeWorkspaceId]);

  const creditReadiness = useMemo(() => {
    return store.creditReadiness[activeWorkspaceId];
  }, [store.creditReadiness, activeWorkspaceId]);

  const taxPreview = useMemo(() => {
    return store.taxPreviews[activeWorkspaceId];
  }, [store.taxPreviews, activeWorkspaceId]);

  // Action: Edit transaction with audit preservation
  const editTransaction = useCallback(
    (
      id: string,
      updates: { merchant?: string; category?: string; amountRupees?: string; note?: string }
    ) => {
      setStore((prev) => {
        const currentList = prev.transactions[activeWorkspaceId] || [];
        const updatedList = currentList.map((tx) => {
          if (tx.id !== id) return tx;

          const originalMerchant = tx.originalMerchant ?? tx.merchant;
          const originalCategory = tx.originalCategory ?? tx.category;
          const originalAmount = tx.originalAmount ?? tx.amount;

          let newAmount = tx.amount;
          if (updates.amountRupees !== undefined && updates.amountRupees.trim() !== "") {
            const cleanNum = updates.amountRupees.replace(/,/g, "");
            const paisa = BigInt(Math.round(parseFloat(cleanNum) * 100));
            newAmount = createMoneyFromPaisa(paisa);
          }

          return {
            ...tx,
            merchant: updates.merchant ?? tx.merchant,
            category: updates.category ?? tx.category,
            amount: newAmount,
            confidence: 1.0, // Marked as verified by human review
            reviewStatus: "confirmed" as const,
            isEdited: true,
            originalMerchant,
            originalCategory,
            originalAmount,
            correctionNote: updates.note ?? "User manually corrected low-confidence extraction",
          };
        });

        return {
          ...prev,
          transactions: {
            ...prev.transactions,
            [activeWorkspaceId]: updatedList,
          },
        };
      });
    },
    [activeWorkspaceId]
  );

  // Action: Import new transactions (e.g. from receipt review or sample import)
  const importTransactions = useCallback(
    (newTxs: Array<Omit<Transaction, "id">>) => {
      setStore((prev) => {
        const currentList = prev.transactions[activeWorkspaceId] || [];
        const timestamp = Date.now();
        const constructed: Transaction[] = newTxs.map((t, idx) => ({
          ...t,
          id: `tx-imp-${timestamp}-${idx}`,
          workspaceId: activeWorkspaceId,
        }));

        return {
          ...prev,
          transactions: {
            ...prev.transactions,
            [activeWorkspaceId]: [...constructed, ...currentList],
          },
        };
      });
    },
    [activeWorkspaceId]
  );

  // Action: Settle Udhaar (full or partial)
  const settleUdhaar = useCallback(
    (id: string, amountPaisa: string, note?: string) => {
      // Compute the settled amount from current state up front: state updaters
      // run lazily, so a value assigned inside one is not ready when we return.
      const current = (store.udhaar[activeWorkspaceId] || []).find((r) => r.id === id);
      if (!current) return { settledAmountPaisa: "0" };
      const outstandingNow = BigInt(current.outstanding.amountPaisa);
      const requested = BigInt(amountPaisa);
      const settledPaisa = (requested >= outstandingNow ? outstandingNow : requested).toString();

      setStore((prev) => {
        const records = prev.udhaar[activeWorkspaceId] || [];
        const recordIndex = records.findIndex((r) => r.id === id);
        if (recordIndex === -1) return prev;

        const target = records[recordIndex];
        const currentOutstanding = BigInt(target.outstanding.amountPaisa);
        const settleAttempt = BigInt(settledPaisa);
        const actualSettle = settleAttempt >= currentOutstanding ? currentOutstanding : settleAttempt;
        const remainingPaisa = currentOutstanding - actualSettle;

        const updatedRecord: UdhaarRecord = {
          ...target,
          outstanding: createMoneyFromPaisa(remainingPaisa),
          status: remainingPaisa === 0n ? "settled" : target.status,
          notes: note ? `${target.notes ?? ""} | Settled Rs. ${Number(actualSettle / 100n).toLocaleString()}: ${note}` : target.notes,
        };

        const updatedList = [...records];
        updatedList[recordIndex] = updatedRecord;

        // Add a corresponding inflow transaction in demo state so cash balance increases
        const inflowTx: Transaction = {
          id: `tx-settle-${Date.now()}`,
          workspaceId: activeWorkspaceId,
          occurredAt: new Date().toISOString().split("T")[0],
          merchant: `Udhaar Recovery: ${target.customerName}`,
          amount: createMoneyFromPaisa(actualSettle),
          direction: "inflow",
          category: "Debt Recovery",
          confidence: 1.0,
          reviewStatus: "confirmed",
          sourceRef: `REC-${target.sourceRef ?? "UDHAAR"}`,
        };

        const currentTxs = prev.transactions[activeWorkspaceId] || [];

        return {
          ...prev,
          udhaar: {
            ...prev.udhaar,
            [activeWorkspaceId]: updatedList,
          },
          transactions: {
            ...prev.transactions,
            [activeWorkspaceId]: [inflowTx, ...currentTxs],
          },
        };
      });

      return { settledAmountPaisa: settledPaisa };
    },
    [activeWorkspaceId, store.udhaar]
  );

  // Action: Toggle Shock
  const toggleShock = useCallback(
    (shockId: string) => {
      setStore((prev) => {
        const sc = prev.scenarios[activeWorkspaceId];
        if (!sc) return prev;
        const updatedShocks = sc.shocks.map((s) =>
          s.id === shockId ? { ...s, active: !s.active } : s
        );
        return {
          ...prev,
          scenarios: {
            ...prev.scenarios,
            [activeWorkspaceId]: { ...sc, shocks: updatedShocks },
          },
        };
      });
    },
    [activeWorkspaceId]
  );

  // Action: Toggle Recovery Lever
  const toggleRecovery = useCallback(
    (recoveryId: string) => {
      setStore((prev) => {
        const sc = prev.scenarios[activeWorkspaceId];
        if (!sc) return prev;
        const updatedRecoveries = sc.recoveryActions.map((r) =>
          r.id === recoveryId ? { ...r, active: !r.active } : r
        );
        return {
          ...prev,
          scenarios: {
            ...prev.scenarios,
            [activeWorkspaceId]: { ...sc, recoveryActions: updatedRecoveries },
          },
        };
      });
    },
    [activeWorkspaceId]
  );

  // Action: Reset scenario
  const resetScenario = useCallback(() => {
    const initialState = getInitialStoreState();
    setStore((prev) => ({
      ...prev,
      scenarios: {
        ...prev.scenarios,
        [activeWorkspaceId]: initialState.scenarios[activeWorkspaceId],
      },
    }));
  }, [activeWorkspaceId]);

  // Action: Toggle Shariah-compliant wording
  const toggleShariahWording = useCallback(() => {
    setStore((prev) => {
      const cr = prev.creditReadiness[activeWorkspaceId];
      if (!cr) return prev;
      return {
        ...prev,
        creditReadiness: {
          ...prev.creditReadiness,
          [activeWorkspaceId]: {
            ...cr,
            isShariahCompliantWording: !cr.isShariahCompliantWording,
          },
        },
      };
    });
  }, [activeWorkspaceId]);

  const contextValue = useMemo<AppContextType>(
    () => ({
      isDemoMode,
      setDemoMode,
      apiStatus,
      checkApiConnection,
      workspaces: store.workspaces,
      activeWorkspace,
      activeWorkspaceId,
      setActiveWorkspaceId,
      dashboardData,
      transactions,
      udhaarRecords,
      anomalies,
      scenario,
      recommendations,
      creditReadiness,
      taxPreview,
      editTransaction,
      importTransactions,
      settleUdhaar,
      toggleShock,
      toggleRecovery,
      resetScenario,
      toggleShariahWording,
    }),
    [
      isDemoMode,
      apiStatus,
      checkApiConnection,
      store.workspaces,
      activeWorkspace,
      activeWorkspaceId,
      dashboardData,
      transactions,
      udhaarRecords,
      anomalies,
      scenario,
      recommendations,
      creditReadiness,
      taxPreview,
      editTransaction,
      importTransactions,
      settleUdhaar,
      toggleShock,
      toggleRecovery,
      resetScenario,
      toggleShariahWording,
    ]
  );

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
