// BUG-003 regression guard (integration — needs a real MySQL).
//
// The mysql2 pool had no `timezone` option, so it defaulted to the process's
// local OS timezone when converting DATE/DATETIME columns to JS Date on read
// — shifting every stored date back by one day on every single read, even
// though the underlying stored data was always correct (proven by
// scripts/audit-timezone.js: write-time mismatch = 0, driver-read mismatch =
// 100% before the fix, 0% after). Fixed by pinning `timezone: 'Z'` in db.js.
//
// It used to test by scanning existing rows and nothing else, so it could only
// run against a populated production database. On CI, against an empty schema,
// it failed with "table doesn't exist" instead of reporting that it had nothing
// to check. It now writes its own row — which makes the driver's behaviour
// provable from nothing — and still scans real data when there is any, because
// a fixture cannot say anything about a live dataset.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import config, { parseMysqlUrl } from "../../src/config.js";

if (process.env.TEST_MYSQL_URL) config.mysql = parseMysqlUrl(process.env.TEST_MYSQL_URL);
const suite = config.mysql ? describe : describe.skip;

// Late enough in the day that any westward timezone shift lands on the day
// before — which is the bug exactly, and what makes this the date to use.
const FIXTURE_WA = "tz-regression-fixture";
const FIXTURE_DAY = "2026-03-15";
const FIXTURE_AT = "2026-03-15 23:30:00";

suite("BUG-003: mysql2 must read DATE columns as UTC verbatim (no local-TZ shift)", () => {
  let query;

  beforeAll(async () => {
    ({ query } = await import("../../src/db.js"));
    const { ensureSchema } = await import("../../src/jobs/backfill.js");
    await ensureSchema();
    await query("delete from ads_wati_contacts where wa_id = ?", [FIXTURE_WA]);
    await query(
      "insert into ads_wati_contacts (wa_id, created_date, created_at) values (?, ?, ?)",
      [FIXTURE_WA, FIXTURE_DAY, FIXTURE_AT]);
  });

  afterAll(async () => {
    if (query) {
      await query("delete from ads_wati_contacts where wa_id = ?", [FIXTURE_WA]).catch(() => {});
    }
  });

  it("reads back the calendar day that was written, whatever the host timezone", async () => {
    const [row] = await query(
      `select created_date, date_format(created_at, '%Y-%m-%d') as created_at_calendar_day
       from ads_wati_contacts where wa_id = ?`, [FIXTURE_WA]);

    expect(row, "the fixture row should exist").toBeTruthy();
    // MySQL's own formatting is the reference: it performs no driver conversion.
    expect(row.created_at_calendar_day).toBe(FIXTURE_DAY);
    // The driver's DATE → JS Date conversion has to agree with it. Before the
    // fix this came back as 2026-03-14 on any host west of UTC.
    expect(new Date(row.created_date).toISOString().slice(0, 10)).toBe(FIXTURE_DAY);
  });

  it("agrees with every real row too, where there are any", async () => {
    // The fixture proves the driver option is set. Only the live dataset proves
    // nothing else in the pipeline reintroduced a shift, so this still runs —
    // and reports honestly rather than failing when the database is empty.
    const rows = await query(
      `select wa_id, created_date,
              date_format(created_at, '%Y-%m-%d') as created_at_calendar_day
       from ads_wati_contacts
       where created_at is not null and created_date is not null and wa_id <> ?
       limit 500`, [FIXTURE_WA]);

    const mismatches = rows.filter(
      (r) => new Date(r.created_date).toISOString().slice(0, 10) !== r.created_at_calendar_day
    );
    expect(mismatches).toEqual([]);
  });
});
