import { describe, expect, it } from "vitest";
import { formatPKR, formatScale, rupeesToPaisa } from "./format";

describe("rupeesToPaisa", () => {
  it("parses Pakistani and plain formats into exact paisa", () => {
    expect(rupeesToPaisa("1,25,000.50")).toBe(12_500_050);
    expect(rupeesToPaisa("Rs. 500")).toBe(50_000);
    expect(rupeesToPaisa("0.29")).toBe(29); // 0.29 * 100 in floats is 28.999...
    expect(rupeesToPaisa(".5")).toBe(50);
    expect(rupeesToPaisa("12.5")).toBe(1_250);
    expect(rupeesToPaisa("-75")).toBe(-7_500);
    expect(rupeesToPaisa(1500)).toBe(150_000);
  });
  it("rejects anything ambiguous instead of guessing", () => {
    for (const bad of ["", "abc", "1.234", "1e5", "12-3", "Rs.", "1.2.3"]) expect(rupeesToPaisa(bad)).toBeNull();
  });
});

describe("formatPKR", () => {
  it("formats paisa as rupees", () => {
    expect(formatPKR(1_234_567)).toBe("Rs. 12,346");
    expect(formatPKR(1_234_567, { decimals: true })).toBe("Rs. 12,345.67");
    expect(formatPKR(-50_000)).toBe("-Rs. 500");
    expect(formatPKR(50_000, { sign: true })).toBe("+Rs. 500");
    expect(formatPKR(null)).toBe("—");
  });
});

describe("formatScale", () => {
  it("uses lakh and crore", () => {
    expect(formatScale(420_000_00)).toBe("4.2 Lakh");
    expect(formatScale(14_800_000_00)).toBe("1.48 Crore");
  });
});
