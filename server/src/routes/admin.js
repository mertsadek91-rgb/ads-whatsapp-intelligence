import { Router } from "express";
import { runDaily } from "../jobs/runDaily.js";
import { runNightly, isNightlyRunning } from "../jobs/nightlyReports.js";
import { backfill } from "../jobs/backfill.js";
import { ingestWati } from "../ingest/ingestWati.js";
import { refreshBoards, isBoardRefreshing } from "../jobs/boardRefresh.js";
import { ingestMeta } from "../ingest/ingestMeta.js";
import { loadJobState, saveJobState, correctInterrupted } from "../lib/jobState.js";
import { sendMail, isConfigured } from "../lib/mailer.js";
import {
  gatherCampaignReport, campaignReportData, gatherEmployeeWeekly, employeeReportData,
  gatherEmployeeMonthly, employeeMonthlyData, availablePeriods, weekWindowFrom, monthWindowFrom,
} from "../lib/weeklyReports.js";
import { buildCampaignReportHtml } from "../lib/campaignReport.js";
import { buildEmployeeWeeklyHtml, buildEmployeeMonthlyHtml, htmlToPdf } from "../lib/pdfReport.js";
import { query } from "../db.js";
import { wrap } from "../lib/wrap.js";

const router = Router();
const asLang = (q) => (q === "en" ? "en" : "ar");

// Send a one-off test email so the admin can confirm SMTP works BEFORE turning
// on the master send switch. Never records to ads_email_log (it's not a report).
router.post("/send-test-email", wrap(async (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: "SMTP غير مضبوط — اضبط متغيرات البيئة في Coolify" });
  const to = String(req.body?.to || req.session?.email || "").trim();
  if (!to) return res.status(400).json({ error: "أدخل بريداً للاختبار" });
  const now = new Date().toLocaleString("en-GB");
  const r = await sendMail({
    to, subject: "IST Markets — بريد اختبار / Test email",
    text: `هذا بريد اختبار من منصة IST Markets للتأكد من عمل الإرسال.\nThis is a test email confirming SMTP delivery works.\n\n${now}`,
  });
  res.json({ ok: !r.skipped, ...r });
}));

// Manually trigger the whole nightly pipeline (sync -> analyze -> reports ->
// email). Fire-and-forget: responds immediately, runs in the background.
// `force` bypasses the per-period email dedup (for re-sends/testing).
// Status panel data: whether a run is in flight, the most recent nightly run
// summary (from ads_report_runs), and the latest outbound report emails
// (from ads_email_log) — so the admin can follow the pipeline in-app instead
// of tailing Coolify logs.
router.get("/report-status", wrap(async (req, res) => {
  const runs = await query(
    "select run_date, built_at, summary from ads_report_runs order by built_at desc limit 1");
  const emails = await query(
    "select kind, recipient, period_key, status, error, sent_at from ads_email_log order by sent_at desc limit 30");
  res.json({ running: isNightlyRunning(), last_run: runs[0] || null, emails });
}));

// ---- On-demand report PREVIEW (stream the exact PDF that gets emailed, so
// the owner can study the final result in-app without waiting for email). ----
function sendPdf(res, pdf, filename) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`); // inline = opens in the browser tab
  res.send(pdf);
}

// The selectable weeks/months for the preview pickers ("show all").
router.get("/report/periods", wrap(async (req, res) => res.json(await availablePeriods(new Date()))));

// Campaign report for a cadence (daily|weekly|monthly), landscape like the email.
// ?week=<Monday> or ?month=<YYYY-MM> pick a specific period; otherwise the last one.
router.get("/report/campaign.pdf", wrap(async (req, res) => {
  const cadence = ["daily", "weekly", "monthly"].includes(req.query.cadence) ? req.query.cadence : "weekly";
  const lang = asLang(req.query.lang);
  let window = null;
  if (cadence === "weekly" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week || "")) window = weekWindowFrom(req.query.week);
  if (cadence === "monthly" && /^\d{4}-\d{2}$/.test(req.query.month || "")) window = monthWindowFrom(req.query.month);
  const g = await gatherCampaignReport({ cadence, now: new Date(), force: false, window });
  const pdf = await htmlToPdf(buildCampaignReportHtml(campaignReportData(g, lang)), { landscape: true });
  sendPdf(res, pdf, `campaign-${cadence}-${g.key}-${lang}.pdf`);
}));

// One agent's weekly comparison report. ?week=<Monday> picks a specific week.
router.get("/report/employee-weekly.pdf", wrap(async (req, res) => {
  const agent = String(req.query.agent || "").trim();
  if (!agent) return res.status(400).json({ error: "أدخل اسم الموظف" });
  const lang = asLang(req.query.lang);
  const window = /^\d{4}-\d{2}-\d{2}$/.test(req.query.week || "") ? weekWindowFrom(req.query.week) : null;
  const g = await gatherEmployeeWeekly(agent, { now: new Date(), force: false, window });
  const pdf = await htmlToPdf(buildEmployeeWeeklyHtml(employeeReportData(g, lang)));
  sendPdf(res, pdf, `employee-weekly-${agent}-${g.isoWeek}-${lang}.pdf`.replace(/[^\w.-]+/g, "_"));
}));

// One agent's monthly package. ?month=<YYYY-MM> picks a specific month.
router.get("/report/employee-monthly.pdf", wrap(async (req, res) => {
  const agent = String(req.query.agent || "").trim();
  if (!agent) return res.status(400).json({ error: "أدخل اسم الموظف" });
  const lang = asLang(req.query.lang);
  const window = /^\d{4}-\d{2}$/.test(req.query.month || "") ? monthWindowFrom(req.query.month) : null;
  const g = await gatherEmployeeMonthly(agent, { now: new Date(), force: false, window });
  const pdf = await htmlToPdf(buildEmployeeMonthlyHtml(employeeMonthlyData(g, lang)));
  sendPdf(res, pdf, `employee-monthly-${agent}-${g.monthKey}-${lang}.pdf`.replace(/[^\w.-]+/g, "_"));
}));

router.post("/run-nightly", (req, res) => {
  if (isNightlyRunning()) {
    return res.status(409).json({ error: "التشغيل قيد التنفيذ بالفعل — انتظر انتهاءه" });
  }
  const force = !!(req.body && req.body.force);
  res.json({ started: true, force });
  runNightly({ force })
    .then((s) => console.log("[admin] run-nightly done:", JSON.stringify(s)))
    .catch((e) => console.error("[admin] run-nightly failed:", e.message));
});

// Manual "generate & send now": builds the reports from already-synced data
// (skips the heavy Wati/Meta sync + analyze), sends immediately regardless of
// the master switch and the weekday gate, and re-sends even if already sent
// this period (force). Requires SMTP to be configured. Fire-and-forget — the
// result shows up in the status panel.
router.post("/send-reports-now", (req, res) => {
  if (!isConfigured()) return res.status(400).json({ error: "SMTP غير مضبوط — اضبط متغيرات البيئة أولاً" });
  if (isNightlyRunning()) return res.status(409).json({ error: "التشغيل قيد التنفيذ بالفعل — انتظر انتهاءه" });
  res.json({ started: true });
  runNightly({ force: true, reportsOnly: true, sendOverride: true, includeEmployees: true })
    .then((s) => console.log("[admin] send-reports-now done:", JSON.stringify(s)))
    .catch((e) => console.error("[admin] send-reports-now failed:", e.message));
});
function idle() { return { state: "idle", result: null, error: null, startedAt: null, finishedAt: null }; }

// Per-source job state so each update button reports its own result/error.
// BUG-012 fix: hydrated from + persisted to ads_job_state (see jobState.js)
// so a restart mid-run reports "error" instead of a misleading fresh "idle".
// hydrateJobs() is called from server.js's boot() AFTER ensureSchema() —
// calling it at module-import time would race the table's own creation on a
// fresh database.
const jobs = { wati: idle(), meta: idle() };

export async function hydrateJobs() {
  for (const name of Object.keys(jobs)) {
    try {
      const saved = correctInterrupted(await loadJobState(`admin:${name}`));
      if (saved) jobs[name] = saved;
    } catch (e) { console.error(`[admin] job state hydrate (${name}) failed:`, e.message); }
  }
}

function persist(name) {
  return saveJobState(`admin:${name}`, jobs[name]).catch((e) => console.error(`[admin] job state save (${name}) failed:`, e.message));
}

async function start(name, fn, res) {
  if (jobs[name].state === "running") {
    return res.status(409).json({ error: "التحديث قيد التشغيل بالفعل" });
  }
  jobs[name] = { ...idle(), state: "running", startedAt: Date.now() };
  await persist(name);
  res.json({ started: true });
  try {
    const result = await fn();
    jobs[name] = { state: "done", result, error: null, startedAt: jobs[name].startedAt, finishedAt: Date.now() };
    await persist(name);
    console.log(`[admin] ${name} done:`, JSON.stringify(result));
  } catch (e) {
    jobs[name] = { state: "error", result: null, error: e.message || String(e), startedAt: jobs[name].startedAt, finishedAt: Date.now() };
    await persist(name);
    console.error(`[admin] ${name} error:`, e.message);
  }
}

// Isolated updates — each side independently.
router.post("/update-wati", (req, res) =>
  start("wati", () => ingestWati({ incremental: true, hours: Number(req.body?.hours) || 24, messages: true }), res));

router.post("/update-meta", (req, res) =>
  start("meta", () => ingestMeta({ full: !!(req.body && req.body.full) }), res));

// Combined (used by the cron scheduler too).
router.post("/run-daily", (req, res) =>
  start("wati", async () => {
    const r = await runDaily();
    jobs.meta = { state: "done", result: r.meta, error: null, startedAt: Date.now(), finishedAt: Date.now() };
    await persist("meta");
    return r.wati;
  }, res));

router.post("/backfill", (req, res) =>
  start("wati", () => backfill({ messages: !!(req.body && req.body.messages) }), res));

/**
 * EMERGENCY board refresh — re-read everything behind the two wall boards now.
 *
 * Separate from /update-wati because that only pulls the contact list; the part
 * that goes stale is the per-conversation read, which the 30-minute tick caps at
 * 600 rows. This one is uncapped over the board's window.
 *
 * Synchronous on purpose: the whole point is standing in front of the board and
 * getting an answer, so the caller waits and receives what changed. Long window
 * on a big account can take a couple of minutes — the UI says so.
 */
router.post("/refresh-boards", async (req, res) => {
  if (isBoardRefreshing()) return res.status(409).json({ error: "التحديث قيد التشغيل بالفعل" });
  try {
    res.json(await refreshBoards({
      days: Number(req.body?.days) || 7,
      hours: Number(req.body?.hours) || 6,
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/refresh-boards/status", async (req, res) => {
  try {
    // How stale is the board right now — the reason to press the button, or not.
    const [f] = await query(
      `select max(c.loaded_at) contacts_synced_at, max(m.synced_at) conversations_synced_at,
              min(m.synced_at) oldest_conversation_read
       from ads_wati_contacts c
       left join ads_conversation_meta m on m.wa_id = c.wa_id
       where c.created_date >= (curdate() - interval 7 day)`);
    res.json({ running: isBoardRefreshing(), ...f });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/status", (req, res) => res.json(jobs));

export default router;
