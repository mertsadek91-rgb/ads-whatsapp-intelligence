// BUG-017 — no API/audit trail existed; every request only ever reached
// console.log. Covers: a normal request is logged with method/path/status/
// user/duration, and the two known high-frequency polling routes are
// excluded so they don't drown the table.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const inserts = [];
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    inserts.push({ sql, params });
    return {};
  }),
}));

const { apiLog } = await import("../src/middleware/apiLog.js");

function buildApp(sessionEmail) {
  const app = express();
  app.use((req, res, next) => { req.session = sessionEmail ? { email: sessionEmail } : {}; next(); });
  app.use("/api", apiLog);
  app.get("/api/leads", (req, res) => res.json([]));
  app.get("/api/admin/status", (req, res) => res.json({}));
  app.get("/api/conversations/jobs-status", (req, res) => res.json({}));
  return app;
}

// apiLog logs on res.on("finish"), which fires asynchronously after the
// response is sent — give it a tick before asserting.
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => { inserts.length = 0; });

describe("BUG-017: apiLog records method/path/status/user/duration for real requests", () => {
  it("logs a normal request with the session's email attributed", async () => {
    const app = buildApp("agent@example.com");
    await request(app).get("/api/leads");
    await flush();

    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toMatch(/insert into ads_api_logs/);
    const [method, path, status, userEmail] = inserts[0].params;
    expect(method).toBe("GET");
    expect(path).toBe("/api/leads");
    expect(status).toBe(200);
    expect(userEmail).toBe("agent@example.com");
  });

  it("does not log the high-frequency polling routes", async () => {
    const app = buildApp("agent@example.com");
    await request(app).get("/api/admin/status");
    await request(app).get("/api/conversations/jobs-status");
    await flush();

    expect(inserts).toHaveLength(0);
  });

  it("logs null for user_email when there is no session (never crashes)", async () => {
    const app = buildApp(null);
    await request(app).get("/api/leads");
    await flush();

    expect(inserts[0].params[3]).toBeNull();
  });

  it("records the full path even under a nested router mount (matches real server.js layout)", async () => {
    // Regression for a real bug caught during live verification: reading
    // req.path lazily inside the finish handler captured whatever the
    // innermost nested app.use(prefix, router) had already stripped it down
    // to (e.g. "/summary" instead of "/api/analytics/summary"), because
    // Express mutates req.path/req.url per mount point.
    const app = express();
    app.use((req, res, next) => { req.session = { email: "a@b.com" }; next(); });
    app.use("/api", apiLog);
    const analytics = express.Router();
    analytics.get("/summary", (req, res) => res.json({}));
    app.use("/api/analytics", analytics);

    await request(app).get("/api/analytics/summary");
    await flush();

    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[1]).toBe("/api/analytics/summary");
  });
});
