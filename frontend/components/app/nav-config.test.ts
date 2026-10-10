import { describe, expect, it } from "vitest";
import { navGroups } from "./nav-config";
import { termsFor } from "@/lib/terms";
import type { Kind } from "@/lib/types";

const items = (kind: Kind) => navGroups(kind).flatMap((g) => g.items);
const BUSINESS_WORDS = /shop|stock|supplier|inventory|khata|shock/i;

describe("navigation per account type", () => {
  it.each(["student", "household"] as Kind[])("%s sees personal-finance modules only", (kind) => {
    const nav = items(kind);
    expect(nav.map((i) => i.href)).toEqual(expect.arrayContaining(["/budget", "/goals", "/forecast", "/simulator", "/recovery"]));
    for (const href of ["/inventory", "/controls", "/actions", "/team", "/impact", "/copilot"]) expect(nav.map((i) => i.href)).not.toContain(href);
    for (const i of nav) expect(i.label).not.toMatch(BUSINESS_WORDS);
  });

  it("enterprise is organised around the finance workflow", () => {
    expect(navGroups("enterprise").map((g) => g.title)).toEqual(["Overview", "Records", "Planning", "Risk & controls", "Operations", "Help"]);
    expect(items("enterprise").map((i) => i.href)).toEqual(expect.arrayContaining(["/actions", "/team", "/controls", "/budget", "/inventory"]));
  });

  it("sme keeps its shop features and has no team page", () => {
    const hrefs = items("sme").map((i) => i.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/transactions", "/inventory", "/recovery"]));
    expect(hrefs).not.toContain("/team");
    expect(hrefs).not.toContain("/impact");
  });

  it("personal wording never mentions shops or suppliers", () => {
    const t = termsFor("student");
    for (const v of Object.values(t)) if (typeof v === "string") expect(v).not.toMatch(/shop|supplier|stock/i);
    expect(termsFor("sme").simulator).toBe("Shock Simulator");
  });
});
