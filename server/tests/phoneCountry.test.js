// Country is derived from the phone dial code because the Wati country field is
// empty. Dial codes are variable length and some prefix others, so the match
// must be longest-first.
import { describe, it, expect } from "vitest";
import { countryOf, flagEmoji } from "../src/lib/phoneCountry.js";

describe("countryOf", () => {
  it("maps the account's real prefixes to the right country", () => {
    expect(countryOf("966501234567").iso2).toBe("SA");
    expect(countryOf("201000181074").iso2).toBe("EG"); // 20 (Egypt), not 201
    expect(countryOf("212612345678").iso2).toBe("MA");
    expect(countryOf("213612345678").iso2).toBe("DZ");
    expect(countryOf("971501234567").iso2).toBe("AE");
    expect(countryOf("9647701234567").iso2).toBe("IQ");
  });

  it("prefers the LONGEST matching code (971 over a shorter 97x, 966 over 9x)", () => {
    // 971 and 966 are 3-digit; ensure they aren't shadowed by a 2-digit code.
    expect(countryOf("971").iso2).toBe("AE");
    expect(countryOf("966").iso2).toBe("SA");
    // Egypt is 2-digit (20) — a 20xxxx number must resolve to EG, not some 3-digit code.
    expect(countryOf("20100").iso2).toBe("EG");
  });

  it("handles +, spaces and leading zeros", () => {
    expect(countryOf("+971 50 123 4567").iso2).toBe("AE");
    expect(countryOf("00966501234567".replace(/^00/, "")).iso2).toBe("SA");
  });

  it("returns an Unknown bucket (never guesses) for empty/unmatched", () => {
    expect(countryOf("").iso2).toBeNull();
    expect(countryOf(null).iso2).toBeNull();
    expect(countryOf("").ar).toBe("غير محدَّد");
  });

  it("flagEmoji builds a two-letter regional-indicator flag", () => {
    expect(flagEmoji("AE")).toBe("🇦🇪");
    expect(flagEmoji("SA")).toBe("🇸🇦");
    expect(flagEmoji(null)).toBe("🏳️");
  });

  it("carries Arabic + English display names", () => {
    const eg = countryOf("201000000000");
    expect(eg.ar).toBe("مصر");
    expect(eg.en).toBe("Egypt");
    expect(eg.flag).toBe("🇪🇬");
  });
});
