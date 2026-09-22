// Where a long import has got to.
//
// A full import walks a whole Wati account and then several Meta windows — tens
// of minutes on a real account. All an operator could see was a spinner: no
// stage, no counts, no way to tell "working" from "stuck", and nothing to base
// "should I wait?" on.
import { describe, it, expect, beforeEach } from "vitest";
import * as P from "../src/lib/jobProgress.js";

beforeEach(() => P.finish());

describe("reporting where an import has got to", () => {
  it("declares every stage up front, so the UI can say 3 of 5 from the first tick", () => {
    // Counting up from an unknown total tells the operator nothing about how
    // much is left, which is the actual question.
    const r = P.begin("wati");
    r.stage("wati_contacts");
    const s = P.snapshot();
    expect(s.stages).toHaveLength(P.IMPORT_STAGES.length);
    expect(s.stageIndex).toBe(1);
    expect(s.stages[1].state).toBe("running");
  });

  it("counts within a stage, and tolerates a source that cannot say the total", () => {
    // Wati's contact list has no count endpoint and no total in the page
    // envelope. A running tally is honest; a fabricated denominator is not.
    const r = P.begin("wati");
    r.stage("wati_contacts", { total: null });
    r.tick(240, { detail: "120 conversations" });
    const s = P.snapshot();
    expect(s.done).toBe(240);
    expect(s.total).toBeNull();
    expect(s.detail).toBe("120 conversations");
  });

  it("marks earlier stages done, and the ones that never ran as skipped", () => {
    // A meta-only run should not leave the WhatsApp stages looking pending
    // forever, which reads as "stuck at step 2".
    const r = P.begin("wati");
    r.stage("schema");
    r.stageDone();
    r.stage("meta_ads");
    const s = P.snapshot();
    expect(s.stages.find((x) => x.key === "schema").state).toBe("done");
    expect(s.stages.find((x) => x.key === "wati_contacts").state).toBe("skipped");
    expect(s.stages.find((x) => x.key === "meta_ads").state).toBe("running");
  });

  it("reports nothing at all when nothing is running", () => {
    expect(P.snapshot()).toBeNull();
    P.begin("wati");
    expect(P.snapshot()).not.toBeNull();
    P.finish();
    expect(P.snapshot()).toBeNull();
  });

  it("hands out a reporter that is safe to call after the job ended", () => {
    // The ingests hold the reporter across awaits; a late tick from a job that
    // has already finished must not resurrect a stale snapshot.
    const r = P.begin("wati");
    r.stage("wati_contacts");
    P.finish();
    expect(() => { r.tick(5); r.stageDone(); r.stage("meta_ads"); }).not.toThrow();
    expect(P.snapshot()).toBeNull();
  });

  it("never lets a broken listener break the import", () => {
    P.onProgress(() => { throw new Error("listener is broken"); });
    const r = P.begin("wati");
    expect(() => r.tick(1)).not.toThrow();
  });

  it("offers a do-nothing reporter, so a cron run needs no special case", () => {
    expect(() => {
      P.NO_PROGRESS.stage("wati_contacts");
      P.NO_PROGRESS.tick(10);
      P.NO_PROGRESS.stageDone();
    }).not.toThrow();
  });
});
