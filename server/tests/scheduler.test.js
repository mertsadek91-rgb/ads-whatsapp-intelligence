// BUG-028 — the cron scheduler's overlap guard was a plain in-memory boolean,
// which only protects a single process. withLeaderLock() adds an atomic
// MySQL GET_LOCK() claim so a future multi-replica deployment can't run the
// same cron tick twice concurrently. Not an active risk today (single
// instance, no replicas configured) — this is opportunistic hardening.
import { describe, it, expect, vi, beforeEach } from "vitest";

const conn = {
  query: vi.fn(),
  release: vi.fn(),
};
vi.mock("../src/db.js", () => ({ pool: () => ({ getConnection: async () => conn }) }));
vi.mock("../src/jobs/runDaily.js", () => ({ runDaily: vi.fn() }));

const { withLeaderLock } = await import("../src/jobs/scheduler.js");

beforeEach(() => { conn.query.mockReset(); conn.release.mockReset(); });

describe("BUG-028: withLeaderLock only runs fn when the DB lock is actually acquired", () => {
  it("runs fn and releases the lock when GET_LOCK succeeds", async () => {
    conn.query.mockResolvedValueOnce([[{ got: 1 }]]).mockResolvedValueOnce([[]]); // get_lock, release_lock
    const fn = vi.fn(async () => {});

    await withLeaderLock("test-lock", fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(conn.query.mock.calls[0][0]).toMatch(/get_lock/);
    expect(conn.query.mock.calls[1][0]).toMatch(/release_lock/);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("skips fn entirely when another instance already holds the lock", async () => {
    conn.query.mockResolvedValueOnce([[{ got: 0 }]]);
    const fn = vi.fn(async () => {});

    await withLeaderLock("test-lock", fn);

    expect(fn).not.toHaveBeenCalled();
    expect(conn.query).toHaveBeenCalledTimes(1); // only the get_lock attempt, no release
    expect(conn.release).toHaveBeenCalledTimes(1); // connection always returned to the pool
  });

  it("still releases the lock and the connection if fn throws", async () => {
    conn.query.mockResolvedValueOnce([[{ got: 1 }]]).mockResolvedValueOnce([[]]);
    const fn = vi.fn(async () => { throw new Error("boom"); });

    await expect(withLeaderLock("test-lock", fn)).rejects.toThrow("boom");

    expect(conn.query.mock.calls[1][0]).toMatch(/release_lock/);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});
