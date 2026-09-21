// REG-107 — batch-analyze used to freeze at "0 rows selected" whenever a
// scoreMin/scoreMax filter was active, because that filter operates on
// ads_conversation_analysis.conv_score (the AI's own output) and every
// candidate for analysis is, by definition, not analyzed yet — conv_score is
// still NULL for all of them, so the filter always excluded everything. Fixed
// by stripping scoreMin/scoreMax out of the selection query in
// routes/conversations.js's /analyze-batch handler.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const calls = [];

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("from ads_wati_contacts c")) return []; // 0 candidates -> job completes instantly
    return [];
  }),
}));

const conversationsRouter = (await import("../src/routes/conversations.js")).default;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/conversations", conversationsRouter);
  return app;
}

beforeEach(() => { calls.length = 0; });

// The SELECT list always carries a.conv_score / a.wa_id (for the "stale" column),
// so assertions must look only at the WHERE clause, not the whole statement.
const whereClause = (sql) => sql.slice(sql.indexOf(" where "));

describe("REG-107: /analyze-batch excludes conv_score filters from the selection query", () => {
  it("drops scoreMin/scoreMax from the WHERE clause even when sent in the request", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/conversations/analyze-batch")
      .send({ scoreMin: 50, scoreMax: 90, stage: "qualified" });

    expect(res.status).toBe(200);
    const selectCall = calls.find((c) => c.sql.includes("from ads_wati_contacts c"));
    expect(selectCall).toBeTruthy();
    expect(whereClause(selectCall.sql)).not.toMatch(/conv_score/);
    expect(selectCall.params).not.toContain(50);
    expect(selectCall.params).not.toContain(90);
  });

  it("still applies non-score filters (stage) to the selection", async () => {
    const app = buildApp();
    await request(app).post("/conversations/analyze-batch").send({ scoreMin: 50, stage: "qualified" });
    const selectCall = calls.find((c) => c.sql.includes("from ads_wati_contacts c"));
    expect(selectCall.sql).toMatch(/c\.stage = \?/);
    expect(selectCall.params).toContain("qualified");
  });

  it("restricts to unanalyzed contacts by default (onlyUnanalyzed defaults true)", async () => {
    const app = buildApp();
    await request(app).post("/conversations/analyze-batch").send({});
    const selectCall = calls.find((c) => c.sql.includes("from ads_wati_contacts c"));
    expect(whereClause(selectCall.sql)).toMatch(/a\.wa_id is null/);
  });

  it("selects already-analyzed contacts too when onlyUnanalyzed is explicitly false", async () => {
    const app = buildApp();
    await request(app).post("/conversations/analyze-batch").send({ onlyUnanalyzed: false });
    const selectCall = calls.find((c) => c.sql.includes("from ads_wati_contacts c"));
    expect(whereClause(selectCall.sql)).not.toMatch(/a\.wa_id is null/);
    expect(whereClause(selectCall.sql)).not.toMatch(/a\.wa_id is not null/);
  });
});
