// Public kiosk board route — token gate. Must reject missing/wrong tokens and
// only serve the board when the token matches the stored one.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const state = { token: "secret-token-123" };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql) => (sql.includes("salesboard_token") && state.token ? [{ v: state.token }] : [])),
}));
vi.mock("../src/lib/salesboard.js", () => ({ gatherSalesboard: vi.fn(async () => ({ rows: [], totals: {}, target: 90 })) }));

const router = (await import("../src/routes/publicBoard.js")).default;
const app = express();
app.use(express.json());
app.use("/api/public", router);

beforeEach(() => { state.token = "secret-token-123"; });

describe("GET /api/public/salesboard", () => {
  it("401s with no token", async () => {
    expect((await request(app).get("/api/public/salesboard")).status).toBe(401);
  });
  it("401s with a wrong token", async () => {
    expect((await request(app).get("/api/public/salesboard?token=nope")).status).toBe(401);
  });
  it("401s when no token is configured server-side", async () => {
    state.token = null;
    expect((await request(app).get("/api/public/salesboard?token=anything")).status).toBe(401);
  });
  it("serves the board with the correct token", async () => {
    const r = await request(app).get("/api/public/salesboard?token=secret-token-123");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("target", 90);
  });
});
