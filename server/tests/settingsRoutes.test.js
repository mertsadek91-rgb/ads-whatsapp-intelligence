import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const state = { stored: null, settings: {}, employees: [], owners: [], existingOwners: [] };
const calls = [];
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith("select v from ads_settings")) {
      if (params[0] === "currency_rates") return state.stored ? [{ v: state.stored }] : [];
      return state.settings[params[0]] != null ? [{ v: state.settings[params[0]] }] : [];
    }
    if (sql.startsWith("insert into ads_settings")) {
      if (params[0] === "currency_rates") state.stored = params[1]; else state.settings[params[0]] = params[1];
      return {};
    }
    if (sql.includes("from ads_employees order by")) return state.employees;
    if (sql.includes("distinct contact_owner")) return state.owners.map((o) => ({ o }));
    if (sql.includes("select owner_name from ads_employees")) return state.existingOwners.map((owner_name) => ({ owner_name }));
    if (sql.startsWith("insert into ads_employees")) return {};
    if (sql.startsWith("update ads_employees")) return {};
    if (sql.startsWith("delete from ads_employees")) return {};
    return {};
  }),
}));

const settingsRouter = (await import("../src/routes/settings.js")).default;

// Configuration writes and the staff directory are admin-only now, so the
// harness carries a session the way the real app does. Pass a role to check
// what a lesser account can reach.
function buildApp(role = "admin") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = role ? { userId: 1, email: "admin@example.com", role } : {};
    next();
  });
  app.use("/settings", settingsRouter);
  return app;
}

beforeEach(() => { state.stored = null; state.settings = {}; state.employees = []; state.owners = []; state.existingOwners = []; calls.length = 0; });

describe("GET /settings/currency", () => {
  it("returns the currency metadata list and the default rates when nothing is saved yet", async () => {
    const res = await request(buildApp()).get("/settings/currency");
    expect(res.status).toBe(200);
    expect(res.body.currencies.length).toBeGreaterThan(5);
    expect(res.body.rates.AED).toBe(1);
    expect(res.body.rates.USD).toBeGreaterThan(0);
  });

  it("returns the saved rates once an admin has set them", async () => {
    state.stored = JSON.stringify({ AED: 1, USD: 0.3 });
    const res = await request(buildApp()).get("/settings/currency");
    expect(res.body.rates).toEqual({ AED: 1, USD: 0.3 });
  });
});

describe("POST /settings/currency", () => {
  it("saves sanitized rates and echoes them back", async () => {
    const res = await request(buildApp()).post("/settings/currency").send({ rates: { USD: 0.28, EUR: 0.26 } });
    expect(res.status).toBe(200);
    expect(res.body.rates).toEqual({ AED: 1, USD: 0.28, EUR: 0.26 });
    expect(JSON.parse(state.stored)).toEqual({ AED: 1, USD: 0.28, EUR: 0.26 });
  });

  it("strips an unknown currency / bad rate before persisting (never trusts client input verbatim)", async () => {
    await request(buildApp()).post("/settings/currency").send({ rates: { USD: 0.28, FAKE: 99, GBP: -5 } });
    expect(JSON.parse(state.stored)).toEqual({ AED: 1, USD: 0.28 });
  });
});

describe("employee directory", () => {
  it("rejects an employee row with no email", async () => {
    const res = await request(buildApp()).post("/settings/employees").send({ owner_name: "Omar", role: "agent" });
    expect(res.status).toBe(400);
  });

  it("inserts a new agent (owner_name kept) and normalizes the role/lang", async () => {
    const res = await request(buildApp()).post("/settings/employees")
      .send({ owner_name: "Omar Sadka", email: "omar@co", role: "bogus", lang: "fr", active: true });
    expect(res.status).toBe(200);
    const ins = calls.find((c) => c.sql.startsWith("insert into ads_employees"));
    expect(ins.params).toEqual(["Omar Sadka", "omar@co", null, "agent", "ar", 1, "[]", null]);
  });

  it("whitelists submitted country codes against the known ISO-2 vocabulary", async () => {
    await request(buildApp()).post("/settings/employees")
      .send({ email: "x@co", role: "agent", owner_name: "A", countries: ["SA", "EG", "ZZ", "bogus"] });
    const ins = calls.find((c) => c.sql.startsWith("insert into ads_employees"));
    expect(JSON.parse(ins.params[6])).toEqual(["SA", "EG"]); // ZZ/bogus dropped
  });

  it("country-options returns the ISO-2 vocabulary", async () => {
    const res = await request(buildApp()).get("/settings/country-options");
    expect(res.status).toBe(200);
    expect(res.body.some((c) => c.iso2 === "SA")).toBe(true);
    expect(res.body[0]).toHaveProperty("flag");
  });

  it("nulls owner_name for a manager/GM role (they aren't sales agents)", async () => {
    await request(buildApp()).post("/settings/employees")
      .send({ owner_name: "ignored", email: "gm@co", role: "general_manager" });
    const ins = calls.find((c) => c.sql.startsWith("insert into ads_employees"));
    expect(ins.params[0]).toBeNull();
    expect(ins.params[3]).toBe("general_manager");
  });

  it("updates in place when an id is supplied", async () => {
    await request(buildApp()).post("/settings/employees").send({ id: 7, email: "x@co", role: "agent", owner_name: "A" });
    expect(calls.some((c) => c.sql.startsWith("update ads_employees") && c.params.includes(7))).toBe(true);
  });

  it("seed adds only owners without a row, skipping bots and blanks", async () => {
    state.owners = ["Omar Sadka", "  ", "SupportBot", "Amira Farouk"];
    state.existingOwners = ["Omar Sadka"];
    const res = await request(buildApp()).post("/settings/employees/seed");
    expect(res.body.added).toBe(1); // only Amira (Omar exists, blank+bot skipped)
  });
});

describe("report send switch", () => {
  it("defaults to disabled and reports SMTP status", async () => {
    const res = await request(buildApp()).get("/settings/reports");
    expect(res.body.email_enabled).toBe(false);
    expect(typeof res.body.smtp_configured).toBe("boolean");
  });

  it("persists the enabled flag as '1'/'0'", async () => {
    await request(buildApp()).post("/settings/reports").send({ email_enabled: true });
    expect(state.settings.reports_email_enabled).toBe("1");
    const res = await request(buildApp()).get("/settings/reports");
    expect(res.body.email_enabled).toBe(true);
  });
});
