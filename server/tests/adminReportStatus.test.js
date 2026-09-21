// GET /admin/report-status feeds the in-app status panel: the running flag,
// the last nightly run summary, and the latest outbound report emails.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const state = { runs: [], emails: [] };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql) => {
    if (sql.includes("from ads_report_runs")) return state.runs;
    if (sql.includes("from ads_email_log")) return state.emails;
    return {};
  }),
}));
// Heavy job/mailer deps the admin router imports — stub so import is cheap.
vi.mock("../src/jobs/runDaily.js", () => ({ runDaily: vi.fn() }));
const runNightly = vi.fn(async () => ({}));
vi.mock("../src/jobs/nightlyReports.js", () => ({ runNightly: (...a) => runNightly(...a), isNightlyRunning: () => state.running }));
vi.mock("../src/jobs/backfill.js", () => ({ backfill: vi.fn() }));
vi.mock("../src/ingest/ingestWati.js", () => ({ ingestWati: vi.fn() }));
vi.mock("../src/ingest/ingestMeta.js", () => ({ ingestMeta: vi.fn() }));
vi.mock("../src/lib/mailer.js", () => ({ sendMail: vi.fn(), isConfigured: () => state.smtp }));
vi.mock("../src/lib/jobState.js", () => ({ loadJobState: vi.fn(async () => null), saveJobState: vi.fn(), correctInterrupted: (x) => x }));
// Stub the report libs so the preview routes don't launch a real browser.
const gatherCampaignReport = vi.fn(async ({ cadence }) => ({ cadence, key: "k" }));
const gatherEmployeeMonthly = vi.fn(async () => ({ monthKey: "2026-07" }));
vi.mock("../src/lib/weeklyReports.js", () => ({
  gatherCampaignReport: (...a) => gatherCampaignReport(...a),
  campaignReportData: vi.fn((g) => g),
  gatherEmployeeWeekly: vi.fn(async () => ({ isoWeek: "2026-W29" })),
  employeeReportData: vi.fn((g) => g),
  gatherEmployeeMonthly: (...a) => gatherEmployeeMonthly(...a),
  employeeMonthlyData: vi.fn((g) => g),
  availablePeriods: vi.fn(async () => ({ weeks: [{ key: "2026-W29", monday: "2026-07-13", since: "2026-07-13", until: "2026-07-19" }], months: [{ key: "2026-07", since: "2026-07-01", until: "2026-07-31" }] })),
  weekWindowFrom: vi.fn((mon) => ({ cur: { since: mon, until: mon }, prev: { since: mon, until: mon }, key: "wk", isoWeek: "wk" })),
  monthWindowFrom: vi.fn((mk) => ({ cur: { since: mk + "-01", until: mk + "-28" }, prev: {}, key: mk })),
}));
vi.mock("../src/lib/campaignReport.js", () => ({ buildCampaignReportHtml: vi.fn(() => "<html></html>") }));
vi.mock("../src/lib/pdfReport.js", () => ({
  buildEmployeeWeeklyHtml: vi.fn(() => "<html></html>"),
  buildEmployeeMonthlyHtml: vi.fn(() => "<html></html>"),
  htmlToPdf: vi.fn(async () => Buffer.from("%PDF-1.4 fake")),
}));

const adminRouter = (await import("../src/routes/admin.js")).default;
function buildApp() { const app = express(); app.use(express.json()); app.use("/admin", adminRouter); return app; }

beforeEach(() => { state.runs = []; state.emails = []; state.running = false; state.smtp = true; runNightly.mockClear(); gatherCampaignReport.mockClear(); gatherEmployeeMonthly.mockClear(); });

describe("GET /admin/report-status", () => {
  it("returns running=false, null last_run and empty emails on a fresh system", async () => {
    const res = await request(buildApp()).get("/admin/report-status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ running: false, last_run: null, emails: [] });
  });

  it("surfaces the latest run summary, the email log, and the running flag", async () => {
    state.running = true;
    state.runs = [{ run_date: "2026-07-21", built_at: "2026-07-21T03:00:00Z", summary: "nightly: {...}" }];
    state.emails = [
      { kind: "campaign_daily", recipient: "cm@co", period_key: "2026-07-20", status: "sent", error: null, sent_at: "2026-07-21T03:01:00Z" },
      { kind: "employee_weekly", recipient: "omar@co", period_key: "2026-W29", status: "skipped", error: null, sent_at: "2026-07-21T03:02:00Z" },
    ];
    const res = await request(buildApp()).get("/admin/report-status");
    expect(res.body.running).toBe(true);
    expect(res.body.last_run.summary).toContain("nightly");
    expect(res.body.emails).toHaveLength(2);
    expect(res.body.emails[0].kind).toBe("campaign_daily");
  });

  it("run-nightly returns 409 while a run is already in progress", async () => {
    state.running = true;
    const res = await request(buildApp()).post("/admin/run-nightly").send({});
    expect(res.status).toBe(409);
  });
});

describe("POST /admin/send-reports-now", () => {
  it("400s when SMTP is not configured", async () => {
    state.smtp = false;
    const res = await request(buildApp()).post("/admin/send-reports-now").send({});
    expect(res.status).toBe(400);
    expect(runNightly).not.toHaveBeenCalled();
  });

  it("409s while a run is already in progress", async () => {
    state.running = true;
    const res = await request(buildApp()).post("/admin/send-reports-now").send({});
    expect(res.status).toBe(409);
  });

  it("starts a reports-only, force, send-override run (bypassing switch + weekday gate)", async () => {
    const res = await request(buildApp()).post("/admin/send-reports-now").send({});
    expect(res.status).toBe(200);
    expect(res.body.started).toBe(true);
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget call dispatch
    expect(runNightly).toHaveBeenCalledWith({ force: true, reportsOnly: true, sendOverride: true, includeEmployees: true });
  });
});

describe("report preview routes", () => {
  it("streams a campaign report PDF inline for a cadence", async () => {
    const res = await request(buildApp()).get("/admin/report/campaign.pdf?cadence=monthly&lang=en");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("inline");
    expect(res.body.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("400s the employee preview when no agent is given", async () => {
    const res = await request(buildApp()).get("/admin/report/employee-monthly.pdf");
    expect(res.status).toBe(400);
  });

  it("streams the monthly employee PDF for an agent", async () => {
    const res = await request(buildApp()).get("/admin/report/employee-monthly.pdf?agent=Omar&lang=ar");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  it("lists selectable weeks and months", async () => {
    const res = await request(buildApp()).get("/admin/report/periods");
    expect(res.status).toBe(200);
    expect(res.body.weeks[0].monday).toBe("2026-07-13");
    expect(res.body.months[0].key).toBe("2026-07");
  });

  it("passes a picked month window through to the monthly gather", async () => {
    await request(buildApp()).get("/admin/report/employee-monthly.pdf?agent=Omar&month=2026-06&lang=ar");
    const opts = gatherEmployeeMonthly.mock.calls.at(-1)[1];
    expect(opts.window).toBeTruthy();
    expect(opts.window.key).toBe("2026-06");
  });

  it("ignores a malformed month and falls back to the default (no window)", async () => {
    await request(buildApp()).get("/admin/report/campaign.pdf?cadence=monthly&month=BAD");
    const opts = gatherCampaignReport.mock.calls.at(-1)[0];
    expect(opts.window).toBeNull();
  });
});
