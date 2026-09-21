// Nightly report pipeline (03:00 Asia/Dubai). Orchestrates the full sequence:
// sync Wati -> refresh Meta -> analyze ALL new conversations (uncapped, budget-
// guarded) -> preflight the AI -> generate the daily campaign report and (on
// the weekly day) each employee's own report -> email them, bilingual PDFs
// attached, CC the general manager. Actual sending is double-gated: the master
// switch (ads_settings.reports_email_enabled) AND SMTP being configured; when
// either is off the pipeline still runs and generates everything, it just
// doesn't send (sendOnce returns skipped). Idempotent per period via
// ads_email_log so a manual re-run never double-sends.
import { ingestWati } from "../ingest/ingestWati.js";
import { ingestMeta } from "../ingest/ingestMeta.js";
import { autoAnalyze } from "./runDaily.js";
import { snapshotContactStatus } from "../lib/contactStatus.js";
import { cleanupLogs } from "../lib/errorLog.js";
import { query } from "../db.js";
import config from "../config.js";
import * as ds from "../lib/deepseek.js";
import { isConfigured, sendOnce } from "../lib/mailer.js";
import { htmlToPdf, buildEmployeeWeeklyHtml, buildEmployeeMonthlyHtml, closeBrowser } from "../lib/pdfReport.js";
import { buildCampaignReportHtml } from "../lib/campaignReport.js";
import { getIdentity, displayName } from "../lib/appIdentity.js";
import { gatherEmployeeFollowup, buildFollowupEmailHtml } from "../lib/followupEmail.js";
import { dubaiYmd } from "../lib/weeklyReports.js";
import {
  gatherEmployeeWeekly, gatherEmployeeMonthly, gatherCampaignReport, employeeReportData,
  employeeMonthlyData, campaignReportData, dubaiDow, dubaiDom, weekWindows,
} from "../lib/weeklyReports.js";

async function emailEnabled() {
  const r = await query("select v from ads_settings where k='reports_email_enabled'");
  return r.length ? r[0].v === "1" : false;
}

async function recipients() {
  const rows = await query(
    "select owner_name, email, role, lang from ads_employees where active=1 and email<>''");
  return {
    agents: rows.filter((r) => r.role === "agent" && r.owner_name),
    campaignManagers: rows.filter((r) => r.role === "campaign_manager"),
    gms: rows.filter((r) => r.role === "general_manager"),
  };
}

async function recordRun(summary) {
  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO ads_report_runs (run_date, summary) VALUES (?, ?)
     AS new ON DUPLICATE KEY UPDATE built_at=now(), summary=new.summary`,
    [today, "nightly: " + JSON.stringify(summary).slice(0, 950)]).catch(() => {});
}

// In-process guard so overlapping runs can't stack up. The cron path already
// has its own guard + DB leader lock, but the manual /admin/run-nightly button
// had none — clicking it repeatedly launched several concurrent pipelines
// (duplicate Wati/Meta pulls, self-inflicted Meta rate-limiting). This makes a
// second run a no-op while one is in flight, whatever the trigger.
let running = false;
export function isNightlyRunning() { return running; }

/**
 * @param {object} opts
 *  - force: bypass the per-period ads_email_log dedup (re-send).
 *  - reportsOnly: skip the heavy Wati/Meta sync + analyze stage and build the
 *    reports from already-synced data (the manual "generate & send now" button).
 *  - sendOverride: send even if the master switch is off — an explicit human
 *    click, not the automated nightly run (still requires SMTP configured).
 *  - includeEmployees: force employee reports on/off regardless of the weekday
 *    gate (null = use the Dubai weekday gate, the automated behavior).
 */
export async function runNightly({ force = false, now = new Date(),
  reportsOnly = false, sendOverride = false, includeEmployees = null } = {}) {
  if (running) {
    console.warn("[nightly] a run is already in progress — skipping this trigger");
    return { skipped: true, reason: "already-running" };
  }
  running = true;
  try {
    return await runNightlyInner({ force, now, reportsOnly, sendOverride, includeEmployees });
  } finally {
    running = false;
  }
}

async function runNightlyInner({ force, now, reportsOnly, sendOverride, includeEmployees }) {
  console.log(`\n=== runNightly ${now.toISOString()}${reportsOnly ? " (reports-only)" : ""} ===`);
  const summary = { stages: {}, emails: { campaign: 0, employee: 0, skipped: 0, alerts: 0 } };

  // Report headers and email subjects carry whatever this installation calls
  // itself, rather than a company name compiled into the source.
  const identity = await getIdentity();
  const brand = displayName(identity, "ar");
  const brandEn = displayName(identity, "en");

  // ---- 1. data stage (skipped for the manual reports-only trigger) ----
  if (reportsOnly) {
    summary.stages.data = "skipped (reports-only)";
  } else {
    try { const w = await ingestWati({ incremental: true, hours: 24, messages: true }); summary.stages.wati = w.kept ?? "ok"; }
    catch (e) { summary.stages.wati = "ERR:" + e.message; }
    try { const m = await ingestMeta({}); summary.stages.meta = m.skipped ? "skipped" : "ok"; }
    catch (e) { summary.stages.meta = "ERR:" + e.message; }
    try { const a = await autoAnalyze({ cap: config.nightlyAnalyzeCap }); summary.stages.analyzed = a.analyzed; }
    catch (e) { summary.stages.analyze = "ERR:" + e.message; }
    try { const s = await snapshotContactStatus({ now }); summary.stages.followup_snapshot = s.snapshotted; }
    catch (e) { summary.stages.followup_snapshot = "ERR:" + e.message; }
    try { await cleanupLogs(90); } catch { /* non-fatal */ }
  }

  const enabled = sendOverride || await emailEnabled();
  const rec = await recipients();
  const gmCc = rec.gms.map((g) => g.email);
  summary.send_enabled = enabled;
  summary.smtp = isConfigured();

  // ---- 2. preflight (item 10): AI must be available to produce reports ----
  if (!ds.hasKey()) {
    summary.preflight = "ai-unavailable";
    const alertTo = [...new Set([...rec.campaignManagers, ...rec.gms].map((r) => r.email))];
    for (const to of alertTo) {
      const r = await sendOnce({
        kind: "alert", to, periodKey: weekWindows(now).cur.until, cc: gmCc.filter((e) => e !== to),
        subject: `${brand} — تنبيه: تعذّر توليد التقارير (الذكاء الاصطناعي غير متاح)`,
        text: "لم يعمل مفتاح الذكاء الاصطناعي، لذا لم تُولَّد تقارير الليلة. يُرجى التحقق من إعداد DEEPSEEK_API_KEY.",
        enabled, force,
      });
      if (r.sent) summary.emails.alerts++;
    }
    await recordRun(summary);
    console.log("=== runNightly ABORTED (AI unavailable) ===", summary);
    return summary;
  }

  // ---- 3. campaign reports -> campaign managers, CC GM ----
  // Daily every run; weekly on the weekly weekday; monthly on day 1 (Dubai).
  // includeEmployees=true (the manual "send now") forces all three.
  const manual = includeEmployees != null;
  const cadences = ["daily"];
  if (manual || dubaiDow(now) === (config.weeklyReportDow ?? 1)) cadences.push("weekly");
  if (manual || dubaiDom(now) === 1) cadences.push("monthly");
  const CAD_AR = { daily: "اليومي", weekly: "الأسبوعي", monthly: "الشهري" };
  for (const cadence of cadences) {
    try {
      const g = await gatherCampaignReport({ cadence, now, force });
      const attachments = [];
      for (const lang of ["ar", "en"]) {
        const html = buildCampaignReportHtml({ ...campaignReportData(g, lang), brand: displayName(identity, lang) });
        // Landscape: the campaign report's hierarchy + country tables are wide.
        attachments.push({ filename: `campaigns-${cadence}-${g.key}-${lang}.pdf`, content: await htmlToPdf(html, { landscape: true }) });
      }
      const subject = `${brand} — تقرير الحملات ${CAD_AR[cadence]} ${g.key}`;
      const text = `تقرير الحملات ${CAD_AR[cadence]} (${g.period.since} إلى ${g.period.until}) مقارنةً بالفترة السابقة، مرفق بالعربية والإنجليزية.`;
      for (const cm of rec.campaignManagers) {
        const r = await sendOnce({ kind: `campaign_${cadence}`, to: cm.email, periodKey: g.key,
          cc: gmCc.filter((e) => e !== cm.email), subject, text, attachments, enabled, force });
        if (r.sent) summary.emails.campaign++; else summary.emails.skipped++;
      }
      summary.stages[`campaign_${cadence}`] = `generated (${g.campaigns.length} active)`;
    } catch (e) { summary.stages[`campaign_${cadence}`] = "ERR:" + e.message; console.error(`[nightly] campaign ${cadence}:`, e.message); }
  }

  // ---- 4. weekly employee reports (weekday gate, or forced by the caller) ----
  const doEmployees = includeEmployees != null ? includeEmployees : (dubaiDow(now) === (config.weeklyReportDow ?? 1));
  if (doEmployees) {
    summary.stages.employee_reports = 0;
    for (const emp of rec.agents) {
      try {
        const g = await gatherEmployeeWeekly(emp.owner_name, { now, force });
        const attachments = [];
        for (const lang of ["ar", "en"]) {
          const html = buildEmployeeWeeklyHtml({ ...employeeReportData(g, lang), brand: displayName(identity, lang) });
          attachments.push({
            filename: `report-${emp.owner_name}-${g.isoWeek}-${lang}.pdf`.replace(/[^\w.-]+/g, "_"),
            content: await htmlToPdf(html),
          });
        }
        const en = emp.lang === "en";
        const subject = en ? `${brandEn} — Your weekly report ${g.isoWeek}` : `${brand} — تقريرك الأسبوعي ${g.isoWeek}`;
        const text = en
          ? `Your weekly performance report (${g.period.since} to ${g.period.until}) is attached in Arabic and English.`
          : `تقرير أدائك الأسبوعي (${g.period.since} إلى ${g.period.until}) مرفق بالعربية والإنجليزية.`;
        const r = await sendOnce({ kind: "employee_weekly", to: emp.email, periodKey: g.isoWeek,
          cc: gmCc, subject, text, attachments, enabled, force });
        if (r.sent) summary.emails.employee++; else summary.emails.skipped++;
        summary.stages.employee_reports++;
      } catch (e) { console.error("[nightly] employee", emp.owner_name, e.message); }
    }
  } else {
    summary.stages.employee_reports = "not weekly day";
  }

  // ---- 5. monthly employee package on day 1 (Dubai) — or forced by the caller.
  // Week-by-week progression + month-vs-month, each employee their own.
  if (manual || dubaiDom(now) === 1) {
    summary.stages.employee_monthly = 0;
    for (const emp of rec.agents) {
      try {
        const g = await gatherEmployeeMonthly(emp.owner_name, { now, force });
        const attachments = [];
        for (const lang of ["ar", "en"]) {
          const html = buildEmployeeMonthlyHtml({ ...employeeMonthlyData(g, lang), brand: displayName(identity, lang) });
          attachments.push({
            filename: `monthly-${emp.owner_name}-${g.monthKey}-${lang}.pdf`.replace(/[^\w.-]+/g, "_"),
            content: await htmlToPdf(html),
          });
        }
        const en = emp.lang === "en";
        const subject = en ? `${brandEn} — Your monthly report ${g.monthKey}` : `${brand} — تقريرك الشهري ${g.monthKey}`;
        const text = en
          ? `Your monthly report for ${g.monthKey} (weekly progression + month-vs-month) is attached in Arabic and English.`
          : `تقريرك الشهري لشهر ${g.monthKey} (تطوّر الأسابيع + مقارنة الشهر بالسابق) مرفق بالعربية والإنجليزية.`;
        const r = await sendOnce({ kind: "employee_monthly", to: emp.email, periodKey: g.monthKey,
          cc: gmCc, subject, text, attachments, enabled, force });
        if (r.sent) summary.emails.employee++; else summary.emails.skipped++;
        summary.stages.employee_monthly++;
      } catch (e) { console.error("[nightly] employee monthly", emp.owner_name, e.message); }
    }
  }

  // ---- 6. daily per-employee follow-up alert (every run) ----
  // Which of the agent's own leads still need a human reply before the WhatsApp
  // 24h window closes, interested leads to nurture, and late/cross-day updates.
  // Inline HTML email (no PDF) — a short operational alert, sent to the employee
  // only (no GM CC to avoid daily noise). Idempotent per Dubai day.
  summary.stages.followup_emails = 0;
  const followupKey = dubaiYmd(now);
  for (const emp of rec.agents) {
    try {
      const data = await gatherEmployeeFollowup(emp.owner_name, { now });
      // Skip the send entirely when there's genuinely nothing to act on.
      const c = data.counts;
      if (!(c.urgent || c.interested || c.missed || c.late)) { continue; }
      const en = emp.lang === "en";
      const html = buildFollowupEmailHtml(data, en ? "en" : "ar");
      const subject = en
        ? `${brandEn} — Follow-ups: ${c.urgent} urgent, ${c.interested} interested`
        : `${brand} — متابعة: ${c.urgent} عاجل، ${c.interested} مهتم`;
      const text = en
        ? `${c.urgent} customers need contact before their WhatsApp window closes; ${c.interested} interested to nurture. See the details in this email.`
        : `${c.urgent} عميلاً يحتاجون تواصلاً قبل إغلاق نافذة واتساب؛ ${c.interested} مهتمّاً للمتابعة. التفاصيل في هذا البريد.`;
      const r = await sendOnce({ kind: "employee_followup", to: emp.email, periodKey: followupKey,
        subject, text, html, enabled, force });
      if (r.sent) { summary.emails.employee++; summary.stages.followup_emails++; } else summary.emails.skipped++;
    } catch (e) { console.error("[nightly] followup", emp.owner_name, e.message); }
  }

  // ---- 7. Knowledge Base self-learning (weekly, or forced) ----
  // Re-distil Q&A drafts from recent conversations; merges into existing rows
  // (bumping times_seen) so the base accumulates. Budget-guarded + non-fatal.
  if (manual || dubaiDow(now) === (config.weeklyReportDow ?? 1)) {
    try {
      const { generateKB } = await import("../lib/knowledgeBase.js");
      const kb = await generateKB({ now });
      summary.stages.knowledge_base = `refreshed (${kb.upserted} pairs from ${kb.sampled})`;
    } catch (e) { summary.stages.knowledge_base = "ERR:" + e.message; console.error("[nightly] KB:", e.message); }
  }

  await closeBrowser().catch(() => {});
  await recordRun(summary);
  console.log("=== runNightly done ===", JSON.stringify(summary));
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runNightly().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

export default runNightly;
