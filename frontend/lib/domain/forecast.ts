import { Forecast, ForecastPoint, Money, Transaction, UdhaarRecord } from "@/types/domain";
import { addMoney, compareMoney, createMoneyFromPaisa, createMoneyFromRupees, isNegativeMoney, multiplyMoneyPercent, subtractMoney } from "./money";

/**
 * Computes a deterministic 90-day cash flow projection given:
 * - Current starting balance (Money)
 * - Average daily inflow and outflow calculated from transactions
 * - Udhaar recovery projections if applicable
 */
export function computeDeterministicForecast(
  workspaceId: string,
  startingBalance: Money,
  recentTransactions: Transaction[],
  collectedUdhaarAmount: Money = { currency: "PKR", amountPaisa: "0" }
): Forecast {
  // Calculate average daily inflow & outflow from confirmed/reviewed transactions over last 30 days
  let totalInflowPaisa = 0n;
  let totalOutflowPaisa = 0n;

  for (const tx of recentTransactions) {
    const p = BigInt(tx.amount.amountPaisa);
    if (tx.direction === "inflow") {
      totalInflowPaisa += p;
    } else {
      totalOutflowPaisa += p;
    }
  }

  // Baseline 30-day run rate normalized to 1 day
  const dailyInflowPaisa = totalInflowPaisa / 30n;
  const dailyOutflowPaisa = totalOutflowPaisa / 30n;

  // Add the newly collected udhaar to the starting balance immediately
  let runningBalance = addMoney(startingBalance, collectedUdhaarAmount);

  const points: ForecastPoint[] = [];
  const today = new Date();

  // Create 13 weekly points spanning 90 days
  for (let i = 0; i <= 90; i += 7) {
    const pointDate = new Date(today);
    pointDate.setDate(today.getDate() + i);
    const dateStr = pointDate.toISOString().split("T")[0];

    // For baseline, apply daily net cash delta * 7 days
    const weeklyNetPaisa = (dailyInflowPaisa - dailyOutflowPaisa) * 7n;
    if (i > 0) {
      const deltaMoney = createMoneyFromPaisa(weeklyNetPaisa);
      runningBalance = addMoney(runningBalance, deltaMoney);
    }

    // P10: Conservative scenario (15% lower inflows, 10% higher outflows)
    const p10NetWeekly = ((dailyInflowPaisa * 85n / 100n) - (dailyOutflowPaisa * 110n / 100n)) * BigInt(i);
    const p10Balance = addMoney(
      addMoney(startingBalance, collectedUdhaarAmount),
      createMoneyFromPaisa(p10NetWeekly)
    );

    // P90: Favorable scenario (10% higher inflows, 5% lower outflows)
    const p90NetWeekly = ((dailyInflowPaisa * 110n / 100n) - (dailyOutflowPaisa * 95n / 100n)) * BigInt(i);
    const p90Balance = addMoney(
      addMoney(startingBalance, collectedUdhaarAmount),
      createMoneyFromPaisa(p90NetWeekly)
    );

    points.push({
      date: dateStr,
      baseline: { ...runningBalance },
      p10: p10Balance,
      p50: { ...runningBalance },
      p90: p90Balance,
    });
  }

  return {
    workspaceId,
    generatedAt: new Date().toISOString(),
    horizonDays: 90,
    points,
    assumptions: [
      "Based on 30-day verified historical run rate",
      "Deterministic 7-day compounding interval",
      "P10 conservative (-15% inflow / +10% outflow), P90 optimistic (+10% inflow / -5% outflow)",
      collectedUdhaarAmount.amountPaisa !== "0"
        ? `Includes immediate Udhaar collection impact of Rs. ${Number(BigInt(collectedUdhaarAmount.amountPaisa) / 100n).toLocaleString()}`
        : "Standard uncollected baseline",
    ],
    source: "demo",
  };
}

/**
 * Calculates runway days (days until balance hits zero or negative)
 */
export function calculateRunwayDays(
  startingBalance: Money,
  monthlyOutflow: Money,
  monthlyInflow: Money
): number {
  const balancePaisa = BigInt(startingBalance.amountPaisa);
  if (balancePaisa <= 0n) return 0;

  const netMonthlyDrain = BigInt(monthlyOutflow.amountPaisa) - BigInt(monthlyInflow.amountPaisa);
  if (netMonthlyDrain <= 0n) {
    // Cash-flow positive or neutral
    return 180; // Stable 180+ days
  }

  const dailyDrain = netMonthlyDrain / 30n;
  if (dailyDrain <= 0n) return 180;

  const days = Number(balancePaisa / dailyDrain);
  return Math.min(Math.max(days, 0), 180);
}
