// Contact status: a HUMAN reply (not the bot) = contacted; otherwise classify
// by after-hours arrival + the WhatsApp 24h window. Dubai = UTC+4.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { rows: [], ads: [] };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql) => {
    if (sql.includes("from ads_wati_contacts c") && sql.includes("left join ads_conversation_meta")) return state.rows;
    if (sql.includes("from ads_meta_ad_perf p")) return state.ads;
    return [];
  }),
}));
vi.mock("../src/config.js", () => ({ default: { workHours: { start: 9, end: 19, offDays: [5] } } }));
vi.mock("../src/lib/phoneCountry.js", () => ({ countryOf: (p) => ({ iso2: String(p || "").startsWith("966") ? "SA" : "EG" }) }));

const { gatherContactStatus, rollup, sanitizeWorkHours, interest } = await import("../src/lib/contactStatus.js");

const WH = { start: 9, end: 19, offDays: [5] };
const NOW = new Date("2026-07-21T12:00:00Z"); // Dubai 16:00

beforeEach(() => { state.rows = []; state.ads = []; });

describe("sanitizeWorkHours", () => {
  it("clamps hours, dedups off days, and keeps end > start", () => {
    expect(sanitizeWorkHours({ start: 9, end: 19, offDays: [5, 5, 9, 2] })).toEqual({ start: 9, end: 19, offDays: [5, 2] });
    expect(sanitizeWorkHours({ start: 10, end: 8 }).end).toBeGreaterThan(10);
  });
});

describe("gatherContactStatus", () => {
  it("classifies human-contacted vs bot vs after-hours vs expired vs in-hours", async () => {
    state.ads = [{ ad_id: "A", spend_aed: 100, leads: 10 }]; // cost/lead = 10
    state.rows = [
      { wa_id: "1", created_date: "2026-07-21", phone: "966...", owner: "Omar", stage: "interested", source_ad_id: "A",
        conv_type: "human_handled", human_replied: 1, first_human_response_min: 12, last_activity: "2026-07-21T06:00:00Z", last_dir: "out" },
      { wa_id: "2", created_date: "2026-07-21", phone: "966...", owner: "Omar", stage: "new", source_ad_id: "A",
        conv_type: "awaiting_human", human_replied: 0, first_human_response_min: null, last_activity: "2026-07-21T06:00:00Z", last_dir: "in" },
      { wa_id: "3", created_date: "2026-07-20", phone: "966...", owner: "Omar", stage: "new", source_ad_id: "A",
        conv_type: "awaiting_human", human_replied: 0, first_human_response_min: null, last_activity: "2026-07-20T16:00:00Z", last_dir: "in" },
      { wa_id: "4", created_date: "2026-07-19", phone: "966...", owner: "Sara", stage: "new", source_ad_id: "A",
        conv_type: "awaiting_human", human_replied: 0, first_human_response_min: null, last_activity: "2026-07-19T00:00:00Z", last_dir: "in" },
      { wa_id: "5", created_date: "2026-07-21", phone: "966...", owner: null, stage: "new", source_ad_id: "A",
        conv_type: "bot_only", human_replied: 0, first_human_response_min: null, last_activity: "2026-07-21T06:00:00Z", last_dir: "in" },
    ];
    const { leads } = await gatherContactStatus("2026-07-01", "2026-07-21", { now: NOW, workHours: WH });
    const by = Object.fromEntries(leads.map((l) => [l.wa_id, l]));
    expect(by["1"]).toMatchObject({ contacted: true, status: "contacted", est_cost_aed: 10 });
    expect(by["2"]).toMatchObject({ contacted: false, status: "pending_in_hours", wa_window_open: true, after_hours: false });
    expect(by["3"]).toMatchObject({ status: "pending_after_hours", after_hours: true, wa_window_open: true });
    expect(by["4"]).toMatchObject({ status: "expired_no_contact", wa_window_open: false });
    // bot_only = customer talked only to the bot, no human → counts as not
    // contacted (in-hours, recent → pending_in_hours), not "no_human_needed".
    expect(by["5"].status).toBe("pending_in_hours");
  });

  it("rollup by owner counts contacted / not-contacted (after-hours vs negligence) + cost split", async () => {
    state.ads = [{ ad_id: "A", spend_aed: 100, leads: 10 }];
    state.rows = [
      { wa_id: "1", created_date: "2026-07-21", phone: "966", owner: "Omar", stage: "interested", source_ad_id: "A", conv_type: "human_handled", human_replied: 1, last_activity: "2026-07-21T06:00:00Z", last_dir: "out" },
      { wa_id: "2", created_date: "2026-07-21", phone: "966", owner: "Omar", stage: "new", source_ad_id: "A", conv_type: "awaiting_human", human_replied: 0, last_activity: "2026-07-20T16:00:00Z", last_dir: "in" }, // after-hours
      { wa_id: "3", created_date: "2026-07-21", phone: "966", owner: "Omar", stage: "new", source_ad_id: "A", conv_type: "awaiting_human", human_replied: 0, last_activity: "2026-07-21T06:00:00Z", last_dir: "in" }, // in-hours negligence
      { wa_id: "4", created_date: "2026-07-21", phone: "966", owner: "Omar", stage: "new", source_ad_id: "A", conv_type: "bot_only", human_replied: 0, last_activity: "2026-07-21T06:00:00Z", last_dir: "in" }, // bot_only in-hours -> negligence
    ];
    const { leads } = await gatherContactStatus("2026-07-01", "2026-07-21", { now: NOW, workHours: WH });
    const [omar] = rollup(leads, (l) => l.owner);
    // bot_only (wa 4) now counts as not-contacted (in-hours negligence).
    expect(omar).toMatchObject({ key: "Omar", leads: 4, contacted: 1, not_contacted: 3, after_hours: 1, negligence: 2 });
    expect(omar.cost_contacted).toBe(10);
    expect(omar.cost_not_contacted).toBe(30);
  });
});

// The owner spotted a customer listed under "Interested" whose own transcript
// said they refused twice and asked not to be contacted again. Wati's stage said
// "Qualified"; the AI's reading said cold. This is that bug, pinned.
describe("interest", () => {
  it("does not call a lead interested when the transcript says they refused", () => {
    const r = interest({ stage: "qualified", ai_intent: "cold", ai_status: "غير مهتم، رفض فتح حساب وطلب عدم متابعة" });
    expect(r.interested).toBe(false);
    // The disagreement is reported, not swallowed: the Wati stage needs fixing.
    expect(r.interest_conflict).toBe(true);
    expect(r.ai_intent).toBe("cold");
  });

  it("keeps a qualified lead the AI reads as warm or hot", () => {
    for (const ai of ["warm", "hot"]) {
      const r = interest({ stage: "qualified", ai_intent: ai });
      expect(r.interested, ai).toBe(true);
      expect(r.interest_conflict, ai).toBe(false);
    }
  });

  it("falls back to the Wati stage when no conversation has been analysed", () => {
    // 188 of 292 qualified leads have no AI reading; they must not all vanish.
    expect(interest({ stage: "qualified", ai_intent: null }).interested).toBe(true);
    expect(interest({ stage: "new", ai_intent: null }).interested).toBe(false);
    expect(interest({ stage: "qualified" }).interest_conflict).toBe(false);
  });

  it("is a veto, not a promotion", () => {
    // A warm reading must NOT invent progress the CRM never recorded — "warm"
    // describes most conversations, and promoting them would turn this metric
    // into a count of everyone who replied.
    expect(interest({ stage: "new", ai_intent: "warm" }).interested).toBe(false);
    expect(interest({ stage: "new", ai_intent: "hot" }).interested).toBe(false);
    // And a cold reading on a lead that never progressed is not a conflict.
    expect(interest({ stage: "new", ai_intent: "cold" }).interest_conflict).toBe(false);
  });

  it("accepts every stage the pipeline counts as progress", () => {
    for (const stage of ["qualified", "interested", "demo", "deposit"]) {
      expect(interest({ stage }).interested, stage).toBe(true);
    }
    for (const stage of ["new", "lost", "", null, undefined]) {
      expect(interest({ stage }).interested, String(stage)).toBe(false);
    }
  });

  it("survives an empty row", () => {
    expect(() => interest()).not.toThrow();
    expect(interest().interested).toBe(false);
  });
});

describe("interest inside gatherContactStatus", () => {
  it("drops a refusing lead from the interested rollup", async () => {
    state.rows = [
      { wa_id: "yes", created_date: "2026-07-21", phone: "966...", owner: "Omar", stage: "qualified",
        conv_type: "human_handled", human_replied: 1, last_activity: "2026-07-21T06:00:00Z", last_dir: "out",
        ai_intent: "warm", ai_status: "مهتم بحساب حقيقي" },
      { wa_id: "no", created_date: "2026-07-21", phone: "966...", owner: "Omar", stage: "qualified",
        conv_type: "human_handled", human_replied: 1, last_activity: "2026-07-21T06:00:00Z", last_dir: "out",
        ai_intent: "cold", ai_status: "غير مهتم، رفض فتح حساب وطلب عدم متابعة" },
    ];
    const { leads } = await gatherContactStatus("2026-07-01", "2026-07-21", { now: NOW, workHours: WH });
    expect(leads.find((l) => l.wa_id === "yes").interested).toBe(true);
    expect(leads.find((l) => l.wa_id === "no").interested).toBe(false);
    expect(leads.find((l) => l.wa_id === "no").interest_conflict).toBe(true);

    const [g] = Object.values(rollup(leads, (l) => l.owner));
    expect(g.interested).toBe(1); // not 2
  });
});
