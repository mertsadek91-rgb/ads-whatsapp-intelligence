// A FULL backfill defaults to messages:false (ingestWati's own signature), and
// `npm run backfill` — the documented way to re-sync after a restore — uses it.
// That run cannot know is_answered / num_messages / msg_unavailable, yet it used
// to write all of them anyway, plus a lead_score recomputed from those nulls.
//
// scoreContact's ingest-time branch adds answered(+4) and msgs(+8). Without the
// message facts both vanish, so every already-scored contact silently lost up to
// 12 of 100 points — enough to drop it out of the hot (>=70) or warm (>=45) band,
// emptying the Leads "hot" list and stopping the follow-up emails, with no error.
//
// The fix has two halves, and both are asserted here:
//   - the unknown facts are sent as NULL and COALESCEd, so the stored value stands
//   - the derived score columns are insert-only on a partial run, so an existing
//     row keeps the score computed when the messages WERE known
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
vi.mock("../src/db.js", () => ({
  upsert: vi.fn(async (table, cols, rows, conflictCols, opts) => {
    calls.push({ cols, rows, opts });
    return rows.length;
  }),
}));

vi.mock("../src/lib/wati.js", () => ({
  field: () => undefined,
  parseCreated: () => new Date("2026-01-01T00:00:00Z"),
  toDate: (s) => (s ? new Date(s) : null),
  lastUpdated: () => null,
  // Only ever called on a messages:true run; returns real message facts.
  firstResponse: vi.fn(async () => ({ fr: 12, answered: true, n: 6, last: null, unavailable: true })),
  channelOf: () => null,
  iterContacts: async function* () { yield { id: "c1", phone: "971500000001" }; },
}));

vi.mock("../src/lib/phoneCountry.js", () => ({ countryOf: () => ({ iso2: "AE" }) }));

const { ingestWati, WATI_COLS } = await import("../src/ingest/ingestWati.js");
const at = (row, col) => row[WATI_COLS.indexOf(col)];

beforeEach(() => { calls.length = 0; });

describe("a messages:false backfill must not degrade an already-scored contact", () => {
  it("sends the message-derived facts as NULL so COALESCE keeps the stored value", async () => {
    await ingestWati({ incremental: false, messages: false });
    const { rows, opts } = calls[0];

    // Not fetched this run => must be NULL, not a fabricated value.
    expect(at(rows[0], "is_answered")).toBeNull();
    expect(at(rows[0], "num_messages")).toBeNull();
    expect(at(rows[0], "msg_unavailable")).toBeNull();

    // ...and NULL must mean "keep what's stored".
    for (const c of ["is_answered", "num_messages", "msg_unavailable", "first_response_min", "last_message_at"]) {
      expect(opts.coalesceCols).toContain(c);
    }
  });

  it("never overwrites the stored score on a partial run", async () => {
    await ingestWati({ incremental: false, messages: false });
    const { opts } = calls[0];
    expect(opts.insertOnlyCols).toEqual(
      expect.arrayContaining(["lead_score", "score_band", "score_reasons"]));
  });

  it("still scores a brand-new contact on a partial run rather than leaving it null", async () => {
    await ingestWati({ incremental: false, messages: false });
    const { rows } = calls[0];
    // insert-only means the value is still written when the row does not exist yet,
    // so a new lead is not invisible until the next full sync.
    expect(at(rows[0], "lead_score")).toEqual(expect.any(Number));
    expect(at(rows[0], "score_band")).toBeTruthy();
  });

  it("writes the real facts and refreshes the score when messages ARE fetched", async () => {
    await ingestWati({ incremental: false, messages: true });
    const { rows, opts } = calls[0];
    expect(at(rows[0], "is_answered")).toBe(true);
    expect(at(rows[0], "num_messages")).toBe(6);
    expect(at(rows[0], "msg_unavailable")).toBe(1);
    // A full-information run is allowed to update the score.
    expect(opts.insertOnlyCols).toEqual([]);
  });

  it("the score a full run produces is higher than the partial one it must not overwrite", async () => {
    await ingestWati({ incremental: false, messages: false });
    const partial = at(calls[0].rows[0], "lead_score");
    calls.length = 0;
    await ingestWati({ incremental: false, messages: true });
    const full = at(calls[0].rows[0], "lead_score");
    // This is the whole point: recomputing without messages is a downgrade.
    expect(full).toBeGreaterThan(partial);
  });
});
