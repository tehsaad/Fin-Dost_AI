import { Money, Scenario, ScenarioShock, RecoveryAction, ForecastPoint } from "@/types/domain";
import { addMoney, createMoneyFromPaisa, createMoneyFromRupees, isNegativeMoney, multiplyMoneyPercent, subtractMoney } from "./money";

export interface SimulationResult {
  points: Array<{
    date: string;
    day: number;
    baselineRupees: number;
    simulatedRupees: number;
  }>;
  shortageDate: string | null;
  shortageGap: Money;
  isSolvent: boolean;
  totalShockImpact: Money;
  totalRecoveryImpact: Money;
  netImpact: Money;
}

export function runDeterministicSimulation(
  startingBalance: Money,
  monthlyOutflow: Money,
  monthlyInflow: Money,
  shocks: ScenarioShock[],
  recoveries: RecoveryAction[]
): SimulationResult {
  const dailyOutflowBase = BigInt(monthlyOutflow.amountPaisa) / 30n;
  const dailyInflowBase = BigInt(monthlyInflow.amountPaisa) / 30n;

  // Calculate active shocks impact
  let dailyOutflowShockPaisa = 0n;
  let delayedInflowPaisa = 0n;
  let fixedOneTimeOutflowPaisa = 0n;

  for (const shock of shocks) {
    if (!shock.active) continue;

    if (shock.kind === "price_rise" && shock.percent) {
      // Outflows increase by percent (e.g. +15% supplier inflation)
      dailyOutflowShockPaisa += (dailyOutflowBase * BigInt(Math.round(shock.percent * 100))) / 10000n;
    } else if (shock.kind === "utility_spike" && shock.amount) {
      // Monthly utility spike divided across 30 days
      dailyOutflowShockPaisa += BigInt(shock.amount.amountPaisa) / 30n;
    } else if (shock.kind === "delayed_receivables" && shock.amount) {
      // Delayed receivables: funds won't arrive until after delayDays
      delayedInflowPaisa += BigInt(shock.amount.amountPaisa);
    } else if (shock.amount) {
      fixedOneTimeOutflowPaisa += BigInt(shock.amount.amountPaisa);
    }
  }

  // Calculate active recoveries impact
  let dailyOutflowRecoveryPaisa = 0n;
  let upfrontRecoveryInflowPaisa = 0n;

  for (const recovery of recoveries) {
    if (!recovery.active) continue;

    if (recovery.id === "defer_stock") {
      // Reduces daily outflow (saving 20% of purchases)
      dailyOutflowRecoveryPaisa += (dailyOutflowBase * 20n) / 100n;
    } else if (recovery.id === "collect_udhaar" || recovery.id === "collect_receivables") {
      // Immediate upfront recovery cash injection
      upfrontRecoveryInflowPaisa += BigInt(recovery.estimatedImpact.amountPaisa);
    } else {
      upfrontRecoveryInflowPaisa += BigInt(recovery.estimatedImpact.amountPaisa);
    }
  }

  const effectiveDailyOutflow = dailyOutflowBase + dailyOutflowShockPaisa - dailyOutflowRecoveryPaisa;
  const effectiveDailyInflow = dailyInflowBase;

  const points: SimulationResult["points"] = [];
  let baselinePaisa = BigInt(startingBalance.amountPaisa);
  let simulatedPaisa = BigInt(startingBalance.amountPaisa) + upfrontRecoveryInflowPaisa - fixedOneTimeOutflowPaisa;

  // Delayed udhaar impact in early days (days 1 to 45 reduced inflow)
  const delayedDailyReduction = delayedInflowPaisa > 0n ? delayedInflowPaisa / 45n : 0n;

  let shortageDate: string | null = null;
  let minSimulatedPaisa = simulatedPaisa;
  const today = new Date();

  for (let day = 0; day <= 90; day += 5) {
    const d = new Date(today);
    d.setDate(today.getDate() + day);
    const dateStr = d.toISOString().split("T")[0];

    if (day > 0) {
      // Advance 5 days
      const baselineDelta = (dailyInflowBase - dailyOutflowBase) * 5n;
      baselinePaisa += baselineDelta;

      const dailyInflowAdjusted = day <= 45
        ? (effectiveDailyInflow > delayedDailyReduction ? effectiveDailyInflow - delayedDailyReduction : 0n)
        : (effectiveDailyInflow + delayedDailyReduction);

      const simulatedDelta = (dailyInflowAdjusted - effectiveDailyOutflow) * 5n;
      simulatedPaisa += simulatedDelta;
    }

    if (simulatedPaisa < 0n && !shortageDate) {
      shortageDate = dateStr;
    }

    if (simulatedPaisa < minSimulatedPaisa) {
      minSimulatedPaisa = simulatedPaisa;
    }

    points.push({
      date: dateStr,
      day,
      baselineRupees: Number(baselinePaisa / 100n),
      simulatedRupees: Number(simulatedPaisa / 100n),
    });
  }

  const shortageGap = minSimulatedPaisa < 0n
    ? createMoneyFromPaisa(-minSimulatedPaisa)
    : createMoneyFromPaisa(0n);

  const totalShockImpact = createMoneyFromPaisa(
    (dailyOutflowShockPaisa * 90n) + fixedOneTimeOutflowPaisa
  );
  const totalRecoveryImpact = createMoneyFromPaisa(
    upfrontRecoveryInflowPaisa + (dailyOutflowRecoveryPaisa * 90n)
  );
  const netImpact = subtractMoney(totalRecoveryImpact, totalShockImpact);

  return {
    points,
    shortageDate,
    shortageGap,
    isSolvent: minSimulatedPaisa >= 0n,
    totalShockImpact,
    totalRecoveryImpact,
    netImpact,
  };
}
