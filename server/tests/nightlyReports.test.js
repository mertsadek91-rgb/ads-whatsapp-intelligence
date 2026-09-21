// Phase C: the nightly orchestrator's control flow — preflight abort, the
// enabled/disabled send gate, per-period idempotency delegation, and the
// weekly-day gate for employee reports. Heavy deps (ingest, PDF, AI gather)
// are mocked; we assert WHO gets emailed WHAT and when.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { settings: {}, employees: [], hasKey: true, dow: 1 };

const ingestWati = vi.fn(async () => ({ kept: 3 }));
vi.mock("../src/ingest/ingestWati.js", () => ({ ingestWati: (...a) => ingestWati(...a) }));
vi.mock("../src/ingest/ingestMeta.js", () => ({ ingestMeta: vi.fn(async () => ({ skipped: false })) }));
vi.mock("../src/jobs/runDaily.js", () => ({ autoAnalyze: vi.fn(async () => ({ analyzed: 5 })) }));
vi.mock("../src/lib/errorLog.js", () => ({ cleanupLogs: vi.fn(async () => ({})) }));
vi.mock("../src/config.js", () => ({ default: { cronTimezone: "Asia/Dubai", weeklyReportDow: 1, nightlyAnalyzeCap: 500, deepseek: {} } }));
vi.mock("../src/lib/deepseek.js", () => ({ hasKey: () => state.hasKey }));

const sendOnce = vi.fn(async ({ enabled, kind }) => ({ sent: !!enabled, skipped: !enabled, kind }));
const isConfigured = vi.fn(() => true);
vi.mock("../src/lib/mailer.js", () => ({ isConfigured: () => isConfigured(), sendOnce: (...a) => sendOnce(...a) }));

vi.mock("../src/lib/pdfReport.js", () => ({
  htmlToPdf: vi.fn(async () => Buffer.from("%PDF-1.4 fake")),
  buildEmployeeWeeklyHtml: vi.fn(() => "<html>emp</html>"),
  buildEmployeeMonthlyHtml: vi.fn(() => "<html>emp-monthly</html>"),
  closeBrowser: vi.fn(async () => {}),
}));
vi.mock("../src/lib/campaignReport.js", () => ({ buildCampaignReportHtml: vi.fn(() => "<html>camp</html>") }));

vi.mock("../src/lib/weeklyReports.js", () => ({
  gatherCampaignReport: vi.fn(async ({ cadence }) => ({ cadence, key: `k-${cadence}`, campaigns: [{ campaign_id: "c1" }], totals: {}, ai: {}, period: { since: "s", until: "u" } })),
  gatherEmployeeWeekly: vi.fn(async (agent) => ({ agent, isoWeek: "2026-W29", period: { since: "2026-07-13", until: "2026-07-19" } })),
  gatherEmployeeMonthly: vi.fn(async (agent) => ({ agent, monthKey: "2026-07", month: { since: "2026-07-01", until: "2026-07-31" } })),
  employeeReportData: vi.fn((g, lang) => ({ ...g, lang })),
  employeeMonthlyData: vi.fn((g, lang) => ({ ...g, lang })),
  campaignReportData: vi.fn((g, lang) => ({ ...g, lang })),
  dubaiDow: vi.fn(() => state.dow),
  dubaiDom: vi.fn(() => state.dom),
  dubaiYmd: vi.fn(() => "2026-07-20"),
  weekWindows: vi.fn(() => ({ cur: { since: "2026-07-13", until: "2026-07-19" } })),
}));

// Batch C follow-up: default to nothing actionable so the daily loop is a no-op
// and doesn't perturb the campaign/employee send assertions below.
vi.mock("../src/lib/followupEmail.js", () => ({
  gatherEmployeeFollowup: vi.fn(async (agent) => ({ agent, date: "2026-07-20", counts: { urgent: 0, interested: 0, missed: 0, late: 0 }, urgent: [], interested: [], missed: [], late: [] })),
  buildFollowupEmailHtml: vi.fn(() => "<html>followup</html>"),
}));

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql) => {
    if (sql.includes("reports_email_enabled")) return state.settings.enabled != null ? [{ v: state.settings.enabled }] : [];
    if (sql.includes("from ads_employees")) return state.employees;
    return {};
  }),
}));

const followup = await import("../src/lib/followupEmail.js");
const { runNightly, isNightlyRunning } = await import("../src/jobs/nightlyReports.js");

beforeEach(() => {
  state.settings = {}; state.employees = []; state.hasKey = true; state.dow = 1; state.dom = 15;
  sendOnce.mockClear(); isConfigured.mockReset(); isConfigured.mockReturnValue(true);
  ingestWati.mockReset(); ingestWati.mockResolvedValue({ kept: 3 });
});

const EMPLOYEES = [
  { owner_name: "Omar", email: "omar@co", role: "agent", lang: "ar" },
  { owner_name: null, email: "cm@co", role: "campaign_manager", lang: "ar" },
  { owner_name: null, email: "gm@co", role: "general_manager", lang: "ar" },
];

describe("runNightly", () => {
  it("aborts report generation and alerts managers when AI is unavailable", async () => {
    state.hasKey = false; state.settings.enabled = "1"; state.employees = EMPLOYEES;
    const s = await runNightly({ now: new Date("2026-07-20T00:30:00+04:00") });
    expect(s.preflight).toBe("ai-unavailable");
    const kinds = sendOnce.mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain("alert");
    expect(kinds).not.toContain("campaign_daily");
    expect(kinds).not.toContain("employee_weekly");
  });

  it("sends daily + weekly campaign reports (CC GM) on the weekly day + each agent's own report", async () => {
    state.settings.enabled = "1"; state.employees = EMPLOYEES; state.dow = 1; state.dom = 15;
    const s = await runNightly({ now: new Date("2026-07-20T00:30:00+04:00") });
    const byKind = {};
    for (const [args] of sendOnce.mock.calls) byKind[args.kind] = args;
    expect(byKind.campaign_daily.to).toBe("cm@co");
    expect(byKind.campaign_daily.cc).toEqual(["gm@co"]);
    expect(byKind.campaign_daily.periodKey).toBe("k-daily");
    expect(byKind.campaign_daily.attachments).toHaveLength(2); // ar + en
    expect(byKind.campaign_weekly).toBeTruthy();       // weekly day
    expect(byKind.campaign_monthly).toBeUndefined();   // not the 1st
    expect(byKind.employee_weekly.to).toBe("omar@co");
    expect(s.emails.employee).toBe(1);
  });

  it("adds the monthly campaign + monthly employee reports on day 1", async () => {
    state.settings.enabled = "1"; state.employees = EMPLOYEES; state.dow = 3; state.dom = 1;
    const s = await runNightly({ now: new Date("2026-08-01T00:30:00+04:00") });
    const byKind = {};
    for (const [args] of sendOnce.mock.calls) byKind[args.kind] = args;
    expect(byKind.campaign_daily).toBeTruthy();
    expect(byKind.campaign_monthly).toBeTruthy();
    expect(byKind.campaign_weekly).toBeUndefined();    // not the weekly weekday
    expect(byKind.employee_monthly.to).toBe("omar@co");
    expect(byKind.employee_monthly.periodKey).toBe("2026-07");
    expect(byKind.employee_weekly).toBeUndefined();    // not the weekly weekday
  });

  it("skips employee reports when it is not the weekly day (campaign still runs)", async () => {
    state.settings.enabled = "1"; state.employees = EMPLOYEES; state.dow = 3; state.dom = 15; // Wednesday, mid-month
    const s = await runNightly({ now: new Date("2026-07-22T00:30:00+04:00") });
    const kinds = sendOnce.mock.calls.map((c) => c[0].kind);
    expect(kinds).toContain("campaign_daily");
    expect(kinds).not.toContain("employee_weekly");
    expect(s.stages.employee_reports).toBe("not weekly day");
  });

  it("sends a daily follow-up email to an agent who has actionable leads", async () => {
    state.settings.enabled = "1"; state.employees = EMPLOYEES; state.dow = 3; state.dom = 15; // not weekly/monthly
    followup.gatherEmployeeFollowup.mockResolvedValueOnce({
      agent: "Omar", date: "2026-07-20", counts: { urgent: 2, interested: 1, missed: 0, late: 1 },
      urgent: [], interested: [], missed: [], late: [] });
    await runNightly({ now: new Date("2026-07-22T00:30:00+04:00") });
    const fu = sendOnce.mock.calls.map((c) => c[0]).find((a) => a.kind === "employee_followup");
    expect(fu).toBeTruthy();
    expect(fu.to).toBe("omar@co");
    expect(fu.html).toContain("followup");
    expect(fu.attachments).toBeUndefined(); // inline HTML, no PDF
  });

  it("refuses to start a second run while one is already in progress", async () => {
    state.settings.enabled = "0"; state.employees = EMPLOYEES; state.dow = 3;
    let release;
    ingestWati.mockReturnValueOnce(new Promise((r) => { release = () => r({ kept: 1 }); }));
    const first = runNightly({ now: new Date("2026-07-22T00:30:00+04:00") }); // hangs on ingestWati
    expect(isNightlyRunning()).toBe(true);
    const second = await runNightly({ now: new Date("2026-07-22T00:30:00+04:00") });
    expect(second).toEqual({ skipped: true, reason: "already-running" });
    release();
    await first;
    expect(isNightlyRunning()).toBe(false);
  });

  it("still generates but does not send when the master switch is off", async () => {
    state.settings.enabled = "0"; state.employees = EMPLOYEES; state.dow = 1;
    const s = await runNightly({ now: new Date("2026-07-20T00:30:00+04:00") });
    // sendOnce is called with enabled:false -> returns skipped
    expect(sendOnce).toHaveBeenCalled();
    expect(sendOnce.mock.calls.every((c) => c[0].enabled === false)).toBe(true);
    expect(s.emails.campaign).toBe(0);
    expect(s.emails.employee).toBe(0);
    expect(s.send_enabled).toBe(false);
  });
});
