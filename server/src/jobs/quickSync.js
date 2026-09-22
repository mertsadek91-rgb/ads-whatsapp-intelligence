// Lightweight every-30-min refresh that keeps the sales-floor leaderboard live:
// pull recent Wati + Meta, analyze new conversations (budget-guarded), and
// snapshot contact status. Deliberately NOT the full nightly pipeline — no
// reports, no emails, no PDFs. Guarded by an in-process flag so overlapping
// ticks can't stack, and records its outcome in ads_report_runs for the status
// panel. Safe to call manually too.
import { ingestWati } from "../ingest/ingestWati.js";
import { ingestMeta } from "../ingest/ingestMeta.js";
import { autoAnalyze } from "./runDaily.js";
import { snapshotContactStatus } from "../lib/contactStatus.js";
import { query } from "../db.js";
import config from "../config.js";

let running = false;
export function isQuickSyncRunning() { return running; }

export async function runQuickSync({ now = new Date() } = {}) {
  if (running) return { skipped: true, reason: "already-running" };
  running = true;
  const summary = { at: now.toISOString(), stages: {} };
  try {
    try { const w = await ingestWati({ incremental: true, hours: 2, messages: true }); summary.stages.wati = w.kept ?? "ok"; }
    catch (e) { summary.stages.wati = "ERR:" + e.message; }
    try { const m = await ingestMeta({}); summary.stages.meta = m.skipped ? "skipped" : "ok"; }
    catch (e) { summary.stages.meta = "ERR:" + e.message; }
    try { const a = await autoAnalyze({ cap: config.quickSyncAnalyzeCap }); summary.stages.analyzed = a.analyzed; }
    catch (e) { summary.stages.analyze = "ERR:" + e.message; }
    try { const s = await snapshotContactStatus({ now }); summary.stages.followup_snapshot = s.snapshotted; }
    catch (e) { summary.stages.followup_snapshot = "ERR:" + e.message; }

    await query(
      `insert into ads_report_runs (run_date, summary) values (?, ?) on duplicate key update built_at=now(), summary=values(summary)`,
      [new Date().toISOString().slice(0, 10), "quicksync: " + JSON.stringify(summary).slice(0, 950)]
    ).catch(() => {});
    return summary;
  } finally {
    running = false;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runQuickSync().then((s) => { console.log(JSON.stringify(s)); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
}

export default runQuickSync;
