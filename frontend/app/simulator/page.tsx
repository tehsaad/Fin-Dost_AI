"use client";

import React, { useMemo } from "react";
import { useApp } from "@/lib/state/store";
import { ScenarioControls } from "@/components/simulator/scenario-controls";
import { ScenarioChart } from "@/components/simulator/scenario-chart";
import { RecoveryLevers } from "@/components/simulator/recovery-levers";
import { runDeterministicSimulation } from "@/lib/domain/scenarios";
import { createMoneyFromPaisa, formatMoney } from "@/lib/domain/money";
import { Button } from "@/components/shared/button";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import { RotateCcw, AlertTriangle, ShieldCheck, CheckCircle2, Info } from "lucide-react";

export default function SimulatorPage() {
  const {
    activeWorkspace,
    dashboardData,
    scenario,
    toggleShock,
    toggleRecovery,
    resetScenario,
  } = useApp();

  const startingBalance = useMemo(
    () => createMoneyFromPaisa(dashboardData.kpis.netBalance),
    [dashboardData.kpis.netBalance]
  );
  const monthlyOutflow = useMemo(
    () => createMoneyFromPaisa(dashboardData.kpis.monthlyOutflow),
    [dashboardData.kpis.monthlyOutflow]
  );
  const monthlyInflow = useMemo(
    () => createMoneyFromPaisa(dashboardData.kpis.monthlyInflow),
    [dashboardData.kpis.monthlyInflow]
  );

  const simulation = useMemo(() => {
    return runDeterministicSimulation(
      startingBalance,
      monthlyOutflow,
      monthlyInflow,
      scenario.shocks,
      scenario.recoveryActions
    );
  }, [startingBalance, monthlyOutflow, monthlyInflow, scenario]);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {scenario.title}
            </h2>
            <Badge variant="outline">Deterministic Shock Engine</Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {scenario.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={resetScenario}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Reset Scenarios
          </Button>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs text-slate-500 mb-1 flex items-center justify-between">
            <span>Total Shock Pressure (90d)</span>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <div className="text-lg font-bold text-red-700 dark:text-red-400">
            -{formatMoney(simulation.totalShockImpact)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Active shocks inflating daily cash burn
          </div>
        </div>

        <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs text-slate-500 mb-1 flex items-center justify-between">
            <span>Recovery Interventions</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
            +{formatMoney(simulation.totalRecoveryImpact)}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            Collections & deferred capital outlay
          </div>
        </div>

        <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs text-slate-500 mb-1 flex items-center justify-between">
            <span>Net 90-Day Solvency Status</span>
            {simulation.isSolvent ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600" />
            )}
          </div>
          <div className="text-lg font-bold">
            {simulation.isSolvent ? (
              <span className="text-emerald-700 dark:text-emerald-400">Solvent & Resilient</span>
            ) : (
              <span className="text-red-700 dark:text-red-400">Shortage Gap Projected</span>
            )}
          </div>
          <div className="text-[10px] text-slate-400 mt-1">
            {simulation.isSolvent
              ? "Cash buffer absorbs all selected shocks"
              : `Deficit on ${simulation.shortageDate}`}
          </div>
        </div>
      </div>

      {/* Projection Chart */}
      <ScenarioChart simulation={simulation} />

      {/* Controls Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ScenarioControls
          shocks={scenario.shocks}
          onToggleShock={toggleShock}
        />
        <RecoveryLevers
          recoveries={scenario.recoveryActions}
          onToggleRecovery={toggleRecovery}
          isSolvent={simulation.isSolvent}
        />
      </div>

      {/* Assumptions Footer */}
      <div className="p-4 rounded-lg bg-slate-100/60 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
        <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
          <Info className="w-4 h-4 text-slate-500" />
          Model Assumptions & Inspectable Formulas
        </div>
        <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
          {scenario.assumptions.map((ass, i) => (
            <li key={i}>{ass}</li>
          ))}
          <li>
            Daily run rates are computed deterministically from verified 30-day verified ledger transactions. No stochastic black-box simulation.
          </li>
        </ul>
      </div>
    </div>
  );
}
