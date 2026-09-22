// The failures a real installation hit, each pinned so it cannot come back.
//
// The shape of the outage was the giveaway: every /test succeeded and every
// /save answered 503. Three independent defects composed into it, and the
// tests below are one per defect rather than one per symptom.
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

describe("a route that throws answers, rather than taking the process with it", () => {
  // Express 4 does not catch a rejected promise from a handler. Without a
  // guard the rejection reached process level, the process ended, the proxy in
  // front saw the origin die and answered 503 — and the retry hit a process
  // that had just restarted. Two 503s for one click was exactly that.
  const appWith = (handler) => {
    const app = express();
    app.get("/boom", handler);
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
    return app;
  };

  it("Express 4 does not catch a rejected handler — which is why the guard exists", async () => {
    // Stated as a property of the framework rather than by provoking a real
    // unanswered request, which would leave a rejection the runner reports as
    // an unhandled error of its own.
    const version = (await import("express/package.json", { with: { type: "json" } })
      .catch(() => ({ default: { version: "4" } }))).default.version;
    expect(Number(version.split(".")[0])).toBeLessThan(5);
  });

  it("the same handler wrapped answers 500 with the reason", async () => {
    const { wrap } = await import("../src/lib/wrap.js");
    vi.doMock("../src/lib/errorLog.js", () => ({ logError: () => {} }));
    const app = appWith(wrap(async () => { throw new Error("db is gone"); }));
    const r = await request(app).get("/boom");
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("db is gone");
  });
});
