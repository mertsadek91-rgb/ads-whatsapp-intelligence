// Fetching the message thread is one Wati request PER CONTACT — the slowest
// part of an import by a wide margin. The chosen start date is what stops a
// four-year contact list being walked to report on this quarter, so what
// exactly it skips, and what it must NOT skip, is pinned here.
import { describe, it, expect, vi, beforeEach } from "vitest";

const flushed = [];      // [table, cols, rows, keys, opts] per upsert call
vi.mock("../src/db.js", () => ({
  upsert: vi.fn(async (table, cols, rows, keys, opts) => {
    flushed.push({ rows, opts });
    return rows.length;
  }),
}));

const firstResponse = vi.fn(async () => ({ fr: 3, answered: 1, n: 7, last: null, unavailable: false }));
vi.mock("../src/lib/wati.js", () => {
  const contacts = [
    { id: "ancient", phone: "1", created: "2024-05-01T00:00:00Z" },
    { id: "recent", phone: "2", created: "2026-06-01T00:00:00Z" },
    { id: "undated", phone: "3", created: null },
  ];
  return {
    field: () => undefined,
    parseCreated: (c) => (c.created ? new Date(c.created) : null),
    toDate: (s) => (s ? new Date(s) : null),
    lastUpdated: () => null,
    firstResponse,
    channelOf: () => null,
    iterContacts: async function* () { for (const c of contacts) yield c; },
  };
});

vi.mock("../src/lib/score.js", () => ({
  normalizeStage: () => "new",
  scoreContact: () => ({ score: 5, band: "cold", reasons: [] }),
}));

const { ingestWati } = await import("../src/ingest/ingestWati.js");

const phonesFetched = () => firstResponse.mock.calls.map((c) => c[0]);
beforeEach(() => { flushed.length = 0; firstResponse.mockClear(); });

describe("the start date bounds the message fetch, not the contact list", () => {
  it("still stores every contact, however old", async () => {
    // Losing an old contact row would break attribution for ads that are still
    // running — the conversation is old, the lead is not necessarily dead.
    const r = await ingestWati({ messages: true, since: new Date("2026-01-01T00:00:00Z") });
    expect(r.kept).toBe(3);
    expect(flushed.flatMap((f) => f.rows).map((row) => row[0]).sort()).toEqual(["1", "2", "3"]);
  });

  it("reads the thread only for contacts created on or after it", async () => {
    await ingestWati({ messages: true, since: new Date("2026-01-01T00:00:00Z") });
    expect(phonesFetched()).toEqual(["2", "3"]);
  });

  it("includes a contact whose creation date is unknown", async () => {
    // Same safe default as the incremental freshness filter: missing
    // information means "include", never "silently drop".
    await ingestWati({ messages: true, since: new Date("2030-01-01T00:00:00Z") });
    expect(phonesFetched()).toEqual(["3"]);
  });

  it("reads every thread when there is no start date", async () => {
    await ingestWati({ messages: true, since: null });
    expect(phonesFetched()).toEqual(["1", "2", "3"]);
  });

  it("reads no thread at all when message history was not asked for", async () => {
    await ingestWati({ messages: false, since: null });
    expect(phonesFetched()).toEqual([]);
  });
});

describe("the score columns follow each contact, not the run", () => {
  it("protects the stored score for skipped contacts while writing it for fetched ones", async () => {
    // The lead score is DERIVED from the message facts. A contact we skipped
    // has none this run, so overwriting its stored score would corrupt it —
    // the same defect the `messages:false` backfill had, which now has to hold
    // per contact rather than per run because one import does both.
    await ingestWati({ messages: true, since: new Date("2026-01-01T00:00:00Z") });

    const fetched = flushed.find((f) => f.rows.some((r) => r[0] === "2"));
    const skipped = flushed.find((f) => f.rows.some((r) => r[0] === "1"));
    expect(fetched).not.toBe(skipped);                       // flushed separately
    expect(fetched.opts.insertOnlyCols).toEqual([]);         // real facts: write the score
    expect(skipped.opts.insertOnlyCols).toContain("lead_score"); // no facts: keep what is stored
  });
});
