// Batch E: Knowledge Base route — list (items+stats+categories+aiAvailable),
// generation gate on AI availability, manual create, patch, delete.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const state = { hasKey: true };
const calls = [];
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("count(*) total")) return [{ total: 2, approved: 1, draft: 1, ai: 1, manual: 1 }];
    if (sql.startsWith("select id, question")) return [{ id: 7, question: "q", answer: "a", category: "deposit", lang: "ar", source: "ai", status: "draft", times_seen: 3 }];
    if (sql.includes("from ads_conversation_analysis")) return [];
    return {};
  }),
}));
vi.mock("../src/lib/deepseek.js", () => ({ hasKey: () => state.hasKey, chatJSON: vi.fn() }));

const router = (await import("../src/routes/knowledge.js")).default;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/knowledge", router);
  return app;
}

beforeEach(() => { calls.length = 0; state.hasKey = true; });

describe("GET /knowledge", () => {
  it("returns items, stats, categories and aiAvailable", async () => {
    const r = await request(buildApp()).get("/knowledge");
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.stats.total).toBe(2);
    expect(r.body.categories).toContain("deposit");
    expect(r.body.aiAvailable).toBe(true);
  });
});

describe("POST /knowledge/generate", () => {
  it("400s when AI is unavailable", async () => {
    state.hasKey = false;
    const r = await request(buildApp()).post("/knowledge/generate").send({});
    expect(r.status).toBe(400);
  });
  it("runs generation when AI is available (no conversations -> zero)", async () => {
    const r = await request(buildApp()).post("/knowledge/generate").send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, sampled: 0, upserted: 0 });
  });
});

describe("POST/PATCH/DELETE /knowledge", () => {
  it("creates a manual pair", async () => {
    const r = await request(buildApp()).post("/knowledge").send({ question: "q", answer: "a", category: "risk", lang: "en" });
    expect(r.status).toBe(200);
    expect(calls.some((c) => c.sql.startsWith("insert into ads_kb_qa"))).toBe(true);
  });
  it("rejects a manual pair with an empty answer", async () => {
    const r = await request(buildApp()).post("/knowledge").send({ question: "q", answer: "" });
    expect(r.status).toBe(400);
  });
  it("patches status", async () => {
    const r = await request(buildApp()).patch("/knowledge/7").send({ status: "approved" });
    expect(r.status).toBe(200);
    expect(calls.some((c) => c.sql.startsWith("update ads_kb_qa"))).toBe(true);
  });
  it("deletes a pair", async () => {
    const r = await request(buildApp()).delete("/knowledge/7");
    expect(r.status).toBe(200);
    expect(calls.some((c) => c.sql.startsWith("delete from ads_kb_qa"))).toBe(true);
  });
});
