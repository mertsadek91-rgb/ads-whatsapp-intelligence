// In-process daily scheduler (node-cron). Started by server.js.
import cron from "node-cron";
import config from "../config.js";
import { runNightly } from "./nightlyReports.js";
import { runQuickSync } from "./quickSync.js";
import { pool } from "../db.js";

let running = false;
let quickRunning = false;

// BUG-028 fix: today this app runs as a single instance/container (confirmed
// via docker-compose.yml — no `replicas` configured, so this is not an
// active risk right now), and the in-memory `running` flag above correctly
// prevents overlap *within that one process*. If this were ever scaled
// horizontally, every replica would fire its own cron tick simultaneously,
// each with its own `running=false`. MySQL's GET_LOCK() is an atomic,
// connection-scoped named lock — cheap insurance now (no schema/migration,
// reuses the existing pool), and it auto-releases if a replica crashes
// mid-run, unlike a manual DB-row TTL lock would require.
export async function withLeaderLock(name, fn) {
  const conn = await pool().getConnection();
  try {
    const [rows] = await conn.query("select get_lock(?, 0) got", [name]);
    if (!rows[0]?.got) {
      console.warn(`[cron] another instance already holds the "${name}" lock; skipping this tick`);
      return;
    }
    try { await fn(); }
    finally { await conn.query("select release_lock(?)", [name]).catch(() => {}); }
  } finally {
    conn.release();
  }
}

export function startScheduler() {
  if (!cron.validate(config.cronTime)) {
    console.warn(`[cron] invalid CRON_TIME "${config.cronTime}" — scheduler disabled`);
    return;
  }
  cron.schedule(config.cronTime, async () => {
    if (running) return console.warn("[cron] previous run still going; skipping");
    running = true;
    try { await withLeaderLock("ist-markets:daily-cron", () => runNightly()); }
    catch (e) { console.error("[cron] runNightly failed:", e.message); }
    finally { running = false; }
  }, { timezone: config.cronTimezone });
  console.log(`[cron] nightly job scheduled at "${config.cronTime}" (${config.cronTimezone})`);

  // Every-30-min quick sync to keep the sales-floor leaderboard live.
  const qc = config.quickSyncCron;
  if (qc && cron.validate(qc)) {
    cron.schedule(qc, async () => {
      if (quickRunning) return console.warn("[cron] previous quick-sync still going; skipping");
      quickRunning = true;
      try { await withLeaderLock("ist-markets:quick-sync", () => runQuickSync()); }
      catch (e) { console.error("[cron] runQuickSync failed:", e.message); }
      finally { quickRunning = false; }
    }, { timezone: config.cronTimezone });
    console.log(`[cron] quick-sync scheduled at "${qc}" (${config.cronTimezone})`);
  } else if (qc) {
    console.warn(`[cron] invalid QUICK_SYNC_CRON "${qc}" — quick-sync disabled`);
  }
}

export default startScheduler;
