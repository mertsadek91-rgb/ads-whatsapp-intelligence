// Sales-floor kiosk code management: /token returns a short stable /tv/<code>
// link (auto-created), /code sets a custom easy code (validated), rotate makes
// a random one.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const state = { code: null };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    if (sql.includes("select v from ads_settings")) return state.code ? [{ v: state.code }] : [];
    if (sql.startsWith("insert into ads_settings")) { state.code = params[0]; return {}; }
    return {};
  }),
}));
vi.mock("../src/lib/salesboard.js", () => ({ gatherSalesboard: vi.fn(async () => ({ rows: [], totals: {} })) }));

const router = (await import("../src/routes/salesboard.js")).default;
const app = express(); app.use(express.json()); app.use("/salesboard", router);

beforeEach(() => { state.code = null; });

describe("GET /salesboard/token", () => {
  it("auto-creates a short code and returns a /tv/<code> path", async () => {
    const r = await request(app).get("/salesboard/token");
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^[a-f0-9]{8}$/);       // short, not a 48-char token
    expect(r.body.path).toBe(`/tv/${r.body.code}`);
    expect(state.code).toBe(r.body.code);               // persisted
  });
  it("returns the existing code on subsequent reads (stable)", async () => {
    state.code = "sales";
    const r = await request(app).get("/salesboard/token");
    expect(r.body.code).toBe("sales");
    expect(r.body.path).toBe("/tv/sales");
  });
});

describe("POST /salesboard/code", () => {
  it("sets a custom easy code", async () => {
    const r = await request(app).post("/salesboard/code").send({ code: "sales2026" });
    expect(r.status).toBe(200);
    expect(r.body.path).toBe("/tv/sales2026");
    expect(state.code).toBe("sales2026");
  });
  it("rejects codes with spaces or invalid chars", async () => {
    expect((await request(app).post("/salesboard/code").send({ code: "my board" })).status).toBe(400);
    expect((await request(app).post("/salesboard/code").send({ code: "ab" })).status).toBe(400); // too short
    expect((await request(app).post("/salesboard/code").send({ code: "" })).status).toBe(400);
  });
});

describe("POST /salesboard/token/rotate", () => {
  it("generates a new short random code", async () => {
    state.code = "sales";
    const r = await request(app).post("/salesboard/token/rotate");
    expect(r.body.code).toMatch(/^[a-f0-9]{8}$/);
    expect(r.body.code).not.toBe("sales");
  });
});
