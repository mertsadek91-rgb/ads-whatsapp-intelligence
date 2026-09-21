// Agent-name normalization: the AI's free-text agent_name extraction produces
// many variants for the same real person plus bot/unknown spellings. This
// collapses them against the clean Wati contact_owner vocabulary (passed in,
// never hardcoded — no real employee names may live in the source).
import { describe, it, expect } from "vitest";
import { normalizeAgentName, UNKNOWN_AGENT, BOT_AGENT } from "../src/lib/agentName.js";

const OWNERS = ["Ahmed Ali", "Sara Omar", "support@example.com"];

describe("normalizeAgentName", () => {
  it("returns a known owner unchanged (exact match)", () => {
    expect(normalizeAgentName("Ahmed Ali", OWNERS)).toBe("Ahmed Ali");
  });

  it("matches a known owner case-insensitively", () => {
    expect(normalizeAgentName("ahmed ali", OWNERS)).toBe("Ahmed Ali");
  });

  it("attributes a multi-agent string to the FIRST mentioned owner", () => {
    expect(normalizeAgentName("Ahmed Ali و Sara Omar", OWNERS)).toBe("Ahmed Ali");
    expect(normalizeAgentName("Sara Omar, Ahmed Ali", OWNERS)).toBe("Sara Omar");
    expect(normalizeAgentName("Ahmed Ali ثم Sara Omar", OWNERS)).toBe("Ahmed Ali");
  });

  it("a known owner wins even when the string also mentions a bot", () => {
    expect(normalizeAgentName("Ahmed Ali ثم بوت", OWNERS)).toBe("Ahmed Ali");
  });

  it("collapses all bot spellings into one Bot bucket", () => {
    for (const v of ["Bot", "بوت", "بوت آلي", "Bot (آلي)", "بوت (Bot)", "Bot (Yaqeen)",
                     "بوت آلي (لم يظهر اسم موظف بشري)"]) {
      expect(normalizeAgentName(v, OWNERS)).toBe(BOT_AGENT);
    }
  });

  it("collapses all unknown spellings into one Unknown bucket", () => {
    for (const v of ["غير معروف", "غير مذكور", "غير محدد", "لا يوجد موظف بشري",
                     "لم يظهر اسم الموظف", "غير معروف (لا يوجد موظف بشري)", "unknown",
                     "؟", "", null, undefined]) {
      expect(normalizeAgentName(v, OWNERS)).toBe(UNKNOWN_AGENT);
    }
  });

  it("leaves an unrecognized real-looking name unchanged (honest fallback, never guesses)", () => {
    expect(normalizeAgentName("Someone New", OWNERS)).toBe("Someone New");
  });

  it("matches despite double-spaced owner records (real Wati data quirk)", () => {
    // The owner record has two spaces; the AI extracts one. Both directions
    // must still match, and the returned canonical form is single-spaced.
    expect(normalizeAgentName("Ahmed Ali ثم Sara", ["Ahmed  Ali"])).toBe("Ahmed Ali");
    expect(normalizeAgentName("Ahmed  Ali", ["Ahmed Ali"])).toBe("Ahmed Ali");
  });

  it("still attributes to the FIRST mentioned agent when one owner record is double-spaced", () => {
    // Without whitespace squashing, "Ahmed  Ali" (owner) never matches the
    // single-spaced raw string, so "Sara Omar" would wrongly win here.
    expect(normalizeAgentName("Ahmed Ali و Sara Omar", ["Ahmed  Ali", "Sara Omar"])).toBe("Ahmed Ali");
  });
});
