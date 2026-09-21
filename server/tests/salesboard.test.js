// Sales-floor leaderboard aggregation. contactStatus is stubbed so the test
// drives ranking, team totals, WoW delta, and wrong-persuasion merge directly.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { cur: [], prev: [], wrong: [] };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql) => (sql.includes("from ads_conversation_analysis") ? state.wrong : {})),
}));
vi.mock("../src/lib/contactStatus.js", () => ({
  gatherContactStatus: vi.fn(async (since) => ({ leads: since === state.curSince ? state.cur : state.prev })),
  // real rollup logic is what we want to exercise → re-implement the essentials
  rollup: (leads, keyOf) => {
    const g = {};
    for (const l of leads) {
      const k = keyOf(l); if (k == null) continue;
      const a = (g[k] ||= { key: k, leads: 0, contacted: 0, not_contacted: 0, after_hours: 0, negligence: 0, interested: 0, cost_contacted: 0, cost_not_contacted: 0 });
      if (l.status === "no_human_needed") continue;
      a.leads++;
      if (l.contacted) a.contacted++; else { a.not_contacted++; if (l.after_hours) a.after_hours++; else a.negligence++; }
      if (l.interested) a.interested++;
    }
    for (const a of Object.values(g)) a.contact_rate_pct = a.leads ? Math.round((1000 * a.contacted) / a.leads) / 10 : 0;
    return Object.values(g).sort((x, y) => y.leads - x.leads);
  },
}));
vi.mock("../src/lib/weeklyReports.js", () => ({ dubaiYmd: () => "2026-07-24" }));

const { gatherSalesboard } = await import("../src/lib/salesboard.js");

const lead = (owner, contacted, interested, extra = {}) => ({ owner, contacted, interested, status: contacted ? "contacted" : "expired_no_contact", after_hours: false, first_human_response_min: null, created_date: "2026-07-20", ...extra });

beforeEach(() => {
  state.curSince = "2026-07-18"; // today(24) - 6
  state.cur = []; state.prev = []; state.wrong = [];
});

describe("gatherSalesboard", () => {
  it("ranks by contact rate, merges wrong-persuasion, computes team totals", async () => {
    state.cur = [
      // Yaser: 4 leads, 3 contacted -> 75%
      lead("Yaser Kamoun", true, true), lead("Yaser Kamoun", true, false), lead("Yaser Kamoun", true, false), lead("Yaser Kamoun", false, false),
      // Omar: 2 leads, 2 contacted -> 100%
      lead("Omar Sadka", true, true), lead("Omar Sadka", true, false),
      // a bot/unassigned owner -> goes to the "Unassigned / Bot" bucket, not a person row
      lead("Inquiry Bot", false, false),
    ];
    state.wrong = [{ agent: "Yaser Kamoun", w: 2 }, { agent: "Omar Sadka", w: 0 }];
    const g = await gatherSalesboard({ now: new Date("2026-07-24T09:00:00+04:00") });

    expect(g.rows).toHaveLength(2);                 // only human employees are ranked
    expect(g.rows[0].name).toBe("Omar Sadka");      // 100% ranked first
    expect(g.rows[0].rank).toBe(1);
    expect(g.rows[1].name).toBe("Yaser Kamoun");
    expect(g.rows[1].contact_rate_pct).toBe(75);
    expect(g.rows[1].wrong_persuasion).toBe(2);     // merged by name
    expect(g.top.name).toBe("Omar Sadka");
    // the bot lead lands in the unassigned/bot bucket (not a person row)
    expect(g.unassigned.leads).toBe(1);
    expect(g.unassigned.contacted).toBe(0);
    // team totals span everyone incl. the unassigned bucket: 6 human + 1 bot
    expect(g.totals).toMatchObject({ employees: 2, leads: 7, contacted: 5, interested: 2, wrong_persuasion: 2 });
    expect(g.totals.contact_rate_pct).toBeCloseTo(71.4, 1); // 5/7
    expect(g.target).toBe(90);
    // status bands: Omar 100% -> excellent, Yaser 75% -> excellent
    expect(g.rows[0].status).toBe("excellent");
    // daily series has one bucket per day of the window
    expect(g.daily).toHaveLength(g.days);
  });

  it("averages first-response time per employee and team, and counts within-2h", async () => {
    state.cur = [
      lead("Omar Sadka", true, false, { first_human_response_min: 30 }),
      lead("Omar Sadka", true, false, { first_human_response_min: 90 }),  // avg 60
      lead("Sara Ali", true, false, { first_human_response_min: 200 }),   // >120, not within-2h
    ];
    const g = await gatherSalesboard({ now: new Date("2026-07-24T09:00:00+04:00") });
    const omar = g.rows.find((r) => r.name === "Omar Sadka");
    expect(omar.avg_response_min).toBe(60);
    expect(g.totals.within_2h).toBe(2);            // Omar's two (30, 90)
    expect(g.totals.avg_response_min).toBeCloseTo(106.7, 1); // (30+90+200)/3
  });

  it("computes a week-over-week delta from the previous window", async () => {
    state.cur = [lead("Sara", true, false), lead("Sara", true, false)]; // 100%
    state.prev = [lead("Sara", true, false), lead("Sara", false, false)]; // 50%
    const g = await gatherSalesboard({ now: new Date("2026-07-24T09:00:00+04:00") });
    expect(g.rows[0].prev_contact_rate_pct).toBe(50);
    expect(g.rows[0].delta_pct).toBe(50);           // +50 points
  });

  it("returns no top performer when there are zero leads", async () => {
    const g = await gatherSalesboard({ now: new Date("2026-07-24T09:00:00+04:00") });
    expect(g.rows).toHaveLength(0);
    expect(g.top).toBeNull();
    expect(g.totals.contact_rate_pct).toBe(0);
  });
});
