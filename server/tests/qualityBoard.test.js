// Aggregation from per-conversation evaluations to per-employee scores. The
// things pinned here are the ones a plausible-looking implementation gets wrong:
// who counts as an employee, what the conversion denominator is, whether an
// unevaluated employee shows a fabricated zero, and what the public feed leaks.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { leads: [], evals: [], issues: [], coverage: { total: 0, evaluated: 0 }, snapshot: [] };

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql) => {
    if (sql.includes("from ads_conversation_eval e")) return state.evals;
    if (sql.includes("from ads_conversation_issue i")) return state.issues;
    if (sql.includes("sum(case when e.wa_id is null then 0 else 1 end)")) {
      return [{ total: state.coverage.total, evaluated: state.coverage.evaluated }];
    }
    if (sql.includes("from ads_employee_score_snapshot")) return state.snapshot;
    if (sql.startsWith("insert into ads_employee_score_snapshot")) return {};
    return [];
  }),
}));

// contactStatus owns "did a human reply / was it after hours" and is already
// covered by its own tests — stub it so this file tests only the aggregation.
vi.mock("../src/lib/contactStatus.js", () => ({
  gatherContactStatus: vi.fn(async () => ({ leads: state.leads })),
  rollup: (leads, keyOf) => {
    const g = {};
    for (const l of leads) {
      const k = keyOf(l);
      if (k == null) continue;
      const a = (g[k] ||= { key: k, leads: 0, contacted: 0, not_contacted: 0, interested: 0, after_hours: 0, negligence: 0 });
      a.leads++;
      if (l.contacted) a.contacted++; else { a.not_contacted++; if (l.after_hours) a.after_hours++; else a.negligence++; }
      if (l.interested) a.interested++;
    }
    return Object.values(g);
  },
}));
vi.mock("../src/lib/weeklyReports.js", () => ({ dubaiYmd: () => "2026-07-28" }));

const { gatherQualityBoard, saveSnapshot, scanWindow } = await import("../src/lib/qualityBoard.js");
const { publicView } = await import("../src/routes/publicBoard.js");

const lead = (over = {}) => ({
  owner: "Ihsan", contacted: true, after_hours: false, first_human_response_min: 10,
  interested: false, created_date: "2026-07-28", status: "contacted", ...over,
});
const evaluation = (over = {}) => ({
  owner: "Ihsan", wa_id: "w" + Math.random(),
  persuasion_score: 80, compliance_score: 100, objection_score: 70, continuity_score: 85,
  professionalism_score: 90, next_step_score: 75, classification_score: 80,
  qualification_score: 80, next_step_reached: 1, next_step_type: "registration_completed",
  // The default fixture is an engaged conversation: the customer came back after
  // the employee replied. Pass replied_after_agent: 0 for a drive-by enquiry.
  replied_after_agent: 1,
  completed_correctly: 1, follow_up_required: 0, confidence: 0.9, ...over,
});

beforeEach(() => {
  state.leads = []; state.evals = []; state.issues = [];
  state.coverage = { total: 0, evaluated: 0 }; state.snapshot = [];
});

describe("who gets a row", () => {
  it("scores humans and never the bot or the unassigned bucket", async () => {
    state.leads = [
      lead({ owner: "Ihsan" }),
      lead({ owner: "IST Markets Bot" }),
      lead({ owner: "qualifier-flow" }),
      lead({ owner: null }),
      lead({ owner: "6f1c2ab9-1234-4aaa-bbbb-cccccccccccc" }),
    ];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows.map((r) => r.name)).toEqual(["Ihsan"]);
  });

  it("folds the double spaces Wati puts in owner names", async () => {
    state.leads = [lead({ owner: "Yaser  Kamoun" })];
    state.evals = [evaluation({ owner: "Yaser Kamoun" })];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].name).toBe("Yaser Kamoun");
    expect(board.rows[0].sample_size).toBe(1);   // the eval matched the same person
  });
});

describe("conversion denominator", () => {
  it("counts only AI-qualified conversations, not everyone contacted", async () => {
    state.leads = Array.from({ length: 10 }, () => lead());
    state.evals = [
      evaluation({ qualification_score: 90, next_step_reached: 1, next_step_type: "registration_completed" }),
      evaluation({ qualification_score: 90, next_step_reached: 0, next_step_type: null }),
      // eight unqualified ones must not dilute the rate
      ...Array.from({ length: 8 }, () => evaluation({ qualification_score: 20, next_step_reached: 0, next_step_type: null })),
    ];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].qualified).toBe(2);
    expect(board.rows[0].next_step).toBe(1);
    expect(board.rows[0].conversion).toBeGreaterThan(0);
  });

  it("drops qualified leads who never replied after the employee did", async () => {
    // The defect this fixes: across the live data the qualification score sat
    // flat at 70-72 whether the customer sent one message or held a nine-message
    // conversation, so 41% of the denominator was people who asked once and
    // vanished. An employee cannot convert someone who never came back.
    state.leads = Array.from({ length: 10 }, () => lead());
    state.evals = [
      evaluation({ qualification_score: 90, next_step_reached: 1, next_step_type: "registration_completed" }),
      ...Array.from({ length: 4 }, () => evaluation({
        qualification_score: 90, next_step_reached: 0, next_step_type: null, replied_after_agent: 0,
      })),
    ];
    const board = await gatherQualityBoard({ days: 7 });
    const r = board.rows[0];
    // The pipeline count is untouched — all five did qualify.
    expect(r.qualified).toBe(5);
    // ...but only one is convertible, so the rate is 1/1 and not 1/5.
    expect(r.convertible).toBe(1);
    expect(r.ghosted).toBe(4);
    // 100% next-step x0.6 + 100% registered x0.25 = 85; a deposit would add the
    // remaining 15. Before this change the same work scored 1/5 = 17.
    expect(r.conversion).toBe(85);
  });

  it("scores nobody rather than zero when every qualified lead ghosted", async () => {
    // A denominator of zero is "we cannot tell", not "they failed" — the same
    // rule the board already applies to an employee with no evaluated work.
    state.leads = Array.from({ length: 5 }, () => lead());
    state.evals = Array.from({ length: 3 }, () => evaluation({
      qualification_score: 90, next_step_reached: 0, next_step_type: null, replied_after_agent: 0,
    }));
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].qualified).toBe(3);
    expect(board.rows[0].ghosted).toBe(3);
    expect(board.rows[0].conversion).toBe(null);
  });

  it("keeps a booked next step even when the customer never wrote again", async () => {
    // Caught on live data: a customer can ask for a callback in their first
    // message and have nothing left to say once the employee confirms. The
    // engagement flag reads 0, but that is a win, not a ghost — gating it away
    // erased an employee's only conversion of the week.
    state.leads = Array.from({ length: 5 }, () => lead());
    state.evals = [
      evaluation({ qualification_score: 90, next_step_reached: 1, next_step_type: "callback_requested", replied_after_agent: 0 }),
      evaluation({ qualification_score: 90, next_step_reached: 0, next_step_type: null, replied_after_agent: 0 }),
    ];
    const board = await gatherQualityBoard({ days: 7 });
    const r = board.rows[0];
    expect(r.convertible).toBe(1);  // the win is in the denominator
    expect(r.ghosted).toBe(1);      // the silent one is not
    expect(r.next_step).toBe(1);
    expect(r.conversion).toBe(60);  // 100% next-step x0.6, no registration or deposit
  });

  it("never lets the rate exceed 100%: the numerator cannot outrun its denominator", async () => {
    // Every conversation with a next step is convertible by construction, so
    // next_step <= convertible always holds.
    state.leads = Array.from({ length: 6 }, () => lead());
    state.evals = Array.from({ length: 4 }, () => evaluation({
      qualification_score: 90, next_step_reached: 1, next_step_type: "demo_requested", replied_after_agent: 0,
    }));
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].next_step).toBeLessThanOrEqual(board.rows[0].convertible);
    expect(board.rows[0].conversion).toBeLessThanOrEqual(100);
  });

  it("does not count merely answering a question as progress", async () => {
    state.evals = [evaluation({ next_step_reached: 1, next_step_type: "info_requested" })];
    state.leads = [lead()];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].qualified).toBe(1);
    expect(board.rows[0].next_step).toBe(0);
  });
});

describe("employees with no evaluation yet", () => {
  it("leaves the quality scores null instead of showing a fabricated zero", async () => {
    state.leads = [lead({ owner: "NewHire" })];
    const board = await gatherQualityBoard({ days: 7 });
    const row = board.rows[0];
    expect(row.persuasion).toBeNull();
    expect(row.conversion).toBeNull();
    expect(row.sample_size).toBe(0);
    expect(row.provisional).toBe(true);
    expect(row.eligible).toBe(false);
    expect(row.reasons).toContain("insufficient_data");
  });

  it("shows no overall score at all when there is no quality component to base it on", async () => {
    // seen live: one employee holding a single uncontacted lead appeared on the
    // wall screen as "0.0" beside their name. That is one missed lead, not a
    // performance verdict — overallScore would otherwise renormalize onto
    // productivity alone.
    state.leads = [lead({ owner: "OneLead", contacted: false, after_hours: false })];
    const board = await gatherQualityBoard({ days: 7 });
    const row = board.rows[0];
    expect(row.productivity).toBe(0);      // the raw fact is still reported
    expect(row.overall).toBeNull();        // but it is not called a score
    expect(row.overall_raw).toBeNull();
    expect(row.provisional).toBe(true);
  });

  it("computes an overall as soon as one quality component exists", async () => {
    state.leads = [lead()];
    state.evals = [evaluation()];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].overall).toBeGreaterThan(0);
  });

  it("still reports their contact activity, so the board is useful before any AI runs", async () => {
    state.leads = [lead({ owner: "NewHire" }), lead({ owner: "NewHire", contacted: false, after_hours: false })];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].leads).toBe(2);
    expect(board.rows[0].contacted).toBe(1);
    expect(board.rows[0].contact_rate_pct).toBe(50);
  });
});

describe("compliance from issues", () => {
  it("takes the lower of the reported score and what the issues imply", async () => {
    state.leads = [lead()];
    state.evals = [evaluation({ compliance_score: 98 })];
    state.issues = [{ owner: "Ihsan", wa_id: "w1", type: "guaranteed_profit", severity: "critical", confidence: 1, review_status: "pending" }];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].compliance).toBeLessThan(98);
  });

  it("caps the overall score only once a critical issue is CONFIRMED", async () => {
    state.leads = Array.from({ length: 20 }, () => lead());
    state.evals = Array.from({ length: 20 }, () => evaluation());
    state.coverage = { total: 20, evaluated: 20 };
    state.issues = [{ owner: "Ihsan", wa_id: "w1", type: "guaranteed_profit", severity: "critical", confidence: 1, review_status: "pending" }];
    const pending = await gatherQualityBoard({ days: 7 });
    expect(pending.rows[0].capped).toBe(false);

    state.issues[0].review_status = "confirmed";
    const confirmed = await gatherQualityBoard({ days: 7 });
    expect(confirmed.rows[0].capped).toBe(true);
    expect(confirmed.rows[0].overall).toBe(60);
    expect(confirmed.rows[0].overall_raw).toBeGreaterThan(60);
  });

  it("scores compliance as a rate, so volume is not punished", async () => {
    // measured live: the busiest employee accumulated 25 findings over 49
    // conversations and floored at 0, while a colleague with 5 conversations sat
    // at 37 — the opposite of what the numbers meant.
    const oneProblemEach = (owner, n) => ({
      leads: Array.from({ length: n }, () => lead({ owner })),
      evals: Array.from({ length: n }, (_, i) => evaluation({ owner, wa_id: `${owner}-${i}`, compliance_score: null })),
      issues: Array.from({ length: n }, (_, i) => ({
        owner, wa_id: `${owner}-${i}`, type: "risk_disclosure_missing",
        severity: "major", confidence: 1, review_status: "pending",
      })),
    });
    const busy = oneProblemEach("Busy", 40);
    const quiet = oneProblemEach("Quiet", 5);
    state.leads = [...busy.leads, ...quiet.leads];
    state.evals = [...busy.evals, ...quiet.evals];
    state.issues = [...busy.issues, ...quiet.issues];

    const board = await gatherQualityBoard({ days: 7 });
    const b = board.rows.find((r) => r.name === "Busy");
    const q = board.rows.find((r) => r.name === "Quiet");
    expect(b.compliance).toBe(q.compliance);   // same problem rate => same score
    expect(b.compliance).toBe(80);             // one major finding per conversation
  });

  it("gives a clean conversation full marks in the average", async () => {
    state.leads = Array.from({ length: 4 }, () => lead());
    state.evals = Array.from({ length: 4 }, (_, i) => evaluation({ wa_id: `w${i}`, compliance_score: null }));
    // one of four conversations has a problem
    state.issues = [{ owner: "Ihsan", wa_id: "w0", type: "risk_disclosure_missing", severity: "major", confidence: 1, review_status: "pending" }];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].compliance).toBe(95);   // (80 + 100 + 100 + 100) / 4
  });

  it("counts issues by severity and review state for the risk column", async () => {
    state.leads = [lead()];
    state.evals = [evaluation()];
    state.issues = [
      { owner: "Ihsan", wa_id: "a", type: "risk_disclosure_missing", severity: "major", confidence: 0.9, review_status: "pending" },
      { owner: "Ihsan", wa_id: "b", type: "premature_link", severity: "minor", confidence: 0.8, review_status: "confirmed" },
    ];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].risk).toMatchObject({ major: 1, minor: 1, confirmed: 1, pending: 1, critical: 0 });
  });
});

describe("response performance", () => {
  it("judges only leads that arrived during working hours", async () => {
    state.leads = [
      lead({ first_human_response_min: 5 }),                        // in hours, in SLA
      lead({ first_human_response_min: 900, after_hours: true }),   // must not count
    ];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].sla_answerable).toBe(1);
    expect(board.rows[0].within_sla).toBe(1);
    expect(board.rows[0].response).toBe(100);
  });

  it("reports the median, not just the mean, so one outlier can't hide a habit", async () => {
    state.leads = [
      lead({ first_human_response_min: 5 }), lead({ first_human_response_min: 10 }),
      lead({ first_human_response_min: 2000 }),
    ];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].median_response_min).toBe(10);
    expect(board.rows[0].avg_response_min).toBeGreaterThan(600);
  });
});

describe("highlights", () => {
  it("never nominates an ineligible employee as top performer", async () => {
    state.leads = [...Array.from({ length: 20 }, () => lead({ owner: "Flagged" })),
                   ...Array.from({ length: 20 }, () => lead({ owner: "Solid" }))];
    state.evals = [
      ...Array.from({ length: 20 }, () => evaluation({ owner: "Flagged", persuasion_score: 99 })),
      ...Array.from({ length: 20 }, () => evaluation({ owner: "Solid", persuasion_score: 80 })),
    ];
    state.coverage = { total: 40, evaluated: 40 };
    state.issues = [{ owner: "Flagged", wa_id: "x", type: "guaranteed_profit", severity: "critical", confidence: 1, review_status: "confirmed" }];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.highlights.top_performer.name).toBe("Solid");
    expect(board.highlights.best_persuasion.name).toBe("Solid");   // not the flagged 99
  });

  it("names most-improved from the previous snapshot", async () => {
    state.leads = [lead({ owner: "Ihsan" })];
    state.evals = [evaluation()];
    state.snapshot = [{ agent_name: "Ihsan", overall: 40, persuasion: 40, compliance: 90, conversion: 40 }];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.rows[0].prev_overall).toBe(40);
    expect(board.rows[0].delta_overall).toBeGreaterThan(0);
    expect(board.highlights.most_improved.name).toBe("Ihsan");
  });
});

describe("coverage", () => {
  it("reports how much of the window was actually evaluated", async () => {
    state.coverage = { total: 200, evaluated: 50 };
    state.leads = [lead()];
    state.evals = [evaluation()];
    const board = await gatherQualityBoard({ days: 7 });
    expect(board.coverage.pct).toBe(25);
    // thin coverage must keep confidence low however many conversations one
    // employee happens to have
    expect(board.rows[0].confidence).toBe("low");
  });
});

describe("public feed", () => {
  it("carries scores and severity counts but no evidence, type or conversation id", async () => {
    state.leads = [lead()];
    state.evals = [evaluation()];
    state.issues = [{ owner: "Ihsan", wa_id: "secret-wa-id", type: "guaranteed_profit", severity: "critical", confidence: 1, review_status: "pending" }];
    const pub = publicView(await gatherQualityBoard({ days: 7 }));
    const json = JSON.stringify(pub);

    expect(pub.rows[0].name).toBe("Ihsan");
    expect(pub.rows[0].overall).toBeDefined();
    expect(pub.rows[0].risk.critical).toBe(1);
    expect(json).not.toContain("secret-wa-id");
    expect(json).not.toContain("guaranteed_profit");
    expect(json).not.toContain("confirmedCritical");
    expect(pub.rows[0].overall_raw).toBeUndefined();   // the uncapped score is management-only
  });
});

describe("snapshot", () => {
  it("writes one row per employee for the window", async () => {
    state.leads = [lead({ owner: "A" }), lead({ owner: "B" })];
    const board = await gatherQualityBoard({ days: 7 });
    const r = await saveSnapshot(board);
    expect(r).toMatchObject({ snapshot_date: "2026-07-28", window_days: 7, saved: 2 });
  });
});

// The owner asked to be able to point the evaluator at ONE period rather than
// only the trailing N days, so what wins over what is pinned here.
describe("scanWindow", () => {
  // dubaiYmd is stubbed to 2026-07-28 at the top of this file, so that is "today".
  const now = new Date("2026-07-28T08:00:00Z");

  it("uses the trailing window when no dates are given", () => {
    expect(scanWindow({ days: 7, now })).toEqual({ since: "2026-07-22", until: "2026-07-28" });
  });

  it("lets an explicit range override days entirely", () => {
    expect(scanWindow({ since: "2026-03-01", until: "2026-03-31", days: 7, now }))
      .toEqual({ since: "2026-03-01", until: "2026-03-31" });
  });

  it("runs an open-ended range up to today", () => {
    expect(scanWindow({ since: "2026-07-01", now })).toEqual({ since: "2026-07-01", until: "2026-07-28" });
  });

  it("swaps a backwards range instead of matching nothing", () => {
    expect(scanWindow({ since: "2026-03-31", until: "2026-03-01", now }))
      .toEqual({ since: "2026-03-01", until: "2026-03-31" });
  });

  it("ignores an unparseable date and falls back to days", () => {
    expect(scanWindow({ since: "last march", days: 7, now }))
      .toEqual({ since: "2026-07-22", until: "2026-07-28" });
  });

  it("caps the trailing window at two years", () => {
    const w = scanWindow({ days: 5000, now });
    expect(w.since).toBe("2024-07-29"); // 730 days inclusive, not 5000
    expect(w.until).toBe("2026-07-28");
  });

  it("treats a single day as a one-day window, not an empty one", () => {
    expect(scanWindow({ days: 1, now })).toEqual({ since: "2026-07-28", until: "2026-07-28" });
  });
});
