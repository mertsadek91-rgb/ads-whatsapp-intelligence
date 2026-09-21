// BUG-015 — a contact merged into another wa_id by Wati (isMerged=true) used
// to be ingested as its own separate row anyway, creating a duplicate.
// Defensive fix: skip a contact flagged isMerged before it's ever built into
// a row. (Live data as of 2026-07-03 has isMerged=false for 100% of
// contacts — this guards against the day that changes, not a live repro.)
import { describe, it, expect, vi } from "vitest";

const flushed = [];
vi.mock("../src/db.js", () => ({
  upsert: vi.fn(async (table, cols, rows) => { flushed.push(...rows); return rows.length; }),
}));

vi.mock("../src/lib/wati.js", () => {
  const contacts = [
    { id: "normal", phone: "1", isMerged: false },
    { id: "merged", phone: "2", isMerged: true, mergedIntoContactId: "1" },
  ];
  return {
    field: (c, ...names) => {
      const wanted = names.map((n) => n.toLowerCase());
      for (const [k, v] of Object.entries(c)) if (wanted.includes(k.toLowerCase())) return v;
      return null;
    },
    parseCreated: () => new Date("2026-01-01"),
    toDate: () => null,
    lastUpdated: () => null,
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

describe("BUG-015: a contact flagged isMerged is never ingested as its own row", () => {
  it("skips the merged contact, keeps the normal one", async () => {
    flushed.length = 0;
    const result = await ingestWati({ incremental: false, messages: false });
    const keptIds = flushed.map((r) => r[0]);

    expect(keptIds).toContain("1");
    expect(keptIds).not.toContain("2");
    expect(result.scanned).toBe(2);
    expect(result.kept).toBe(1);
  });
});
