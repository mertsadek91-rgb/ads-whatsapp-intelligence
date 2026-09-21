// The broadcast engine's safety layers are what this file pins down: the
// master switch, the two independent unconditional exclusions (our own
// AI-detected opt-out signal AND Wati's own "Allow Campaign" toggle — no
// filter combination may re-include either), visibility into contacts not
// yet backfilled with Wati's internal id (never silently dropped), and that
// the send call goes through Wati's real createAndAddLinks contract
// (internal contact ids + template id, not phone numbers + template name —
// see wati.js for why the documented public API doesn't work on this account).
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
const state = { settingsRow: [], countRows: {}, insertId: 1 };

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("select v from ads_settings")) return state.settingsRow;
    if (sql.startsWith("insert into ads_settings")) return {};
    if (sql.startsWith("insert into ads_broadcast_run")) return { insertId: state.insertId };
    if (sql.startsWith("insert into ads_broadcast_recipient")) return {};
    if (sql.startsWith("update ads_broadcast_run")) return {};
    if (sql.includes("count(*) n") && sql.includes("group by c.country_iso2")) return state.byCountry || [];
    if (sql.includes("count(*) n")) {
      const key = sql.includes("wati_contact_id is not null") ? "eligible"
        : sql.includes("not in (select wa_id from ads_conversation_tag") ? "opted" : "total";
      return [{ n: state.countRows[key] ?? 0 }];
    }
    if (sql.includes("select c.wa_id, c.full_name, c.phone, c.country_iso2, c.contact_owner")) return state.sample || [];
    if (sql.includes("select c.wa_id, c.wati_contact_id ")) return state.recipients || [];
    return [];
  }),
}));

const getMessageTemplates = vi.fn(async () => state.templates || []);
const createBroadcast = vi.fn(async (o) => {
  // Simulates Wati's real, confirmed-live behaviour: a call whose contactIds
  // include any id in state.badContactIds is rejected outright, mentioning
  // exactly the phrase Wati's own error uses.
  if (state.badContactIds?.some((id) => o.contactIds.includes(id))) {
    return { ok: false, error: 'HTTP 400: {"items":[{"code":"Broadcast","description":"Can\'t create a broadcast with exists invalid contact"}]}',
      raw: { items: [{ code: "Broadcast", description: "Can't create a broadcast with exists invalid contact" }] } };
  }
  return state.sendResult || { ok: true };
});
vi.mock("../src/lib/wati.js", () => ({
  getMessageTemplates: (...a) => getMessageTemplates(...a),
  createBroadcast: (...a) => createBroadcast(...a),
  default: {},
}));

const bc = await import("../src/lib/broadcast.js");

const APPROVED = {
  id: "6a6b11672f2f8e22fae9fe06", elementName: "callback_requested_english", status: "APPROVED",
  category: "MARKETING", language: { key: "en" }, bodyOriginal: "Hi {{name}}, following up on your request.",
  buttons: [{ type: "quick_reply" }, { type: "quick_reply" }, { type: "quick_reply" }],
};
// A real template that broke this: one url button + two quick-replies —
// Reaction.QuickReplies must have 2 slots here, not 3.
const MIXED_BUTTONS = {
  id: "webinar-template-id", elementName: "webiner_ar_08072026", status: "APPROVED",
  category: "MARKETING", language: { key: "ar" }, bodyOriginal: "تذكير بالندوة",
  buttons: [{ type: "url" }, { type: "quick_reply" }, { type: "quick_reply" }],
};

beforeEach(() => {
  calls.length = 0;
  state.settingsRow = []; state.byCountry = []; state.sample = []; state.recipients = [];
  state.countRows = { total: 0, opted: 0, eligible: 0 }; state.templates = [APPROVED];
  state.sendResult = { ok: true }; state.insertId = 1;
  getMessageTemplates.mockClear(); createBroadcast.mockClear();
});

describe("master switch", () => {
  it("defaults to disabled when no row exists", async () => {
    expect(await bc.sendEnabled()).toBe(false);
  });
  it("reflects the stored value", async () => {
    state.settingsRow = [{ v: "1" }];
    expect(await bc.sendEnabled()).toBe(true);
  });
  it("setSendEnabled writes '1' or '0' and returns the new state", async () => {
    state.settingsRow = [{ v: "1" }];
    const on = await bc.setSendEnabled(true);
    expect(on).toBe(true);
    expect(calls.some((c) => c.sql.startsWith("insert into ads_settings") && c.params[1] === "1")).toBe(true);
  });
});

describe("templates", () => {
  it("maps Wati's shape, keeping the internal template id", async () => {
    const list = await bc.templates({ channel: "9715..." });
    expect(list[0]).toMatchObject({ id: "6a6b11672f2f8e22fae9fe06", name: "callback_requested_english", status: "APPROVED", vars: ["name"] });
  });
  it("approvedTemplates drops anything not APPROVED", async () => {
    state.templates = [APPROVED, { ...APPROVED, elementName: "pending_one", status: "PENDING" }];
    const approved = await bc.approvedTemplates({ force: true });
    expect(approved.map((t) => t.name)).toEqual(["callback_requested_english"]);
  });
});

describe("audiencePreview", () => {
  it("reports total, the opt-out gap, and the not-yet-backfilled gap separately", async () => {
    state.countRows = { total: 120, opted: 100, eligible: 97 };
    const r = await bc.audiencePreview({ country: "AE" });
    expect(r).toMatchObject({ total_matching: 120, excluded_opted_out: 20, missing_contact_id: 3, eligible: 97 });
  });

  it("always applies both unconditional exclusions — our AI opt-out tag AND Wati's Allow-Campaign toggle", async () => {
    await bc.audiencePreview({ owner: "Omar" });
    const optedQueries = calls.filter((c) => c.sql.includes("count(*) n") && c.sql.includes("not in (select wa_id from ads_conversation_tag"));
    expect(optedQueries.length).toBeGreaterThan(0);
    for (const c of optedQueries) {
      expect(c.sql).toContain("coalesce(c.allow_broadcast, 1) = 1");
      expect(c.params).toEqual(expect.arrayContaining(["ENG_OPTED_OUT", "ENG_DO_NOT_WHATSAPP"]));
    }
  });

  it("the eligible tier additionally requires a backfilled Wati contact id", async () => {
    await bc.audiencePreview({});
    const eligibleQueries = calls.filter((c) => c.sql.includes("count(*) n") && c.sql.includes("wati_contact_id is not null"));
    expect(eligibleQueries.length).toBeGreaterThan(0);
  });
});

describe("expanded filter fields", () => {
  const lastCoreQuery = () => calls.filter((c) => c.sql.includes("count(*) n") && !c.sql.includes("group by")).slice(-3)[0];

  it("filters by raw Wati lead stage, source, score band, and deposit status", async () => {
    await bc.audiencePreview({ leadStage: "Qualified Trader", source: "CTWA", scoreBand: "hot", deposit: "yes" });
    const q = lastCoreQuery();
    expect(q.sql).toContain("c.lead_stage = ?");
    expect(q.sql).toContain("c.source = ?");
    expect(q.sql).toContain("c.score_band = ?");
    expect(q.sql).toContain("c.deposit_flag = 1");
    expect(q.params).toEqual(expect.arrayContaining(["Qualified Trader", "CTWA", "hot"]));
  });

  it("filters by last-activity date range independently of created-date range", async () => {
    await bc.audiencePreview({ since: "2026-01-01", activeSince: "2026-06-01", activeUntil: "2026-07-01" });
    const q = lastCoreQuery();
    expect(q.sql).toContain("c.created_date >= ?");
    expect(q.sql).toContain("c.last_message_at >= ?");
    expect(q.sql).toContain("c.last_message_at <= ?");
  });

  it("filters by message-count range and excludes unlinked-number contacts on request", async () => {
    await bc.audiencePreview({ minMessages: "2", maxMessages: "10", excludeUnlinked: true });
    const q = lastCoreQuery();
    expect(q.sql).toContain("c.num_messages >= ?");
    expect(q.sql).toContain("c.num_messages <= ?");
    expect(q.sql).toContain("coalesce(c.msg_unavailable, 0) = 0");
    expect(q.params).toEqual(expect.arrayContaining([2, 10]));
  });

  it("filters by engagement state using the same semantics as the Assignment page", async () => {
    await bc.audiencePreview({ state: "not_contacted" });
    const q = lastCoreQuery();
    expect(q.sql).toContain("m.conv_type is null or (m.conv_type <> 'human_handled'");
  });
});

describe("audienceRecipients", () => {
  it("returns wa_id + wati_contact_id pairs, capped at MAX_AUDIENCE", async () => {
    state.recipients = [{ wa_id: "w1", wati_contact_id: "c1" }, { wa_id: "w2", wati_contact_id: "c2" }];
    const r = await bc.audienceRecipients({}, 999999999);
    expect(r).toEqual([{ wa_id: "w1", wati_contact_id: "c1" }, { wa_id: "w2", wati_contact_id: "c2" }]);
    const idsQuery = calls.find((c) => c.sql.includes("select c.wa_id, c.wati_contact_id "));
    expect(idsQuery.sql).toContain(`limit ${bc.MAX_AUDIENCE}`);
  });
});

describe("sendBroadcast", () => {
  it("refuses when the master switch is off", async () => {
    state.settingsRow = [{ v: "0" }];
    await expect(bc.sendBroadcast(1, { name: "x", templateName: "callback_requested_english", filter: {} }))
      .rejects.toThrow(/مُعطَّل/);
  });

  it("refuses when no recipient is fully eligible", async () => {
    state.settingsRow = [{ v: "1" }]; state.recipients = [];
    await expect(bc.sendBroadcast(1, { name: "x", templateName: "callback_requested_english", filter: {} }))
      .rejects.toThrow(/لا يوجد عملاء/);
  });

  it("refuses when the template isn't approved for this channel", async () => {
    state.settingsRow = [{ v: "1" }]; state.recipients = [{ wa_id: "w1", wati_contact_id: "c1" }];
    await expect(bc.sendBroadcast(1, { name: "x", templateName: "not_a_real_template", filter: {} }))
      .rejects.toThrow(/القالب/);
  });

  it("calls Wati with the internal template id and internal contact ids, never phone numbers", async () => {
    state.settingsRow = [{ v: "1" }];
    state.recipients = Array.from({ length: 5 }, (_, i) => ({ wa_id: `w${i}`, wati_contact_id: `c${i}` }));

    const r = await bc.sendBroadcast(7, { name: "Promo", templateName: "callback_requested_english", channel: "9715...", filter: {} });

    expect(r).toMatchObject({ runId: 7, total: 5, sent: 5, failed: 0 });
    expect(createBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      templateId: "6a6b11672f2f8e22fae9fe06",
      contactIds: ["c0", "c1", "c2", "c3", "c4"],
      quickReplyCount: 3,
    }));
    const call = createBroadcast.mock.calls[0][0];
    expect(JSON.stringify(call.contactIds)).not.toMatch(/w\d/); // no wa_id leaked into the send payload

    const recipientInserts = calls.filter((c) => c.sql.startsWith("insert into ads_broadcast_recipient"));
    const loggedIds = recipientInserts.flatMap((c) => c.params.filter((p) => typeof p === "string" && p.startsWith("w")));
    expect(new Set(loggedIds).size).toBe(5); // logged by our own wa_id, one row per recipient
  });

  it("sizes Reaction.QuickReplies to the template's OWN quick-reply button count — a url button doesn't count", async () => {
    state.settingsRow = [{ v: "1" }];
    state.templates = [APPROVED, MIXED_BUTTONS];
    state.recipients = [{ wa_id: "w1", wati_contact_id: "c1" }];

    await bc.sendBroadcast(1, { name: "Webinar", templateName: "webiner_ar_08072026", filter: {} });

    // 1 url + 2 quick_reply buttons -> exactly 2 QuickReplies slots, not 3.
    // Sending 3 for this template is the real bug that produced "HTTP 400:
    // Invalid broadcast reaction setup" for an entire live audience.
    expect(createBroadcast).toHaveBeenCalledWith(expect.objectContaining({ quickReplyCount: 2 }));
  });

  it("chunks large audiences instead of sending everyone in one call", async () => {
    state.settingsRow = [{ v: "1" }];
    state.recipients = Array.from({ length: bc.CHUNK_SIZE + 10 }, (_, i) => ({ wa_id: `w${i}`, wati_contact_id: `c${i}` }));

    const r = await bc.sendBroadcast(1, { name: "Big", templateName: "callback_requested_english", filter: {} });
    expect(r.total).toBe(bc.CHUNK_SIZE + 10);
    expect(createBroadcast).toHaveBeenCalledTimes(2);
  });

  it("a chunk-level rejection marks every id in that chunk as error, and still records the run", async () => {
    state.settingsRow = [{ v: "1" }];
    state.recipients = [{ wa_id: "a", wati_contact_id: "ca" }, { wa_id: "b", wati_contact_id: "cb" }];
    state.sendResult = { ok: false, error: "some Wati-side rejection" };

    const r = await bc.sendBroadcast(1, { name: "x", templateName: "callback_requested_english", filter: {} });
    expect(r).toMatchObject({ sent: 0, failed: 2 });
  });

  it("isolates a single invalid contact instead of failing everyone in its batch — the real bug", async () => {
    state.settingsRow = [{ v: "1" }];
    // 8 good contacts + 1 bad one buried in the middle, all in one chunk.
    state.recipients = Array.from({ length: 9 }, (_, i) => ({ wa_id: `w${i}`, wati_contact_id: `c${i}` }));
    state.badContactIds = ["c5"];

    const r = await bc.sendBroadcast(1, { name: "x", templateName: "callback_requested_english", filter: {} });

    expect(r).toMatchObject({ total: 9, sent: 8, failed: 1 });
    const recipientInserts = calls.filter((c) => c.sql.startsWith("insert into ads_broadcast_recipient"));
    const rows = recipientInserts.flatMap((c) => {
      const flat = c.params;
      const out = [];
      for (let i = 0; i < flat.length; i += 4) out.push({ wa_id: flat[i + 1], status: flat[i + 2] });
      return out;
    });
    expect(rows.find((x) => x.wa_id === "w5")).toMatchObject({ status: "error" });
    expect(rows.filter((x) => x.wa_id !== "w5").every((x) => x.status === "queued")).toBe(true);
  });

  it("does not bisect a non-isolatable error (e.g. auth/rate-limit) — that would just waste calls", async () => {
    state.settingsRow = [{ v: "1" }];
    state.recipients = Array.from({ length: 4 }, (_, i) => ({ wa_id: `w${i}`, wati_contact_id: `c${i}` }));
    state.sendResult = { ok: false, error: "HTTP 401: unauthorized" };

    const r = await bc.sendBroadcast(1, { name: "x", templateName: "callback_requested_english", filter: {} });
    expect(r).toMatchObject({ sent: 0, failed: 4 });
    expect(createBroadcast).toHaveBeenCalledTimes(1); // no bisection attempted
  });
});
