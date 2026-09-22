// Every entry module must actually load.
//
// This exists because a syntax error in app.js — the file that wires the whole
// HTTP surface — survived a fully green suite. Two tests do assert things about
// app.js, but both read it with readFileSync and match on the text, so the file
// is never parsed by anything. It was caught by hand, at boot, on a deployment.
//
// Importing a module is the cheapest possible test and the only one that proves
// the file is valid JavaScript, that its own imports resolve, and that nothing
// at module scope throws. None of these modules should do work on import; if
// one ever starts, this will say so by hanging or failing, which is also worth
// knowing.
import { describe, it, expect } from "vitest";

// Deliberately not a glob: this is the list of things that must be loadable for
// the product to start at all, and an explicit list fails when someone moves
// one rather than silently testing nothing.
const ENTRY_MODULES = [
  "../src/app.js",
  "../src/config.js",
  "../src/db.js",
  "../src/lib/appConfig.js",
  "../src/lib/authUsers.js",
  "../src/lib/businessProfile.js",
  "../src/lib/dataRange.js",
  "../src/lib/money.js",
  "../src/lib/phoneCountry.js",
  "../src/lib/setupState.js",
  "../src/lib/tagRules.js",
  "../src/routes/admin.js",
  "../src/routes/settings.js",
  "../src/routes/setup.js",
  "../src/routes/businessProfile.js",
  "../src/jobs/backfill.js",
  "../src/jobs/scheduler.js",
  "../src/ingest/ingestMeta.js",
  "../src/ingest/ingestWati.js",
];

describe("every entry module parses and loads", () => {
  it.each(ENTRY_MODULES)("%s", async (spec) => {
    const mod = await import(spec);
    expect(mod, `${spec} loaded but exported nothing`).toBeTruthy();
  });
});

describe("the express app is assembled at import", () => {
  it("exports something mountable", async () => {
    // app.js builds the express instance at module scope, so a failure here is
    // a failure to boot — not a failure of a route.
    const { app } = await import("../src/app.js");
    expect(typeof app).toBe("function");     // an express app is a function
    expect(typeof app.use).toBe("function");
  });
});
