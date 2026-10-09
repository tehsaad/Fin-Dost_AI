import type { Kind } from "./types";

/** Shared demo logins (fictional data). Anyone can sign in; "Reset demo data" restores them. */
export const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD || "FinDost-Demo-2026";

export const DEMO_ACCOUNTS: { kind: Kind; email: string; label: string; who: string }[] = [
  { kind: "sme", email: "sme@demo.findost.app", label: "Small business", who: "Bilal General Store, Lahore" },
  { kind: "enterprise", email: "enterprise@demo.findost.app", label: "Enterprise", who: "Indus Textiles, Faisalabad" },
  { kind: "household", email: "household@demo.findost.app", label: "Household", who: "Khan family, Lahore" },
  { kind: "student", email: "student@demo.findost.app", label: "Student", who: "Ayesha, Islamabad" },
];

export const KIND_INFO: Record<Kind, { title: string; urdu: string; blurb: string; modules: string }> = {
  sme: { title: "Shop / small business", urdu: "دکان / چھوٹا کاروبار", blurb: "Kiryana, retail, home-based or micro-business", modules: "Khata, udhaar, bills, inventory, forecast, shocks, recovery" },
  enterprise: { title: "Enterprise", urdu: "بڑا ادارہ", blurb: "Multi-site or larger business with buyers and suppliers", modules: "All business modules at larger scale" },
  household: { title: "Household", urdu: "گھرانہ", blurb: "Family budget, salary, bills and school fees", modules: "Budget ledger, bills, forecast, shocks, recovery" },
  student: { title: "Student", urdu: "طالب علم", blurb: "Allowance, part-time income, hostel and fees", modules: "Budget ledger, bills, forecast, shocks, recovery" },
};
