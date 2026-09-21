// Letting steps be deferred is only safe if two things hold: nothing essential
// can be deferred, and nothing deferred is forgotten. These pin both.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as state from "../src/lib/setupState.js";
import { STEPS, REQUIRED_STEPS, SKIPPABLE } from "../src/routes/setup.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "skip-"));
  process.env.DATA_DIR = dir;
  state._resetCache();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  state._resetCache();
});

describe("what may be deferred", () => {
  it("keeps the database and the admin account mandatory", () => {
    // Somewhere to put the data, and someone who can log in. Everything else is
    // a connection that can be made later from Settings.
    expect(REQUIRED_STEPS).toEqual(["db", "finish"]);
  });

  it("allows every integration to be deferred", () => {
    expect(SKIPPABLE).toEqual(["meta", "wati", "ai", "business"]);
  });

  it("covers every step exactly once between the two lists", () => {
    expect([...REQUIRED_STEPS, ...SKIPPABLE].sort()).toEqual([...STEPS].sort());
  });
});

describe("skipping is recorded separately from completing", () => {
  it("remembers a skip across a restart", () => {
    state.writeState({ skippedSteps: ["meta", "ai"] });
    state._resetCache();
    expect(state.readState().skippedSteps).toEqual(["meta", "ai"]);
  });

  it("starts with nothing skipped", () => {
    expect(state.readState().skippedSteps).toEqual([]);
  });
});

describe("the post-install checklist", () => {
  // Read from LIVE configuration, never from what the wizard recorded: an
  // operator who skips Meta and connects it a week later from Settings must see
  // the item disappear on its own.
  const load = async (over = {}) => {
    vi.resetModules();
    vi.doMock("../src/config.js", () => ({
      default: {
        meta: { accountId: "", token: "", appId: "" },
        wati: { endpoint: "", token: "" },
        deepseek: { apiKey: "" },
        smtp: { host: "", user: "", pass: "" },
        ...over.config,
      },
    }));
    vi.doMock("../src/lib/profileStore.js", () => ({
      getMeta: () => over.profile || { source: "seed", version: 0 },
    }));
    vi.doMock("../src/lib/mailer.js", () => ({ isConfigured: () => !!over.smtp }));
    return import("../src/lib/onboarding.js");
  };

  it("lists everything unconfigured on a bare install", async () => {
    const { onboardingStatus } = await load();
    const s = onboardingStatus();
    expect(s.pending).toBe(5);
    expect(s.items.map((i) => i.key)).toEqual(["meta", "wati", "ai", "business", "smtp"]);
  });

  it("nothing in it blocks the app from running", async () => {
    // That is the whole premise of allowing the skip — so the panel can be
    // presented as a to-do rather than an error.
    const { onboardingStatus } = await load();
    expect(onboardingStatus().blocking).toBe(0);
  });

  it("marks an integration done once it is actually configured", async () => {
    const { onboardingStatus } = await load({
      config: { meta: { accountId: "123", token: "t", appId: "a" } } });
    const meta = onboardingStatus().items.find((i) => i.key === "meta");
    expect(meta.done).toBe(true);
  });

  it("counts the generic seed profile as NOT having defined the business", async () => {
    // The app runs on the seed, but it is judging conversations by general
    // rules rather than this industry's — which is exactly what the operator
    // needs reminding of.
    const seed = await load({ profile: { source: "seed", version: 0 } });
    expect(seed.onboardingStatus().items.find((i) => i.key === "business").done).toBe(false);

    const real = await load({ profile: { source: "ai", version: 3 } });
    expect(real.onboardingStatus().items.find((i) => i.key === "business").done).toBe(true);
  });

  it("says what each missing piece costs, not merely that it is missing", async () => {
    // "Meta is not configured" is a fact; "you have no spend or cost-per-lead"
    // is the reason someone would act on it.
    const { onboardingItems } = await load();
    for (const i of onboardingItems()) {
      expect(i.why_ar, `${i.key} needs an Arabic reason`).toBeTruthy();
      expect(i.why_en, `${i.key} needs an English reason`).toBeTruthy();
      expect(i.href, `${i.key} needs somewhere to go`).toMatch(/^\//);
    }
  });
});
