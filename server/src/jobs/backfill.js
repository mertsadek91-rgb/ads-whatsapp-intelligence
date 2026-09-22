// First-time backfill: ensure schema, load ALL Wati contacts + full Meta period.
// CLI: node src/jobs/backfill.js [--meta-only] [--wati-only] [--messages|--no-messages]
// How far back it reads comes from the configured data range (lib/dataRange.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScript, query } from "../db.js";
import { ingestWati } from "../ingest/ingestWati.js";
import { ingestMeta } from "../ingest/ingestMeta.js";
import config from "../config.js";
import { describeRange } from "../lib/dataRange.js";
import { NO_PROGRESS } from "../lib/jobProgress.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function ensureColumn(table, col, ddl) {
  const r = await query(
    "select count(*) n from information_schema.columns where table_schema=database() and table_name=? and column_name=?",
    [table, col]);
  if (!r[0].n) { await query(`alter table ${table} add column ${col} ${ddl}`); console.log(`[backfill] +column ${table}.${col}`); }
}

export async function ensureSchema() {
  const sql = fs.readFileSync(path.resolve(__dirname, "../schema.sql"), "utf8");
  await runScript(sql);
  // migrations for existing deployments (MySQL has no ADD COLUMN IF NOT EXISTS)
  await ensureColumn("ads_wati_contacts", "attributes", "json").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_meta_ad_perf", "adset_id", "varchar(191)").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_meta_ad_perf", "adset_name", "text").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_conversation_analysis", "thread_snapshot", "json").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_conversation_meta", "replied_after_agent", "tinyint(1) default 0").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_meta_ad_perf", "thumbnail_url", "text").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_meta_ad_perf", "creative_body", "text").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_meta_ad_perf", "reach", "bigint").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_meta_ad_perf", "media_type", "varchar(16)").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_employees", "countries", "json").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_employees", "wati_email", "varchar(191)").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_wati_contacts", "business_channel", "varchar(32)").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_wati_contacts", "msg_unavailable", "tinyint(1) default 0").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_wati_contacts", "country_iso2", "varchar(2)").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_wati_contacts", "wati_contact_id", "varchar(64)").catch((e) => console.warn("[migrate]", e.message));
  await ensureColumn("ads_wati_contacts", "allow_broadcast", "tinyint(1) default 1").catch((e) => console.warn("[migrate]", e.message));
  console.log("[backfill] schema ensured.");
}

export async function backfill(opts = {}) {
  const progress = opts.progress || NO_PROGRESS;
  progress.stage("schema");
  await ensureSchema();
  progress.stageDone();
  console.log(`[backfill] range: ${describeRange(config).en}`);
  if (!opts.metaOnly) {
    // Message history defaults to the operator's own choice from setup, so the
    // button in Settings and `npm run backfill` do the same thing. --messages
    // still forces it on for a one-off catch-up.
    await ingestWati({
      incremental: false,
      messages: opts.messages !== undefined ? !!opts.messages : !!config.data.watiMessages,
      progress,
    });
  }
  if (!opts.watiOnly) {
    await ingestMeta({ full: true, progress });
  }
  console.log("[backfill] done.");
}

// Inside an async function, not at module scope. A top-level await anywhere in
// the graph makes the whole graph un-require()-able — Node raises
// ERR_REQUIRE_ASYNC_MODULE — and server.js imports ensureSchema from this file.
// That does not matter when the app is started as `node src/server.js`, and it
// is fatal on hosting that require()s the entry file, which is what the
// CloudLinux/Passenger runners behind much shared hosting do. The app built
// perfectly there and died on its first line.
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const a = process.argv.slice(2);
    const { bootstrapCli } = await import("../lib/bootstrapCli.js");
    await bootstrapCli();
    await backfill({
      metaOnly: a.includes("--meta-only"),
      watiOnly: a.includes("--wati-only"),
      ...(a.includes("--messages") ? { messages: true }
        : a.includes("--no-messages") ? { messages: false } : {}),
    });
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}

export default backfill;
