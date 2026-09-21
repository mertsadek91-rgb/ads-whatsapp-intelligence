// BUG-013 — a contact with no lastUpdated/updatedAt field used to be silently
// SKIPPED on every incremental run (the `!lu` branch), meaning it could never
// be picked up again until the next full backfill. Fixed: missing freshness
// info now means "always include" instead of "always exclude".
import { describe, it, expect, vi } from "vitest";

const flushed = [];
vi.mock("../src/db.js", () => ({
  upsert: vi.fn(async (table, cols, rows) => { flushed.push(...rows); return rows.length; }),
}));

vi.mock("../src/lib/wati.js", () => {
  const contacts = [
    { id: "old", phone: "1", lastUpdated: "2020-01-01T00:00:00Z" }, // stale -> skip
    { id: "fresh", phone: "2", lastUpdated: new Date().toISOString() }, // fresh -> keep
    { id: "unknown", phone: "3" }, // no lastUpdated at all -> must be kept (the fix)
  ];
  return {
    field: () => undefined,
    parseCreated: () => new Date("2026-01-01"),
    toDate: (s) => (s ? new Date(s) : null),
    lastUpdated: (c) => (c.lastUpdated ? new Date(c.lastUpdated) : null),
    firstResponse: vi.fn(async () => ({ fr: null, answered: null, n: 0, last: null, unavailable: false })),
    channelOf: () => null,
    iterContacts: async function* () { for (const c of contacts) yield c; },
  };
});

vi.mock("../src/lib/score.js", () => ({
  normalizeStage: () => "new",
  scoreContact: () => ({ score: 5, band: "cold", reasons: [] }),
}));

const { ingestWati } = await import("../src/ingest/ingestWati.js");

describe("BUG-013: incremental Wati ingest never silently drops a contact with unknown freshness", () => {
  it("keeps unknown-freshness and fresh contacts, correctly skips stale ones", async () => {
    flushed.length = 0;
    const result = await ingestWati({ incremental: true, hours: 24, messages: false });
    const keptIds = flushed.map((r) => r[0]); // wa_id is column 0

    expect(keptIds).toContain("2"); // fresh -> kept
    expect(keptIds).toContain("3"); // unknown freshness -> kept (BUG-013 fix)
    expect(keptIds).not.toContain("1"); // genuinely stale -> still correctly skipped
    expect(result.scanned).toBe(3);
    expect(result.kept).toBe(2);
  });
});
