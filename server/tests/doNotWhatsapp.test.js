// The do-not-contact lookup that gates the daily follow-up email.
//
// What is pinned here is the SHAPE of the query, because the failure modes are
// asymmetric and both are bad: matching too much silently buries reachable
// leads, matching too little messages someone who asked us to stop.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { rows: [], sql: [], args: [] };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, args) => { state.sql.push(sql); state.args.push(args); return state.rows; }),
}));

const { doNotWhatsapp, DO_NOT_WHATSAPP_TAGS } = await import("../src/lib/tagBoard.js");

beforeEach(() => { state.rows = []; state.sql = []; state.args = []; });

describe("doNotWhatsapp", () => {
  it("asks only for the two tags that are a WhatsApp refusal", async () => {
    await doNotWhatsapp(["1"]);
    // Not DO_NOT_CALL or DO_NOT_EMAIL: those refuse other channels entirely, and
    // not ENG_SPAM: that is our judgement of them, not their request of us.
    expect(DO_NOT_WHATSAPP_TAGS).toEqual(["ENG_OPTED_OUT", "ENG_DO_NOT_WHATSAPP"]);
    expect(state.args[0]).toEqual(["ENG_OPTED_OUT", "ENG_DO_NOT_WHATSAPP", "1"]);
  });

  it("excludes a tag the supervisor rejected", async () => {
    await doNotWhatsapp(["1"]);
    expect(state.sql[0]).toContain("review_status <> 'rejected'");
  });

  it("groups several tags onto one customer and keeps a quote", async () => {
    state.rows = [
      { wa_id: "1", tag: "ENG_OPTED_OUT", evidence: null, review_status: "auto" },
      { wa_id: "1", tag: "ENG_DO_NOT_WHATSAPP", evidence: "لا ترسل لي", review_status: "confirmed" },
      { wa_id: "2", tag: "ENG_OPTED_OUT", evidence: "stop", review_status: "auto" },
    ];
    const m = await doNotWhatsapp(["1", "2"]);
    expect(m.get("1").tags.sort()).toEqual(["ENG_DO_NOT_WHATSAPP", "ENG_OPTED_OUT"]);
    // A null quote on the first row must not shadow the real one on the second.
    expect(m.get("1").evidence).toBe("لا ترسل لي");
    expect(m.get("1").confirmed).toBe(true);
    expect(m.get("2").confirmed).toBe(false);
  });

  it("does not query at all for an empty or junk id list", async () => {
    for (const input of [[], [null, undefined, ""], undefined]) {
      const m = await doNotWhatsapp(input);
      expect(m.size).toBe(0);
    }
    // An empty IN () list is a SQL syntax error, so the guard must come first.
    expect(state.sql).toEqual([]);
  });

  it("de-duplicates ids so one customer is asked for once", async () => {
    await doNotWhatsapp(["1", "1", "1"]);
    expect(state.args[0]).toEqual(["ENG_OPTED_OUT", "ENG_DO_NOT_WHATSAPP", "1"]);
  });
});
