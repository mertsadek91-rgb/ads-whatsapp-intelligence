// BUG-012 — sync/analyze job status lived in a plain module-level variable,
// so a server restart mid-run silently reset it to "idle" instead of
// surfacing that the job never finished. Covers the persistence round trip
// and the restart-correction rule.
import { describe, it, expect, vi } from "vitest";

const table = new Map();
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    if (sql.startsWith("select state_json")) {
      const raw = table.get(params[0]);
      return raw ? [{ state_json: raw }] : [];
    }
    if (sql.startsWith("insert into ads_job_state")) {
      table.set(params[0], params[1]);
      return {};
    }
    throw new Error("unexpected query: " + sql);
  }),
}));

const { loadJobState, saveJobState, correctInterrupted } = await import("../src/lib/jobState.js");

describe("jobState persistence", () => {
  it("round-trips a job state through save/load", async () => {
    await saveJobState("conv:sync", { state: "running", total: 10, done: 3 });
    const loaded = await loadJobState("conv:sync");
    expect(loaded).toEqual({ state: "running", total: 10, done: 3 });
  });

  it("returns null for a job that has never been saved", async () => {
    expect(await loadJobState("admin:never-run")).toBeNull();
  });

  it("overwrites the previous state on repeated saves (not accumulating)", async () => {
    await saveJobState("admin:wati", { state: "running" });
    await saveJobState("admin:wati", { state: "done", result: { added: 5 } });
    expect(await loadJobState("admin:wati")).toEqual({ state: "done", result: { added: 5 } });
  });
});

describe("correctInterrupted", () => {
  it("flips a stale 'running' state to 'error' (a restart definitely interrupted it)", () => {
    const corrected = correctInterrupted({ state: "running", total: 100, done: 40, startedAt: 1000 });
    expect(corrected.state).toBe("error");
    expect(corrected.error).toBeTruthy();
    expect(corrected.done).toBe(40); // progress info is preserved, not wiped
  });

  it("leaves a completed job's state untouched", () => {
    const done = { state: "done", result: { added: 5 } };
    expect(correctInterrupted(done)).toEqual(done);
  });

  it("passes through null/undefined without throwing", () => {
    expect(correctInterrupted(null)).toBeNull();
    expect(correctInterrupted(undefined)).toBeUndefined();
  });
});
