// Shared sales-pattern taxonomy + business rules consumed by both
// conversationAnalysis.js (per-conversation detection) and report.js's
// coaching-script generator. Guards against silent enum drift/collisions.
import { describe, it, expect } from "vitest";
import { SALES_PATTERNS, clampPatternKey, patternLabel } from "../src/lib/businessKnowledge.js";

describe("SALES_PATTERNS", () => {
  it("has no duplicate keys (a collision would silently merge two distinct mistakes)", () => {
    const keys = SALES_PATTERNS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes the 'other' escape valve", () => {
    expect(SALES_PATTERNS.some((p) => p.key === "other")).toBe(true);
  });

  it("every pattern has both an Arabic and English label", () => {
    for (const p of SALES_PATTERNS) {
      expect(p.ar).toBeTruthy();
      expect(p.en).toBeTruthy();
    }
  });
});

describe("clampPatternKey", () => {
  it("passes through a known key unchanged", () => {
    expect(clampPatternKey("premature_registration_push")).toBe("premature_registration_push");
  });

  it("coerces an unknown/off-schema value to 'other'", () => {
    expect(clampPatternKey("قفز للتسجيل بدون شرح")).toBe("other");
    expect(clampPatternKey("something_hallucinated")).toBe("other");
  });

  it("leaves a missing value as null rather than inventing an 'other'", () => {
    expect(clampPatternKey(null)).toBeNull();
    expect(clampPatternKey(undefined)).toBeNull();
  });
});

describe("patternLabel", () => {
  it("returns the Arabic label by default and English when asked", () => {
    expect(patternLabel("slow_follow_up", "ar")).toBe("تأخّر واضح بعد إشارة اهتمام");
    expect(patternLabel("slow_follow_up", "en")).toBe("Slow follow-up after a clear interest signal");
  });

  it("falls back to the 'other' label for an unrecognized key instead of throwing", () => {
    expect(() => patternLabel("nonexistent_key", "ar")).not.toThrow();
    expect(patternLabel("nonexistent_key", "ar")).toBe("أخرى");
  });
});
