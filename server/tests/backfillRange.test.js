// `npm run backfill`, the Settings button and the import the wizard starts at
// the end of installation must all read the same range. They used to disagree:
// the job defaulted message history to OFF regardless of what the operator had
// asked for, which is how an install ends up with contacts and no conversation
// text to score.
import { describe, it, expect, vi, beforeEach } from "vitest";

const watiCalls = [], metaCalls = [];
vi.mock("../src/ingest/ingestWati.js", () => ({
  ingestWati: vi.fn(async (o) => { watiCalls.push(o); return {}; }),
}));
vi.mock("../src/ingest/ingestMeta.js", () => ({
  ingestMeta: vi.fn(async (o) => { metaCalls.push(o); return {}; }),
}));
vi.mock("../src/db.js", () => ({
  runScript: vi.fn(async () => {}),
  query: vi.fn(async () => [{ n: 1 }]),
}));

const config = { meta: { lookbackDays: 120 }, data: { since: "", watiMessages: false } };
vi.mock("../src/config.js", () => ({ default: config }));

const { backfill } = await import("../src/jobs/backfill.js");

beforeEach(() => {
  watiCalls.length = 0; metaCalls.length = 0;
  config.data = { since: "", watiMessages: false };
});

describe("the import follows the configured range", () => {
  it("pulls message history when the operator asked for it", async () => {
    config.data.watiMessages = true;
    await backfill();
    expect(watiCalls[0].messages).toBe(true);
  });

  it("does not when they did not", async () => {
    await backfill();
    expect(watiCalls[0].messages).toBe(false);
  });

  it("lets an explicit argument override it for a one-off catch-up", async () => {
    // `npm run backfill --messages` on an install configured without history.
    await backfill({ messages: true });
    expect(watiCalls[0].messages).toBe(true);

    config.data.watiMessages = true;
    await backfill({ messages: false });
    expect(watiCalls[1].messages).toBe(false);
  });

  it("always asks Meta for the full period", async () => {
    await backfill();
    expect(metaCalls[0]).toEqual({ full: true });
  });
});
