/** Formatting helpers. Amounts from the API are integer paisa (1 PKR = 100 paisa). */

export function formatPKR(paisa: number | null | undefined, opts: { decimals?: boolean; sign?: boolean } = {}): string {
  if (paisa === null || paisa === undefined || Number.isNaN(paisa)) return "—";
  const negative = paisa < 0;
  const abs = Math.abs(paisa);
  const body = opts.decimals
    ? `${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`
    : Math.round(abs / 100).toLocaleString("en-US");
  const prefix = negative ? "-" : opts.sign && paisa > 0 ? "+" : "";
  return `${prefix}Rs. ${body}`;
}

/** "4.2 Lakh" / "1.48 Crore" for Pakistani readability. */
export function formatScale(paisa: number): string {
  const rupees = Math.abs(paisa) / 100;
  const sign = paisa < 0 ? "-" : "";
  if (rupees >= 10_000_000) return `${sign}${(rupees / 10_000_000).toFixed(2)} Crore`;
  if (rupees >= 100_000) return `${sign}${(rupees / 100_000).toFixed(1)} Lakh`;
  if (rupees >= 1_000) return `${sign}${(rupees / 1_000).toFixed(1)}k`;
  return `${sign}${rupees.toFixed(0)}`;
}

/** Parse a rupee amount typed by a user into integer paisa without floating-point maths.
 * Accepts "1,25,000", "Rs. 500", "12.5"; rejects more than 2 decimals rather than silently truncating. */
export function rupeesToPaisa(input: string | number): number | null {
  const clean = String(input).replace(/[,\s]/g, "").replace(/^rs\.?/i, "");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(clean) ?? /^(-?)()\.(\d{1,2})$/.exec(clean);
  if (!m) return null;
  const paisa = Number(m[2] || "0") * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(paisa)) return null;
  return m[1] === "-" ? -paisa : paisa;
}

export function formatDate(iso: string | null | undefined, style: "short" | "long" = "short"): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", style === "short" ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

export function daysFromNow(iso: string, today: string): number {
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
}

export function todayISO(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export const KIND_LABEL: Record<string, string> = {
  income: "Income (cash in)",
  expense: "Expense (cash out)",
  credit_sale: "Credit sale (udhaar given)",
  customer_payment: "Customer payment",
  credit_purchase: "Credit purchase",
  supplier_payment: "Supplier payment",
  loan_received: "Loan received",
  loan_repayment: "Loan repayment",
  owner_withdrawal: "Owner withdrawal",
  transfer: "Transfer",
};

export const CASH_IN = new Set(["income", "customer_payment", "loan_received"]);
export const CASH_OUT = new Set(["expense", "supplier_payment", "loan_repayment", "owner_withdrawal"]);

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
