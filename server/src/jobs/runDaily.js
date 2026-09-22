// Daily incremental orchestrator: Wati (24h) + Meta refresh + AI auto-analysis.
import { ingestWati } from "../ingest/ingestWati.js";
import { ingestMeta } from "../ingest/ingestMeta.js";
import * as cmeta from "../lib/conversationMeta.js";
import * as analysis from "../lib/conversationAnalysis.js";
import * as ds from "../lib/deepseek.js";
import { cleanupLogs } from "../lib/errorLog.js";
import { query } from "../db.js";
import config from "../config.js"; // BUG-029 fix: was reading process.env directly, bypassing config

const AUTO_CAP = config.autoAnalyzeCap;
const HUMAN = ["human_handled", "awaiting_human"];

// Sync engagement metrics for recently-active conversations, then AI-analyze the
// human-handled, new/stale ones (capped). Skips bot-only conversations.
export async function autoAnalyze({ cap = AUTO_CAP } = {}) {
  const recent = (await query(
    `select wa_id from ads_wati_contacts
     where num_messages>0 and last_message_at >= (now() - interval 2 day) limit 600`)).map((r) => r.wa_id);
  let synced = 0;
  let i = 0;
  const syncWorker = async () => {
    while (i < recent.length) {
      try { await cmeta.syncOne(recent[i]); synced++; } catch { /* */ }
      i++;
    }
  };
  await Promise.all(Array.from({ length: 3 }, syncWorker));

  let analyzed = 0;
  if (ds.hasKey()) {
    const todo = (await query(
      `select c.wa_id from ads_wati_contacts c
       join ads_conversation_meta m on m.wa_id=c.wa_id
       left join ads_conversation_analysis a on a.wa_id=c.wa_id
       where m.conv_type in ('human_handled','awaiting_human')
         and c.last_message_at >= (now() - interval 2 day)
         and (a.wa_id is null or a.message_count is null or a.message_count <> m.msg_total)
       order by c.last_message_at desc limit ${Number(cap)}`)).map((r) => r.wa_id);
    for (const id of todo) {
      try { await analysis.analyze(id); analyzed++; } catch (e) { console.error("[auto] analyze", id, e.message); }
    }
  }
  return { synced, analyzed };
}

export async function runDaily({ hours = 24 } = {}) {
  console.log(`\n=== runDaily ${new Date().toISOString()} ===`);
  const wati = await ingestWati({ incremental: true, hours, messages: true });
  const meta = await ingestMeta({});
  let auto = { synced: 0, analyzed: 0 };
  try { auto = await autoAnalyze(); } catch (e) { console.error("[auto] failed:", e.message); }
  // BUG-017 slice 2: 90-day retention for the api/error log tables.
  try {
    const purged = await cleanupLogs(90);
    if (purged.api_logs || purged.error_logs) console.log("[retention] purged", purged);
  } catch (e) { console.error("[retention] failed:", e.message); }
  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO ads_report_runs (run_date, summary) VALUES (?, ?)
     AS new ON DUPLICATE KEY UPDATE built_at=now(), summary=new.summary`,
    [today, `daily: wati +${wati.kept}, meta ${meta.skipped ? "skipped" : "ok"}, synced ${auto.synced}, analyzed ${auto.analyzed}`]
  );
  console.log("=== runDaily done ===", auto);
  return { wati, meta, auto };
}

// Async IIFE, not top-level await — see the note in backfill.js: a top-level
// await anywhere in the graph makes the entry un-require()-able.
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const { bootstrapCli } = await import("../lib/bootstrapCli.js");
    await bootstrapCli();
    await runDaily();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

export default runDaily;
