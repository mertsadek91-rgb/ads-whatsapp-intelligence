// REG-106 — A lead that only replied to the automated bot (e.g. language
// selection, greeting) was once scored 70/100 ("hot") purely from message
// count, despite zero human sales follow-up. Case that surfaced this:
// wa_id 201116858765 — replied to the bot, never got a human reply, scored 70.
// The fix: bot-only engagement is capped at <=40 and can never reach "hot"/"warm".
import { describe, it, expect } from "vitest";
import { scoreContact, normalizeStage } from "../src/lib/score.js";

describe("REG-106: bot-only replies must not inflate lead score", () => {
  it("caps a bot-only lead at <= 40 even when other factors would push it higher", () => {
    // stage=qualified(+35) + attributed(+3) + recent(+5) alone = 43 (already
    // "warm"/near-hot) with zero human involvement — the cap must still apply.
    const result = scoreContact({
      stage: "qualified",
      deposit_flag: false,
      source_ad_id: "120241897838020125",
      created_at: new Date(), // recent
      human_replied: 0,
      agent_msgs: 0,
      customer_msgs: 7, // the customer engaged a lot — with the bot only
    });
    expect(result.score).toBeLessThanOrEqual(40);
    expect(result.band).not.toBe("hot");
    expect(result.reasons).toContain("cap:no-human-followup");
  });

  it("a bot-only lead with minimal other signals naturally scores low without needing the cap", () => {
    const result = scoreContact({
      stage: "new", deposit_flag: false, human_replied: 0, agent_msgs: 0, customer_msgs: 7,
    });
    expect(result.score).toBeLessThanOrEqual(40);
    expect(result.band).toBe("cold");
  });

  it("does NOT cap once a human agent has actually replied", () => {
    const result = scoreContact({
      stage: "qualified",
      deposit_flag: false,
      source_ad_id: "ad1",
      created_at: new Date(),
      human_replied: 1,
      agent_msgs: 3,
      customer_msgs: 8,
    });
    expect(result.score).toBeGreaterThan(40);
    expect(result.reasons).not.toContain("cap:no-human-followup");
  });

  it("never caps a depositor even with zero recorded human messages (edge case)", () => {
    const result = scoreContact({
      stage: "deposit", deposit_flag: true, human_replied: 0, agent_msgs: 0, customer_msgs: 2,
    });
    expect(result.reasons).not.toContain("cap:no-human-followup");
    expect(result.score).toBeGreaterThan(40);
  });

  it("score is always within [0,100] and band thresholds are consistent", () => {
    const cases = [
      { stage: "new", human_replied: 0, agent_msgs: 0, customer_msgs: 0 },
      { stage: "deposit", deposit_flag: true, human_replied: 1, agent_msgs: 20, customer_msgs: 50 },
    ];
    for (const c of cases) {
      const { score, band } = scoreContact(c);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(["hot", "warm", "cold"]).toContain(band);
      if (score >= 70) expect(band).toBe("hot");
      if (score < 45) expect(band).toBe("cold");
    }
  });

  it("falls back to modest ingest-time scoring when bot/human split is unknown", () => {
    // no human_replied/agent_msgs fields at all (pre-conversation-sync contact)
    const result = scoreContact({ stage: "new", is_answered: true, num_messages: 10 });
    expect(result.reasons).not.toContain("cap:no-human-followup");
    expect(result.score).toBeLessThan(70); // modest, not inflated
  });
});

describe("stage normalization (used by scoreContact via ingest)", () => {
  it("maps known Wati lead-stage strings to normalized stages", () => {
    expect(normalizeStage("New Lead")).toBe("new");
    expect(normalizeStage("Qualified")).toBe("qualified");
  });

  it("falls back to a tag when the primary lead_stage is unmapped", () => {
    expect(normalizeStage("Some Unknown Stage", ["Deposit"])).toBe("deposit");
  });

  it("BUG FIX (found while writing REG-106 tests): Wati's real sales-pipeline " +
     "stages resolve correctly instead of silently defaulting to 'new'", () => {
    // Live impact before this fix: all 6 real "Deal Won" contacts in the DB
    // scored 5-10/100, band "cold" — the worst possible classification for
    // actually-converted customers.
    expect(normalizeStage("Deal Won")).toBe("deposit");
    expect(normalizeStage("Proposal Sent")).toBe("interested");
    expect(normalizeStage("Deal Lost")).toBe("engaged");
  });

  it("Deal Won now scores as a top-tier lead, not a cold new one", () => {
    const stage = normalizeStage("Deal Won");
    const { score, band } = scoreContact({ stage, deposit_flag: true, human_replied: 1, agent_msgs: 2, customer_msgs: 4 });
    expect(stage).toBe("deposit");
    expect(band).toBe("hot");
    expect(score).toBeGreaterThanOrEqual(70);
  });
});
