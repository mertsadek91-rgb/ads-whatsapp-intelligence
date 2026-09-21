// The Settings page renders nothing when this route is missing, so "I don't see
// the setting" and "the route was never mounted" look identical from a browser.
// These pin the route itself.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const saved = [];
vi.mock("../src/lib/appConfig.js", () => ({
  saveConfig: vi.fn(async (patch) => {
    saved.push(patch);
    // Stand in for hydrate(): the real one writes the value into `config`.
    if (patch["data.since"] !== undefined) config.data.since = patch["data.since"];
    if (patch["data.watiMessages"] !== undefined) config.data.watiMessages = patch["data.watiMessages"];
    return { saved: Object.keys(patch).length };
  }),
}));

const config = { meta: { lookbackDays: 120 }, data: { since: "", watiMessages: false } };
vi.mock("../src/config.js", () => ({ default: config }));
vi.mock("../src/db.js", () => ({ query: vi.fn(async () => []) }));
vi.mock("../src/middleware/auth.js", () => ({ requireRole: () => (req, _res, next) => next() }));
vi.mock("../src/lib/appIdentity.js", () => ({ getIdentity: async () => ({}), saveIdentity: async () => ({}) }));
vi.mock("../src/lib/mailer.js", () => ({ isConfigured: () => false }));

const backfills = [];
vi.mock("../src/jobs/backfill.js", () => ({ backfill: vi.fn(async () => { backfills.push(1); }) }));
let jobFree = true;
vi.mock("../src/routes/admin.js", () => ({ runJob: vi.fn(async (_n, fn) => (jobFree ? (fn(), true) : false)) }));

const { default: settings } = await import("../src/routes/settings.js");

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.session = { email: "admin@example.com" }; next(); });
app.use("/settings", settings);

beforeEach(() => {
  saved.length = 0; backfills.length = 0; jobFree = true;
  config.data = { since: "", watiMessages: false };
});

describe("GET /settings/data-range", () => {
  it("reports the current range in both languages", async () => {
    const r = await request(app).get("/settings/data-range");
    expect(r.status).toBe(200);
    expect(r.body.since).toBe("");
    expect(r.body.lookbackDays).toBe(120);
    expect(r.body.en).toMatch(/the last 120 days/);
    expect(r.body.ar).toBeTruthy();
  });
});

describe("POST /settings/data-range", () => {
  it("stores a date and reports it back", async () => {
    const r = await request(app).post("/settings/data-range")
      .send({ since: "2026-03-01", watiMessages: true });
    expect(saved[0]).toEqual({ "data.since": "2026-03-01", "data.watiMessages": true });
    expect(r.body.since).toBe("2026-03-01");
    expect(r.body.en).toMatch(/since 2026-03-01, including WhatsApp message history/);
  });

  it("stores 'all' as a range rather than as a date", async () => {
    await request(app).post("/settings/data-range").send({ since: "all" });
    expect(saved[0]["data.since"]).toBe("all");
  });

  it("does not let a malformed value through to the importer", async () => {
    // It would otherwise be asked of Meta verbatim on the next nightly run.
    await request(app).post("/settings/data-range").send({ since: "whenever" });
    expect(saved[0]["data.since"]).toBe("");
  });
});

describe("POST /settings/data-range/import", () => {
  it("starts the import and says what range it will cover", async () => {
    config.data.since = "all";
    const r = await request(app).post("/settings/data-range/import");
    expect(r.status).toBe(200);
    expect(r.body.started).toBe(true);
    expect(r.body.en).toMatch(/all available data/);
    expect(backfills).toHaveLength(1);
  });

  it("refuses to start a second one on top of a running import", async () => {
    jobFree = false;
    const r = await request(app).post("/settings/data-range/import");
    expect(r.status).toBe(409);
    expect(backfills).toHaveLength(0);
  });
});
