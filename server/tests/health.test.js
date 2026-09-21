// BUG-044 — GET /api/health used to report {ok:true} whenever the Node
// process was merely alive, even with a dead MySQL connection, making the
// planned Docker HEALTHCHECK meaningless for a DB-backed app. Fixed: the
// route now runs a trivial query (healthCheck() in lib/health.js) and
// reports 503 if that fails.
import { describe, it, expect, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("../src/db.js", () => ({ query: (...args) => mockQuery(...args) }));

const { healthCheck } = await import("../src/lib/health.js");

describe("BUG-044: healthCheck() reflects real DB connectivity", () => {
  it("resolves {ok:true} when the DB responds", async () => {
    mockQuery.mockResolvedValueOnce([{ 1: 1 }]);
    await expect(healthCheck()).resolves.toEqual({ ok: true });
  });

  it("resolves {ok:false, error} instead of throwing when the DB is unreachable", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const result = await healthCheck();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });
});
