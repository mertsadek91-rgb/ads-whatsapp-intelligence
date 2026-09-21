// Drill-down behind a number on the board. The property that matters is
// AGREEMENT: a popup showing 30 rows under a card reading 28 destroys trust in
// both. So these tests check the predicates against the same lead shapes the
// board sees, and pin the two defects live data exposed.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { leads: [], evals: [], issues: [], detail: [] };

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql) => {
    if (sql.includes("from ads_conversation_eval")) return state.evals;
    if (sql.includes("from ads_conversation_issue")) return state.issues;
    if (sql.includes("c.full_name")) return state.detail;
    return [];
  }),
}));
vi.mock("../src/lib/contactStatus.js", () => ({
  gatherContactStatus: vi.fn(async () => ({ leads: state.leads })),
}));
vi.mock("../src/lib/weeklyReports.js", () => ({ dubaiYmd: () => "2026-07-28" }));

const { drill, DRILL_METRICS, isDrillMetric } = await import("../src/lib/qualityDrill.js");

const lead = (over = {}) => ({
  wa_id: "w" + Math.random().toString(36).slice(2, 8), owner: "Ihsan", contacted: true,
  after_hours: false, first_human_response_min: 10, interested: false, stage: "new",
  created_date: "2026-07-28", last_activity: "2026-07-28T10:00:00Z", status: "contacted", ...over,
});

beforeEach(() => { state.leads = []; state.evals = []; state.issues = []; state.detail = []; });

describe("metric vocabulary", () => {
  it("labels every metric in both languages", () => {
    for (const [k, v] of Object.entries(DRILL_METRICS)) {
      expect(v.ar, k).toBeTruthy();
      expect(v.en, k).toBeTruthy();
    }
  });
  it("refuses an unknown metric instead of returning everything", async () => {
    expect(isDrillMetric("nope")).toBe(false);
    await expect(drill({ metric: "nope" })).rejects.toThrow(/unknown drill metric/);
  });
});

describe("population matches the board", () => {
  it("applies the same exclusions, so the totals can line up", async () => {
    state.leads = [
      lead(), lead(),
      lead({ status: "no_human_needed" }),        // nobody to contact
      lead({ status: "channel_unavailable" }),    // second number we cannot read
      lead({ owner: "IST Bot" }),                 // automation gets no row
      lead({ owner: null }),                      // unassigned
    ];
    const d = await drill({ metric: "leads", days: 7 });
    expect(d.total).toBe(2);
  });

  it("splits not-contacted the same way the board does", async () => {
    state.leads = [
      lead({ contacted: true }),
      lead({ contacted: false, after_hours: true }),
      lead({ contacted: false, after_hours: false }),
      lead({ contacted: false, after_hours: false }),
    ];
    expect((await drill({ metric: "contacted" })).total).toBe(1);
    expect((await drill({ metric: "not_contacted" })).total).toBe(3);
    expect((await drill({ metric: "after_hours" })).total).toBe(1);
    expect((await drill({ metric: "negligence" })).total).toBe(2);
  });

  it("scopes to one employee, whitespace-folded like everywhere else", async () => {
    state.leads = [lead({ owner: "Yaser  Kamoun" }), lead({ owner: "Ihsan" })];
    const d = await drill({ metric: "leads", agent: "Yaser Kamoun" });
    expect(d.total).toBe(1);
    expect(d.agent).toBe("Yaser Kamoun");
  });

  it("counts qualified off the AI score, not the stage", async () => {
    const a = lead(), b = lead(), c = lead();
    state.leads = [a, b, c];
    state.evals = [
      { wa_id: a.wa_id, qualification_score: 90, next_step_reached: 0, next_step_type: null },
      { wa_id: b.wa_id, qualification_score: 20, next_step_reached: 0, next_step_type: null },
    ];
    expect((await drill({ metric: "qualified" })).total).toBe(1);
  });

  it("excludes a shallow next-step type — the defect live data exposed", async () => {
    // the popup counted 30 where the card read 28, because "the customer asked
    // for information" is a next_step_type but not progress toward an account
    const a = lead(), b = lead(), c = lead();
    state.leads = [a, b, c];
    state.evals = [
      { wa_id: a.wa_id, qualification_score: 80, next_step_reached: 1, next_step_type: "registration_completed" },
      { wa_id: b.wa_id, qualification_score: 80, next_step_reached: 1, next_step_type: "info_requested" },
      { wa_id: c.wa_id, qualification_score: 80, next_step_reached: 1, next_step_type: "closed_not_interested" },
    ];
    const d = await drill({ metric: "next_step" });
    expect(d.total).toBe(1);
    expect(d.rows[0].wa_id).toBe(a.wa_id);
  });

  it("counts over-SLA only inside working hours, and includes the never-answered", async () => {
    state.leads = [
      lead({ first_human_response_min: 5 }),                              // in target
      lead({ first_human_response_min: 90 }),                             // late
      lead({ contacted: false }),                                         // never answered
      lead({ contacted: false, after_hours: true }),                      // not judged
      lead({ contacted: true, first_human_response_min: null }),          // no timing
    ];
    const d = await drill({ metric: "over_sla", slaMinutes: 30 });
    expect(d.total).toBe(3);
  });

  it("lists conversations with a live finding and drops the rejected ones", async () => {
    const a = lead(), b = lead();
    state.leads = [a, b];
    state.issues = [{ wa_id: a.wa_id, type: "guaranteed_profit", severity: "critical", confidence: 1, review_status: "pending" }];
    const d = await drill({ metric: "risk", lang: "en" });
    expect(d.total).toBe(1);
    expect(d.rows[0].issues[0]).toMatchObject({ type: "guaranteed_profit", severity: "critical" });
    expect(d.rows[0].issues[0].type_label).toBe("Guaranteed-profit promise");
  });
});

describe("rows", () => {
  it("carries the phone from the contacts row — the whole point of the popup", async () => {
    // reading it off the shaped contactStatus lead put `undefined` in every row
    const a = lead();
    state.leads = [a];
    state.detail = [{ wa_id: a.wa_id, full_name: "Sami", phone: "9715551234", country: "AE", num_messages: 12 }];
    const d = await drill({ metric: "leads" });
    expect(d.rows[0].phone).toBe("9715551234");
    expect(d.rows[0].full_name).toBe("Sami");
    expect(d.rows[0].messages).toBe(12);
  });

  it("still returns a row when the contact has no detail at all", async () => {
    state.leads = [lead()];
    const d = await drill({ metric: "leads" });
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].full_name).toBeNull();
  });

  it("caps the page and says so, newest activity first", async () => {
    state.leads = [
      lead({ last_activity: "2026-07-20T00:00:00Z" }),
      lead({ last_activity: "2026-07-28T00:00:00Z" }),
      lead({ last_activity: "2026-07-24T00:00:00Z" }),
    ];
    const d = await drill({ metric: "leads", limit: 2 });
    expect(d.total).toBe(3);
    expect(d.shown).toBe(2);
    expect(d.truncated).toBe(true);
    expect(d.rows[0].last_activity).toBe("2026-07-28T00:00:00Z");
  });
});
