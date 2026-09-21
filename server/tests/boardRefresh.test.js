// The emergency board refresh. Its value is not that it runs — the 30-minute tick
// already runs — but that it re-reads EVERY conversation in the window and then
// says what changed. A refresh that cannot distinguish "found three missed
// replies" from "the board was already right" settles no argument.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { ids: [], leadsBefore: [], leadsAfter: [], syncCalls: [], syncFails: new Set(), partial: new Set() };

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql) => {
    if (sql.includes("from ads_wati_contacts") && sql.includes("num_messages > 0")) {
      return state.ids.map((wa_id) => ({ wa_id }));
    }
    return {};
  }),
}));
vi.mock("../src/ingest/ingestWati.js", () => ({ ingestWati: vi.fn(async () => ({ scanned: 100, kept: 7 })) }));
vi.mock("../src/lib/weeklyReports.js", () => ({ dubaiYmd: () => "2026-08-04" }));
vi.mock("../src/lib/conversationMeta.js", () => ({
  syncOne: vi.fn(async (id) => {
    state.syncCalls.push(id);
    if (state.syncFails.has(id)) throw new Error("wati down");
    return state.partial.has(id) ? { partial: true } : { wa_id: id };
  }),
}));

let phase = 0;
vi.mock("../src/lib/contactStatus.js", () => ({
  gatherContactStatus: vi.fn(async () => ({ leads: phase++ === 0 ? state.leadsBefore : state.leadsAfter })),
  snapshotContactStatus: vi.fn(async () => ({ snapshotted: 5 })),
}));

const { refreshBoards, isBoardRefreshing } = await import("../src/jobs/boardRefresh.js");

const lead = (wa_id, contacted) => ({ wa_id, contacted, status: "x" });

beforeEach(() => {
  phase = 0;
  state.ids = []; state.leadsBefore = []; state.leadsAfter = [];
  state.syncCalls = []; state.syncFails = new Set(); state.partial = new Set();
});

describe("refreshBoards", () => {
  it("re-reads every conversation in the window, uncapped", async () => {
    // The whole reason this exists: quickSync stops at 600, this does not.
    state.ids = Array.from({ length: 750 }, (_, i) => `w${i}`);
    const r = await refreshBoards({ days: 7 });
    expect(state.syncCalls.length).toBe(750);
    expect(r.conversations_reread).toBe(750);
  });

  it("reports the leads that flipped to contacted, with their ids", async () => {
    state.ids = ["a", "b", "c"];
    state.leadsBefore = [lead("a", true), lead("b", false), lead("c", false)];
    state.leadsAfter = [lead("a", true), lead("b", true), lead("c", false)];
    const r = await refreshBoards({ days: 7 });
    expect(r.before.contacted).toBe(1);
    expect(r.after.contacted).toBe(2);
    expect(r.flipped_to_contacted).toBe(1);
    expect(r.flipped_ids).toEqual(["b"]);
  });

  it("says plainly that nothing changed when nothing changed", async () => {
    // The answer the owner actually got on live data: the board was already right.
    state.ids = ["a", "b"];
    state.leadsBefore = [lead("a", true), lead("b", false)];
    state.leadsAfter = [lead("a", true), lead("b", false)];
    const r = await refreshBoards({ days: 7 });
    expect(r.flipped_to_contacted).toBe(0);
    expect(r.flipped_ids).toEqual([]);
  });

  it("does not count a failed Wati fetch as a fresh read", async () => {
    // syncOne returns partial:true and keeps the stored row — counting that as
    // re-read would tell the owner the board is current when it is not.
    state.ids = ["ok1", "bad", "stale"];
    state.syncFails.add("bad");
    state.partial.add("stale");
    const r = await refreshBoards({ days: 7 });
    expect(r.conversations_reread).toBe(1);
    expect(r.reread_failed).toBe(2);
  });

  it("keeps going when the Wati contact pull fails", async () => {
    // A dead contact-list endpoint must not stop the conversation re-read, which
    // is the part that actually goes stale.
    const { ingestWati } = await import("../src/ingest/ingestWati.js");
    ingestWati.mockRejectedValueOnce(new Error("429 rate limited"));
    state.ids = ["a", "b"];
    const r = await refreshBoards({ days: 7 });
    expect(r.stages.wati).toContain("ERR");
    expect(r.errors.join()).toContain("429");
    expect(r.conversations_reread).toBe(2);
  });

  it("refuses to run twice at once", async () => {
    state.ids = Array.from({ length: 40 }, (_, i) => `w${i}`);
    const first = refreshBoards({ days: 7 });
    expect(isBoardRefreshing()).toBe(true);
    const second = await refreshBoards({ days: 7 });
    expect(second).toEqual({ skipped: true, reason: "already_running" });
    await first;
    expect(isBoardRefreshing()).toBe(false);
  });

  it("clamps the window to something sane", async () => {
    state.ids = [];
    expect((await refreshBoards({ days: 999 })).window.since).toBe("2026-05-07"); // 90-day cap
    phase = 0;
    expect((await refreshBoards({ days: 1 })).window).toEqual({ since: "2026-08-04", until: "2026-08-04" });
  });
});
