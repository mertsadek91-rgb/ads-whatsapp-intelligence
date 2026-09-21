// BUG-022 — currency display switcher. All stored amounts stay in AED;
// sanitizeRates() is the whitelist that keeps a bad/malicious rates payload
// from ever persisting an unknown currency code or a non-numeric/negative rate.
import { describe, it, expect } from "vitest";
import { CURRENCIES, DEFAULT_RATES, sanitizeRates } from "../src/lib/currency.js";

describe("CURRENCIES / DEFAULT_RATES", () => {
  it("every currency has a symbol and both Arabic/English names", () => {
    for (const c of CURRENCIES) {
      expect(c.symbol).toBeTruthy();
      expect(c.name_ar).toBeTruthy();
      expect(c.name_en).toBeTruthy();
    }
  });

  it("has no duplicate currency codes", () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("AED is fixed at rate 1 in the defaults", () => {
    expect(DEFAULT_RATES.AED).toBe(1);
  });

  it("every currency in the list has a default rate", () => {
    for (const c of CURRENCIES) expect(DEFAULT_RATES[c.code]).toBeGreaterThan(0);
  });
});

describe("sanitizeRates", () => {
  it("keeps valid positive numeric rates for known currencies", () => {
    expect(sanitizeRates({ USD: 0.27, EUR: 0.25 })).toEqual({ AED: 1, USD: 0.27, EUR: 0.25 });
  });

  it("drops an unknown currency code (whitelist, not free-form)", () => {
    expect(sanitizeRates({ USD: 0.27, XYZ: 5 })).toEqual({ AED: 1, USD: 0.27 });
  });

  it("drops a non-numeric, zero, or negative rate instead of persisting garbage", () => {
    expect(sanitizeRates({ USD: "abc", EUR: 0, GBP: -1, SAR: 1.02 })).toEqual({ AED: 1, SAR: 1.02 });
  });

  it("always forces AED to 1 regardless of what's submitted for it", () => {
    expect(sanitizeRates({ AED: 999, USD: 0.27 })).toEqual({ AED: 1, USD: 0.27 });
  });

  it("returns just {AED:1} for empty/missing input instead of throwing", () => {
    expect(sanitizeRates(null)).toEqual({ AED: 1 });
    expect(sanitizeRates(undefined)).toEqual({ AED: 1 });
    expect(sanitizeRates({})).toEqual({ AED: 1 });
  });
});
