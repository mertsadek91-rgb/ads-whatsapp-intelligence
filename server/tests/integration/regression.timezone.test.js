// BUG-003 regression guard (integration — hits the real DB via APP/.env).
// The mysql2 pool had no `timezone` option, so it defaulted to the process's
// local OS timezone when converting DATE/DATETIME columns to JS Date on read
// — shifting every stored date back by one day on every single read, even
// though the underlying stored data was always correct (proven by
// scripts/audit-timezone.js: write-time mismatch = 0, driver-read mismatch =
// 100% before the fix, 0% after). Fixed by pinning `timezone: 'Z'` in db.js.
import { describe, it, expect } from "vitest";
import { query } from "../../src/db.js";

describe("BUG-003: mysql2 must read DATE columns as UTC verbatim (no local-TZ shift)", () => {
  it("created_date (driver-read) matches created_at's raw calendar day (MySQL-side, no driver reinterpretation) for every contact", async () => {
    const rows = await query(
      `select wa_id, created_date,
              date_format(created_at, '%Y-%m-%d') as created_at_calendar_day
       from ads_wati_contacts
       where created_at is not null and created_date is not null
       limit 500`
    );
    expect(rows.length).toBeGreaterThan(0);
    const mismatches = rows.filter(
      (r) => new Date(r.created_date).toISOString().slice(0, 10) !== r.created_at_calendar_day
    );
    expect(mismatches).toEqual([]);
  });
});
