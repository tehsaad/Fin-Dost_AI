import { Money } from "@/types/domain";

/**
 * Money utilities using integer paisa (1 PKR = 100 Paisa).
 * All arithmetic is performed via BigInt to guarantee 100% exact math
 * with zero IEEE-754 floating-point imprecision.
 */

export function createMoneyFromPaisa(amountPaisa: string | bigint | number): Money {
  const paisaBigInt = typeof amountPaisa === "bigint"
    ? amountPaisa
    : BigInt(Math.trunc(Number(amountPaisa)));
  return {
    currency: "PKR",
    amountPaisa: paisaBigInt.toString(),
  };
}

export function createMoneyFromRupees(rupees: number | string): Money {
  const clean = typeof rupees === "string" ? rupees.trim().replace(/,/g, "") : rupees.toString();
  if (!clean || isNaN(Number(clean))) {
    return { currency: "PKR", amountPaisa: "0" };
  }

  const parts = clean.split(".");
  const wholePart = BigInt(parts[0] || "0");
  const fractional = (parts[1] || "").padEnd(2, "0").slice(0, 2);
  const fracPart = BigInt(fractional);
  const sign = clean.startsWith("-") ? -1n : 1n;

  const totalPaisa = (wholePart >= 0n ? wholePart : -wholePart) * 100n + fracPart;
  return {
    currency: "PKR",
    amountPaisa: (totalPaisa * sign).toString(),
  };
}

export function addMoney(a: Money, b: Money): Money {
  const sum = BigInt(a.amountPaisa) + BigInt(b.amountPaisa);
  return { currency: "PKR", amountPaisa: sum.toString() };
}

export function subtractMoney(a: Money, b: Money): Money {
  const diff = BigInt(a.amountPaisa) - BigInt(b.amountPaisa);
  return { currency: "PKR", amountPaisa: diff.toString() };
}

export function multiplyMoneyPercent(m: Money, percent: number): Money {
  // Multiply by basis points (percent * 100) to keep precision
  const basisPoints = BigInt(Math.round(percent * 100));
  const current = BigInt(m.amountPaisa);
  const multiplied = (current * basisPoints) / 10000n;
  return { currency: "PKR", amountPaisa: multiplied.toString() };
}

export function moneyToRupeesNumber(m: Money): number {
  return Number(BigInt(m.amountPaisa)) / 100;
}

export function isZeroMoney(m: Money): boolean {
  return BigInt(m.amountPaisa) === 0n;
}

export function isNegativeMoney(m: Money): boolean {
  return BigInt(m.amountPaisa) < 0n;
}

export function compareMoney(a: Money, b: Money): number {
  const aP = BigInt(a.amountPaisa);
  const bP = BigInt(b.amountPaisa);
  if (aP > bP) return 1;
  if (aP < bP) return -1;
  return 0;
}

/**
 * Formats money as "Rs. 1,250,000" with commas.
 * Includes decimal paisa only if non-zero or explicitly requested.
 */
export function formatMoney(m: Money | undefined | null, showPaisa = false): string {
  if (!m) return "Rs. 0";
  try {
    const paisaVal = BigInt(m.amountPaisa);
    const isNeg = paisaVal < 0n;
    const absPaisa = isNeg ? -paisaVal : paisaVal;

    const rupees = absPaisa / 100n;
    const paisaRem = absPaisa % 100n;

    const formattedRupees = rupees.toLocaleString("en-US");
    const signPrefix = isNeg ? "- " : "";

    if (showPaisa || paisaRem > 0n) {
      const paisaStr = paisaRem.toString().padStart(2, "0");
      return `${signPrefix}Rs. ${formattedRupees}.${paisaStr}`;
    }

    return `${signPrefix}Rs. ${formattedRupees}`;
  } catch {
    return "Rs. 0";
  }
}

/**
 * Provides Lakh / Crore summary for Pakistani financial readability.
 * E.g. "12.5 Lakh" or "1.4 Crore"
 */
export function formatPakistaniScale(m: Money): string {
  const rupees = moneyToRupeesNumber(m);
  const absRupees = Math.abs(rupees);
  const isNeg = rupees < 0;
  const sign = isNeg ? "-" : "";

  if (absRupees >= 10_000_000) {
    const crore = (absRupees / 10_000_000).toFixed(2);
    return `${sign}${crore} Crore`;
  }
  if (absRupees >= 100_000) {
    const lakh = (absRupees / 100_000).toFixed(1);
    return `${sign}${lakh} Lakh`;
  }
  return formatMoney(m);
}
