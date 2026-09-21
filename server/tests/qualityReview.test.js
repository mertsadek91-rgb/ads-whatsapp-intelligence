// Supervisor review. The AI proposes, a human decides — so what matters here is
// that a decision is attributable, that it changes what the score does, and that
// coaching is never built on a finding a supervisor threw out.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { issues: [], counts: [], updated: [], one: null, training: [] };

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params) => {
    if (sql.startsWith("update ads_conversation_issue")) { state.updated.push({ sql, params }); return {}; }
    if (sql.includes("select count(*) total from ads_conversation_issue")) return [{ total: state.issues.length }];
    if (sql.includes("i.review_status status, i.severity, count(*) n")) return state.counts;
    // matched on the alias, not the whole expression, so tightening the SQL
    // doesn't silently turn this mock into "returns nothing"
    if (sql.includes("recommended_alternative") && sql.includes(" example")) return state.training;
    if (sql.includes("select id, severity from ads_conversation_issue")) return state.one ? [state.one] : [];
    if (sql.startsWith("select * from ads_conversation_issue")) return state.one ? [state.one] : [];
    if (sql.includes("a.thread_snapshot")) return state.one ? [state.one] : [];
    if (sql.includes("from ads_conversation_issue i")) return state.issues;
    return [];
  }),
}));

const { listIssues, reviewIssue, reviewSummary, trainingInsights, issueContext } =
  await import("../src/lib/qualityReview.js");

const issue = (over = {}) => ({
  id: 1, wa_id: "w1", type: "guaranteed_profit", severity: "critical", confidence: 0.93,
  evidence: "الربح مضمون", context_explanation: "وعد صريح", recommended_alternative: "الأرباح غير مضمونة",
  review_status: "pending", reviewed_by: null, owner: "Ihsan  Ahmed", customer: "Sami", ...over,
});

beforeEach(() => { state.issues = []; state.counts = []; state.updated = []; state.one = null; state.training = []; });

describe("the queue", () => {
  it("labels the issue type and the employee in the requested language", async () => {
    state.issues = [issue()];
    const ar = await listIssues({ lang: "ar" });
    const en = await listIssues({ lang: "en" });
    expect(ar.rows[0].type_label).toBe("وعد بربح مضمون");
    expect(en.rows[0].type_label).toBe("Guaranteed-profit promise");
  });

  it("says plainly whether a finding is actually costing points", async () => {
    state.issues = [
      issue({ id: 1, confidence: 0.93, review_status: "pending" }),
      issue({ id: 2, confidence: 0.4, review_status: "pending" }),
      issue({ id: 3, confidence: 0.99, review_status: "rejected" }),
    ];
    const { rows } = await listIssues({ status: "all" });
    // a supervisor must not assume every row is a deduction
    expect(rows.find((r) => r.id === 1).scoring).toBe("scored");
    expect(rows.find((r) => r.id === 2).scoring).toBe("not_scored");
    expect(rows.find((r) => r.id === 3).scoring).toBe("dismissed");
  });

  it("triages by severity first, then confidence", async () => {
    state.issues = [issue()];
    const { query } = await import("../src/db.js");
    await listIssues({});
    const sql = query.mock.calls.map((c) => c[0]).find((s) => s.includes("order by field(i.severity"));
    expect(sql).toMatch(/field\(i\.severity,'critical','major','moderate','minor','informational'\)/);
    expect(sql).toMatch(/i\.confidence desc/);
  });

  it("rejects an unknown status instead of silently listing everything", async () => {
    await expect(listIssues({ status: "maybe" })).rejects.toThrow(/unknown review status/);
  });
});

describe("recording a decision", () => {
  it("stores confirm with the reviewer from the session", async () => {
    state.one = { id: 7, severity: "major", review_status: "pending" };
    await reviewIssue(7, { action: "confirm", reviewer: "boss@ist.com", note: "checked the thread" });
    const { params } = state.updated[0];
    expect(params[0]).toBe("confirmed");
    expect(params[2]).toBe("boss@ist.com");
    expect(params[3]).toBe("checked the thread");
  });

  it("refuses to record a decision with no reviewer", async () => {
    state.one = { id: 7, severity: "major" };
    await expect(reviewIssue(7, { action: "confirm" })).rejects.toThrow(/reviewer is required/);
    expect(state.updated).toHaveLength(0);
  });

  it("treats a severity change as confirming the finding exists", async () => {
    state.one = { id: 7, severity: "critical", review_status: "pending" };
    await reviewIssue(7, { action: "severity", severity: "moderate", reviewer: "boss@ist.com" });
    const { params } = state.updated[0];
    expect(params[0]).toBe("confirmed");
    expect(params[1]).toBe("moderate");
  });

  it("refuses an unknown action or severity", async () => {
    state.one = { id: 7, severity: "major" };
    await expect(reviewIssue(7, { action: "maybe", reviewer: "x" })).rejects.toThrow(/unknown review action/);
    await expect(reviewIssue(7, { action: "severity", severity: "apocalyptic", reviewer: "x" }))
      .rejects.toThrow(/unknown severity/);
  });

  it("returns null for an issue that does not exist", async () => {
    state.one = null;
    expect(await reviewIssue(999, { action: "reject", reviewer: "x" })).toBeNull();
  });
});

describe("queue summary", () => {
  it("counts by status and singles out pending criticals", async () => {
    state.counts = [
      { status: "pending", severity: "critical", n: 2 },
      { status: "pending", severity: "minor", n: 5 },
      { status: "confirmed", severity: "major", n: 1 },
      { status: "rejected", severity: "major", n: 3 },
    ];
    const s = await reviewSummary({});
    expect(s).toMatchObject({ pending: 7, confirmed: 1, rejected: 3, critical_pending: 2 });
    expect(s.by_severity).toMatchObject({ critical: 2, minor: 5, major: 4 });
  });
});

describe("training insights", () => {
  it("groups recurring patterns per employee with a teaching example", async () => {
    state.training = [
      { owner: "Ihsan Ahmed", type: "risk_disclosure_missing", worst: 2, n: 32, confirmed: 2, example: "اذكر المخاطر" },
      { owner: "Ihsan Ahmed", type: "premature_link", worst: 4, n: 7, confirmed: 0, example: null },
    ];
    const out = await trainingInsights({ lang: "en" });
    expect(out[0].owner).toBe("Ihsan Ahmed");
    expect(out[0].total).toBe(39);
    expect(out[0].patterns[0]).toMatchObject({
      type: "risk_disclosure_missing", count: 32, confirmed: 2, severity: "major",
    });
    expect(out[0].patterns[0].type_label).toBe("Risk not disclosed where required");
    expect(out[0].patterns[1].severity).toBe("minor");
  });

  it("counts one weakness once, however it was graded across conversations", async () => {
    // grouping by (type, severity) listed the same weakness twice and split the
    // count that should drive the coaching priority
    const { query } = await import("../src/db.js");
    query.mockClear();
    await trainingInsights({});
    const sql = query.mock.calls.map((c) => c[0]).find((s) => s.includes("recommended_alternative"));
    expect(sql).toMatch(/group by 1,2\b/);
    expect(sql).toMatch(/min\(field\(i\.severity/);
  });

  it("excludes rejected findings from the query — coaching on them would teach the wrong lesson", async () => {
    const { query } = await import("../src/db.js");
    query.mockClear();
    await trainingInsights({});
    const sql = query.mock.calls.map((c) => c[0]).find((s) => s.includes("recommended_alternative"));
    expect(sql).toMatch(/i\.review_status <> 'rejected'/);
  });
});

describe("conversation context", () => {
  it("finds the flagged message by its quote and returns a window around it", async () => {
    state.one = {
      ...issue(),
      thread_snapshot: JSON.stringify([
        { ts: "2026-07-01T10:00:00Z", dir: "in", sender: "cust", body: "مرحبا" },
        { ts: "2026-07-01T10:01:00Z", dir: "out", sender: "Ihsan", body: "أهلاً بك" },
        { ts: "2026-07-01T10:02:00Z", dir: "out", sender: "Ihsan", body: "الربح مضمون معنا" },
        { ts: "2026-07-01T10:03:00Z", dir: "in", sender: "cust", body: "حقاً؟" },
      ]),
    };
    const ctx = await issueContext(1, { window: 1 });
    expect(ctx.evidence_found).toBe(true);
    const flagged = ctx.messages.filter((m) => m.flagged);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].body).toContain("الربح مضمون");
    expect(ctx.messages).toHaveLength(3);   // one before, the message, one after
  });

  it("degrades to the tail of the thread when the quote cannot be located", async () => {
    state.one = { ...issue({ evidence: "شيء لم يُقَل أبداً" }), thread_snapshot: JSON.stringify([{ dir: "in", body: "مرحبا" }]) };
    const ctx = await issueContext(1, {});
    expect(ctx.evidence_found).toBe(false);
    expect(ctx.messages.length).toBeGreaterThan(0);
  });

  it("survives a missing or malformed thread snapshot", async () => {
    state.one = { ...issue(), thread_snapshot: "not json" };
    const ctx = await issueContext(1, {});
    expect(ctx.messages).toEqual([]);
    expect(ctx.evidence_found).toBe(false);
  });
});
