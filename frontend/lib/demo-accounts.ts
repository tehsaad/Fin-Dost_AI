import type { Kind } from "./types";

/** Fictional personas for private demo workspaces. Each visitor gets their own copy (anonymous sign-in);
 * nothing is shared between visitors, so one person's reset or edits never affect another. */
export const DEMO_PERSONAS: { kind: Kind; label: string; who: string; name: string }[] = [
  { kind: "sme", label: "Small business", who: "Kiryana store, Lahore", name: "Bilal General Store" },
  { kind: "enterprise", label: "Enterprise", who: "Textile firm, Faisalabad", name: "Indus Textiles Ltd." },
  { kind: "household", label: "Household", who: "Family budget, Lahore", name: "Khan Family Household" },
  { kind: "student", label: "Student", who: "University student, Islamabad", name: "Ayesha's Student Budget" },
];

export const KIND_INFO: Record<Kind, { title: string; urdu: string; blurb: string; modules: string }> = {
  sme: { title: "Shop / small business", urdu: "دکان / چھوٹا کاروبار", blurb: "Kiryana, retail, home-based or micro-business", modules: "Khata, udhaar, bills, inventory, forecast, shocks, recovery" },
  enterprise: { title: "Enterprise", urdu: "بڑا ادارہ", blurb: "Multi-site or larger business with buyers and suppliers", modules: "All business modules at larger scale" },
  household: { title: "Household", urdu: "گھرانہ", blurb: "Family budget, salary, bills and school fees", modules: "Budget ledger, bills, forecast, shocks, recovery" },
  student: { title: "Student", urdu: "طالب علم", blurb: "Allowance, part-time income, hostel and fees", modules: "Budget ledger, bills, forecast, shocks, recovery" },
};
