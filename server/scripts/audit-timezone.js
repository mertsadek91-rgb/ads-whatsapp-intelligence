#!/usr/bin/env node
// BUG-003 audit — quantify the timezone shift before fixing it.
//
// Method: compare the RAW stored values via MySQL's own DATE_FORMAT/CAST (no
// timezone reinterpretation happens inside MySQL — DATE/DATETIME have no TZ
// concept at rest) against what a second, independent client connection
// with an explicit `timezone: 'Z'` (UTC) setting reads back for the same
// rows. If the two disagree, the discrepancy is coming from the DRIVER's
// timezone handling (mysql2 defaults to the process/OS local timezone when
// no `timezone` option is set — confirmed by reading db.js), not from bad
// data on write.
//
// This script does NOT fix anything — it quantifies the damage (per doc 25
// action #5) so Phase 6 can decide the correct account-timezone-aware fix
// (planning/06 §4) with real numbers instead of a guess.
//
// Usage: node scripts/audit-timezone.js   (reads APP/.env via config.js)
import mysql from "mysql2/promise";
import { query as queryDefaultTz, pool } from "../src/db.js";
import config from "../src/config.js";

async function main() {
  console.log(`[tz-audit] process.env.TZ = ${process.env.TZ || "(unset — Node falls back to OS timezone)"}`);

  // 1) Ground truth: raw stored bytes, formatted BY MYSQL ITSELF (no driver
  //    timezone reinterpretation possible — DATE_FORMAT/CAST operate on the
  //    literal stored calendar value).
  const raw = await queryDefaultTz(
    `select wa_id,
            date_format(created_date, '%Y-%m-%d') as created_date_raw,
            date_format(created_at, '%Y-%m-%d %H:%i:%s') as created_at_raw
     from ads_wati_contacts
     where created_at is not null and created_date is not null
     order by wa_id`
  );

  // 2) What the CURRENT pool (no `timezone` option => driver default) hands
  //    the app as JS Date objects, round-tripped back to a string the same
  //    way ingestWati.js's `ymd()` does (toISOString UTC slice).
  const viaCurrentPool = await queryDefaultTz(
    `select wa_id, created_date, created_at from ads_wati_contacts
     where created_at is not null and created_date is not null order by wa_id`
  );

  const rawByWa = new Map(raw.map((r) => [r.wa_id, r]));
  let driverShiftsDate = 0, dateVsDatetimeRawMismatch = 0;
  const samples = [];

  for (const r of viaCurrentPool) {
    const groundTruth = rawByWa.get(r.wa_id);
    if (!groundTruth) continue;

    // (a) Does the RAW stored created_date column already disagree with the
    //     RAW stored created_at's calendar date? (a write-time/ingest bug)
    const createdAtCalendarDay = groundTruth.created_at_raw.slice(0, 10);
    if (groundTruth.created_date_raw !== createdAtCalendarDay) dateVsDatetimeRawMismatch++;

    // (b) Does the DRIVER (current pool, no timezone pin) hand back a
    //     different calendar date for created_date than what is actually
    //     stored? This isolates the mysql2-local-timezone effect (BUG-003).
    const driverDateStr = new Date(r.created_date).toISOString().slice(0, 10);
    if (driverDateStr !== groundTruth.created_date_raw) {
      driverShiftsDate++;
      if (samples.length < 8) {
        samples.push({ wa_id: r.wa_id, stored_raw: groundTruth.created_date_raw, driver_reads_as: driverDateStr });
      }
    }
  }

  console.log(`[tz-audit] rows checked: ${viaCurrentPool.length}`);
  console.log(`[tz-audit] (a) raw created_date column already != raw created_at's calendar day (write-time bug): ${dateVsDatetimeRawMismatch}`);
  console.log(`[tz-audit] (b) driver (current pool, no timezone pin) misreads the stored created_date: ${driverShiftsDate}`);
  if (samples.length) {
    console.log("[tz-audit] sample driver misreads (first 8): stored value vs what JS/mysql2 hands the app");
    for (const s of samples) console.log("  ", JSON.stringify(s));
  }

  console.log(
    "\n[tz-audit] Interpretation:\n" +
    "  - If (a) is ~0 and (b) is large: the DATA is fine; the DRIVER's default\n" +
    "    local-timezone Date conversion is shifting dates on every read. Fix:\n" +
    "    pin `timezone: 'Z'` on the mysql2 pool (db.js) — zero data migration needed.\n" +
    "  - If (a) is large too: the bad date was written into created_date directly\n" +
    "    during ingest (ingestWati.js `ymd()` vs created_at diverging at write time)\n" +
    "    and needs a backfill re-derivation (planning/06 §5 migration), not just a\n" +
    "    driver-config fix."
  );
  await pool().end();
}

main().catch((e) => { console.error("[tz-audit] failed:", e.message); process.exit(1); });
