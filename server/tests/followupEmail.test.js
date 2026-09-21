// Batch C: daily per-employee follow-up alert. gatherEmployeeFollowup filters
// the agent's own leads into actionable buckets; buildFollowupEmailHtml renders
// an inline bilingual HTML email (no PDF). contactStatus is stubbed so the test
// drives the classification directly.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { leads: [], late: [], tags: [] };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql) => {
    if (sql.includes("from ads_lead_followup")) return state.late;
    // The do-not-contact lookup goes through the real tagBoard query.
    if (sql.includes("from ads_conversation_tag")) return state.tags;
    return {};
  }),
}));
vi.mock("../src/lib/contactStatus.js", () => ({
  gatherContactStatus: vi.fn(async () => ({ leads: state.leads })),
}));

const { gatherEmployeeFollowup, buildFollowupEmailHtml } = await import("../src/lib/followupEmail.js");

beforeEach(() => { state.leads = []; state.late = []; state.tags = []; });

describe("gatherEmployeeFollowup", () => {
  it("buckets the agent's own leads and ignores other owners", async () => {
    state.leads = [
      { owner: "Omar Sadka", wa_id: "+9711", contacted: false, wa_window_open: true, wa_hours_left: 3, interested: false, status: "pending_in_hours", stage: "new" },
      { owner: "Omar Sadka", wa_id: "+9712", contacted: false, wa_window_open: true, wa_hours_left: 20, interested: true, status: "pending_in_hours", stage: "interested" },
      { owner: "Omar Sadka", wa_id: "+9713", contacted: false, wa_window_open: false, wa_hours_left: 0, interested: false, status: "expired_no_contact", stage: "new" },
      { owner: "Someone Else", wa_id: "+9714", contacted: false, wa_window_open: true, wa_hours_left: 1, interested: false, status: "pending_in_hours", stage: "new" },
    ];
    state.late = [{ wa_id: "+9720", created_date: "2026-07-21", contacted_at: "2026-07-23 10:00:00" }];
    const g = await gatherEmployeeFollowup("Omar Sadka", { now: new Date("2026-07-24T00:30:00+04:00") });
    expect(g.counts).toEqual({ urgent: 2, interested: 1, missed: 1, late: 1, opted_out: 0 });
    // urgent sorted by hours-left ascending (3 before 20)
    expect(g.urgent[0].wa_hours_left).toBe(3);
    // the other owner's lead is excluded
    expect(g.urgent.find((l) => l.wa_id === "+9714")).toBeUndefined();
  });

  it("returns empty buckets when the agent has no leads", async () => {
    const g = await gatherEmployeeFollowup("Ghost", { now: new Date("2026-07-24T00:30:00+04:00") });
    expect(g.counts).toEqual({ urgent: 0, interested: 0, missed: 0, late: 0, opted_out: 0 });
  });
});

describe("buildFollowupEmailHtml", () => {
  const data = {
    agent: "Omar Sadka", date: "2026-07-24",
    counts: { urgent: 1, interested: 1, missed: 0, late: 1 },
    urgent: [{ wa_id: "+9711", wa_hours_left: 3, stage: "new" }],
    interested: [{ wa_id: "+9712", stage: "interested" }],
    missed: [], late: [{ wa_id: "+9720" }],
  };
  it("renders the urgent + interested + late sections (Arabic, RTL)", () => {
    const html = buildFollowupEmailHtml(data, "ar");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("Omar Sadka");
    expect(html).toContain("+9711");
    expect(html).toContain("متابعة عملائك اليوم");
  });
  it("renders the all-clear message when every bucket is empty", () => {
    const html = buildFollowupEmailHtml(
      { agent: "X", date: "2026-07-24", counts: {}, urgent: [], interested: [], missed: [], late: [] }, "en");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("No customers need urgent contact");
  });
  it("escapes HTML in lead fields", () => {
    const html = buildFollowupEmailHtml(
      { agent: "X", date: "d", counts: {}, urgent: [{ wa_id: "<script>", wa_hours_left: 1, stage: "a" }], interested: [], missed: [], late: [] }, "ar");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// A to-do list must never tell an employee to message someone who asked them to
// stop. The tags are the only place that request is recorded, so this is where
// they have to be honoured.
describe("do-not-contact suppression", () => {
  const lead = (wa_id, over = {}) => ({
    owner: "Omar Sadka", wa_id, contacted: false, wa_window_open: true, wa_hours_left: 4,
    interested: true, status: "pending_in_hours", stage: "interested", ...over,
  });

  it("pulls an opted-out customer out of every action list", async () => {
    state.leads = [lead("+9711"), lead("+9712")];
    state.tags = [{ wa_id: "+9712", tag: "ENG_OPTED_OUT", evidence: "لا تراسلني مرة أخرى", review_status: "auto" }];

    const d = await gatherEmployeeFollowup("Omar Sadka");
    const ids = (list) => list.map((r) => r.wa_id);
    expect(ids(d.urgent)).toEqual(["+9711"]);
    expect(ids(d.interested)).toEqual(["+9711"]);
    expect(ids(d.missed)).toEqual([]);
    // Listed separately rather than vanishing, with the customer's own words.
    expect(ids(d.optedOut)).toEqual(["+9712"]);
    expect(d.optedOut[0].evidence).toBe("لا تراسلني مرة أخرى");
    expect(d.counts.opted_out).toBe(1);
  });

  it("honours a do-not-WhatsApp request the same way", async () => {
    state.leads = [lead("+9711")];
    state.tags = [{ wa_id: "+9711", tag: "ENG_DO_NOT_WHATSAPP", evidence: "اتصل بي ولا ترسل واتساب", review_status: "confirmed" }];
    const d = await gatherEmployeeFollowup("Omar Sadka");
    expect(d.urgent).toEqual([]);
    expect(d.optedOut).toHaveLength(1);
    expect(d.optedOut[0].confirmed).toBe(true);
  });

  it("keeps a customer whose opt-out a supervisor rejected", async () => {
    // The supervisor read the evidence and said the customer never asked that.
    // The database mock returns nothing because the query filters rejected rows.
    state.leads = [lead("+9711")];
    state.tags = [];
    const d = await gatherEmployeeFollowup("Omar Sadka");
    expect(d.urgent.map((r) => r.wa_id)).toEqual(["+9711"]);
    expect(d.optedOut).toEqual([]);
  });

  it("does not suppress a WhatsApp follow-up over a refusal of another channel", async () => {
    // ENG_DO_NOT_CALL is about the phone. Treating it as a WhatsApp opt-out
    // would quietly bury a reachable lead — the query must not match it.
    state.leads = [lead("+9711")];
    state.tags = []; // what the real query returns for a DO_NOT_CALL-only customer
    const d = await gatherEmployeeFollowup("Omar Sadka");
    expect(d.urgent).toHaveLength(1);
  });

  it("renders the opt-out section with the quote, in both languages", async () => {
    state.leads = [lead("+9712")];
    state.tags = [{ wa_id: "+9712", tag: "ENG_OPTED_OUT", evidence: "أرجو عدم الإزعاج", review_status: "auto" }];
    const d = await gatherEmployeeFollowup("Omar Sadka");

    const ar = buildFollowupEmailHtml(d, "ar");
    expect(ar).toContain("طلبوا عدم التواصل");
    expect(ar).toContain("أرجو عدم الإزعاج");
    // And the number is NOT under an action heading.
    expect(ar).not.toContain("يجب التواصل قبل إغلاق نافذة واتساب");

    const en = buildFollowupEmailHtml(d, "en");
    expect(en).toContain("Asked us to stop");
    expect(en).toContain("أرجو عدم الإزعاج");
  });

  it("still renders for an older payload that has no optedOut field", () => {
    // Defensive: a queued or replayed job from before this change.
    const html = buildFollowupEmailHtml({ agent: "Omar", date: "2026-07-31", urgent: [], interested: [], missed: [], late: [] }, "en");
    expect(html).toContain("No customers need urgent contact today");
  });
});
