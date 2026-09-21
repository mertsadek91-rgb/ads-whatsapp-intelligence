// Three deployment defects that are invisible in development and only bite in
// production behind a reverse proxy or on a shared MySQL host.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";

describe("D-4: req.ip must be the real client behind a reverse proxy", () => {
  // The rate limiter in routes/auth.js and both audit logs key on req.ip.
  // These two cases pin WHY the setting matters, and that the value we chose
  // (hops from TRUST_PROXY_HOPS, default 0) is the one that produces it.
  const probe = (hops) => {
    const app = express();
    app.set("trust proxy", hops);
    app.get("/ip", (req, res) => res.json({ ip: req.ip, secure: req.secure }));
    return app;
  };

  it("reports the proxy, not the client, when nothing is trusted", async () => {
    const r = await request(probe(0)).get("/ip").set("X-Forwarded-For", "203.0.113.9");
    expect(r.body.ip).not.toBe("203.0.113.9");
  });

  it("reports the client, and sees the request as HTTPS, at one hop", async () => {
    const r = await request(probe(1)).get("/ip")
      .set("X-Forwarded-For", "203.0.113.9")
      .set("X-Forwarded-Proto", "https");
    expect(r.body.ip).toBe("203.0.113.9");
    // This is the half that makes the secure cookie work: without trust proxy
    // Express sees plain http here and silently refuses to set the cookie.
    expect(r.body.secure).toBe(true);
  });
});

describe("D-5: the session cookie must be Secure in production, and only with trust proxy", () => {
  const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  it("marks the cookie Secure in production", () => {
    expect(src).toMatch(/secure:\s*process\.env\.NODE_ENV === "production"/);
  });

  it("sets trust proxy BEFORE the session middleware", () => {
    // Order is load-bearing, not cosmetic: a secure cookie configured before
    // Express knows it is behind TLS termination breaks login outright.
    const trust = src.indexOf('app.set("trust proxy"');
    const sess = src.indexOf("app.use(session(");
    expect(trust).toBeGreaterThan(-1);
    expect(sess).toBeGreaterThan(-1);
    expect(trust).toBeLessThan(sess);
  });
});

describe("D-7: the cron leader lock must be scoped to this install", () => {
  // MySQL GET_LOCK names are global to the server. A fixed string meant two
  // installs on one MySQL host starved each other's nightly run silently.
  beforeEach(() => vi.resetModules());

  it("keys the lock on the database name, not a hardcoded product name", async () => {
    const taken = [];
    vi.doMock("../src/db.js", () => ({
      pool: () => ({ getConnection: async () => ({
        query: vi.fn(async (sql, params) => {
          if (/get_lock/.test(sql)) { taken.push(params[0]); return [[{ got: 0 }]]; }
          return [[]];
        }),
        release: vi.fn(),
      }) }),
    }));
    vi.doMock("../src/config.js", () => ({
      default: {
        mysql: { database: "tenant_one" },
        cronTime: "* * * * *", cronTimezone: "UTC", quickSyncCron: "* * * * *",
      },
    }));
    vi.doMock("node-cron", () => ({
      default: { validate: () => true, schedule: (_e, fn) => { fn(); return { stop() {} }; } },
    }));
    vi.doMock("../src/jobs/runDaily.js", () => ({ runDaily: vi.fn() }));
    vi.doMock("../src/jobs/nightlyReports.js", () => ({ runNightly: vi.fn() }));
    vi.doMock("../src/jobs/quickSync.js", () => ({ runQuickSync: vi.fn() }));

    const { startScheduler } = await import("../src/jobs/scheduler.js");
    startScheduler();
    await new Promise((r) => setImmediate(r));

    expect(taken.length).toBeGreaterThan(0);
    for (const name of taken) {
      expect(name).toMatch(/^tenant_one:/);
      expect(name).not.toMatch(/ist-markets/);
    }
  });
});
