// First-time backfill: ensure schema, load ALL Wati contacts + full Meta period.
// CLI: node src/jobs/backfill.js [--meta-only] [--wati-only] [--messages]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScript, query } from "../db.js";
import { ingestWati } from "../ingest/ingestWati.js";
import { ingestMeta } from "../ingest/ingestMeta.js";

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
  await ensureSchema();
  if (!opts.metaOnly) {
    await ingestWati({ incremental: false, messages: !!opts.messages });
  }
  if (!opts.watiOnly) {
    await ingestMeta({ full: true });
  }
  console.log("[backfill] done.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  backfill({
    metaOnly: a.includes("--meta-only"),
    watiOnly: a.includes("--wati-only"),
    messages: a.includes("--messages"),
  }).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

export default backfill;
