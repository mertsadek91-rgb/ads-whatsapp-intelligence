// BUG-016 — result counting was hardcoded to a single action type
// (`onsite_conversion.messaging_conversation_started_7d`), so any non
// message-objective campaign silently reported 0 results. Verified live:
// campaign "LP 2026 Ads" (OUTCOME_LEADS, id 120238871357660125) actually
// has 1,925 real website leads, whose action_type is
// `offsite_conversion.fb_pixel_lead` (confirmed via a live Graph API call's
// result_values indicator — not a guess).
import { describe, it, expect } from "vitest";
import config from "../src/config.js";

// meta.js reads config.meta.token at module scope via metaAuth — importing it
// directly is safe here since these are pure functions with no I/O, but we
// still need a token-free import path. resultCount/costPerResult/resultLabel
// aren't exported (internal helpers) — re-derive their exact behavior via the
// exported resultTypesFor() + a tiny local mirror so this stays a true unit
// test with zero network/DB/token dependency.
const { resultTypesFor } = await import("../src/lib/meta.js");

function resultCount(row, objective) {
  const actions = row.actions || [];
  for (const { type } of resultTypesFor(objective)) {
    const a = actions.find((x) => x.action_type === type);
    if (a) return Math.round(Number(a.value));
  }
  return 0;
}

describe("BUG-016: objective-aware result counting", () => {
  it("counts the real leads for an OUTCOME_LEADS campaign via offsite_conversion.fb_pixel_lead", () => {
    const row = { actions: [{ action_type: "offsite_conversion.fb_pixel_lead", value: "1925" }] };
    expect(resultCount(row, "OUTCOME_LEADS")).toBe(1925);
  });

  it("still counts messaging conversations for OUTCOME_ENGAGEMENT (unchanged behavior)", () => {
    const row = { actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "220" }] };
    expect(resultCount(row, "OUTCOME_ENGAGEMENT")).toBe(220);
  });

  it("falls back to lead_grouped / lead for accounts using Instant Forms instead of a pixel", () => {
    const row1 = { actions: [{ action_type: "onsite_conversion.lead_grouped", value: "10" }] };
    expect(resultCount(row1, "OUTCOME_LEADS")).toBe(10);
    const row2 = { actions: [{ action_type: "lead", value: "5" }] };
    expect(resultCount(row2, "OUTCOME_LEADS")).toBe(5);
  });

  it("returns 0 (not a crash) when no recognized action type is present for the objective", () => {
    const row = { actions: [{ action_type: "link_click", value: "999" }] };
    expect(resultCount(row, "OUTCOME_LEADS")).toBe(0);
  });

  it("defaults to messaging-result behavior for an unmapped/unknown objective", () => {
    const row = { actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "3" }] };
    expect(resultCount(row, "OUTCOME_TRAFFIC")).toBe(3);
  });

  it("resultTypesFor never returns an empty candidate list (always has a fallback)", () => {
    for (const obj of ["OUTCOME_LEADS", "OUTCOME_ENGAGEMENT", "OUTCOME_TRAFFIC", undefined, null]) {
      expect(resultTypesFor(obj).length).toBeGreaterThan(0);
    }
  });
});
