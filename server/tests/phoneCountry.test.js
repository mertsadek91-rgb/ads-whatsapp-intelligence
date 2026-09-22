// Country is derived from the phone dial code because the Wati country field is
// empty. Dial codes are variable length and some prefix others, so the match
// must be longest-first.
import { describe, it, expect } from "vitest";
import { countryOf, flagEmoji, COUNTRIES } from "../src/lib/phoneCountry.js";

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

  // +1 and +7 are not countries. Folding them into their largest member gave a
  // confident wrong answer — worse than the blank an unmapped code produces,
  // because nothing downstream could tell it was a guess.
  it("tells Canada apart from the United States", () => {
    expect(countryOf("14165551234").iso2).toBe("CA");   // Toronto
    expect(countryOf("16045551234").iso2).toBe("CA");   // Vancouver
    expect(countryOf("12125551234").iso2).toBe("US");   // New York
    expect(countryOf("14155551234").iso2).toBe("US");   // San Francisco
  });

  it("names the Caribbean members of +1 instead of calling them American", () => {
    expect(countryOf("18765551234").iso2).toBe("JM");   // Jamaica
    expect(countryOf("18095551234").iso2).toBe("DO");   // Dominican Republic
    expect(countryOf("12425551234").iso2).toBe("BS");   // Bahamas
    expect(countryOf("17875551234").iso2).toBe("PR");   // Puerto Rico
  });

  it("defaults an unlisted +1 area code to the United States", () => {
    // It holds most of the plan, and a newly allocated US code should not read
    // as unknown. Only Canada and the island nations are enumerated.
    expect(countryOf("13215551234").iso2).toBe("US");
  });

  it("tells Kazakhstan apart from Russia", () => {
    expect(countryOf("77012345678").iso2).toBe("KZ");   // Kazakh mobile
    expect(countryOf("77172345678").iso2).toBe("KZ");   // Astana
    expect(countryOf("79161234567").iso2).toBe("RU");   // Russian mobile — the common case
    expect(countryOf("74951234567").iso2).toBe("RU");   // Moscow
  });

  it("refuses to name a +1 number too short to carry an area code", () => {
    // Guessing here is exactly what produced the old wrong answers.
    expect(countryOf("1").iso2).toBeNull();
    expect(countryOf("141").iso2).toBeNull();
  });

  it("drops the slash-pair display name no ISO lookup could split", () => {
    expect(countryOf("12125551234").ar).toBe("أمريكا");
    expect(countryOf("14165551234").ar).toBe("كندا");
    expect(countryOf("14165551234").flag).toBe("🇨🇦");
  });

  it("offers each of them separately in the country vocabulary", () => {
    const codes = COUNTRIES.map((c) => c.iso2);
    for (const iso of ["US", "CA", "RU", "KZ", "JM", "DO"]) {
      expect(codes, `${iso} should be selectable`).toContain(iso);
    }
    expect(new Set(codes).size, "no duplicates").toBe(codes.length);
    expect(COUNTRIES.every((c) => c.ar && c.en && c.flag)).toBe(true);
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
