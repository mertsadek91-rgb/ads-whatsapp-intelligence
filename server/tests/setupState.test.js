// setup.json holds what has to exist before a database does: the database
// credentials themselves, the session secret, and the key that encrypts
// everything else. It is the answer to the wizard's chicken-and-egg problem.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isStrongSecret } from "../src/config.js";
import * as state from "../src/lib/setupState.js";

let dir;
const envBefore = { DATA_DIR: process.env.DATA_DIR, SESSION_SECRET: process.env.SESSION_SECRET, APP_SECRET_KEY: process.env.APP_SECRET_KEY };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "setupstate-"));
  process.env.DATA_DIR = dir;
  delete process.env.SESSION_SECRET;
  delete process.env.APP_SECRET_KEY;
  state._resetCache();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(envBefore)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  state._resetCache();
});

describe("state file", () => {
  it("reads sane defaults when the file does not exist yet", () => {
    const s = state.readState();
    expect(s.installed).toBe(false);
    expect(s.mysql).toBeNull();
    expect(s.completedSteps).toEqual([]);
  });

  it("persists a patch and survives losing the in-process cache", () => {
    state.writeState({ completedSteps: ["db"], mysql: { host: "h", database: "d" } });
    state._resetCache();
    const s = state.readState();
    expect(s.completedSteps).toEqual(["db"]);
    expect(s.mysql.host).toBe("h");
  });

  it("merges rather than replacing, so one step does not wipe another", () => {
    state.writeState({ completedSteps: ["db"] });
    state.writeState({ installToken: "abc" });
    const s = state.readState({ reload: true });
    expect(s.completedSteps).toEqual(["db"]);
    expect(s.installToken).toBe("abc");
  });

  it("leaves no temp file behind (the write is atomic)", () => {
    state.writeState({ installed: true });
    expect(fs.readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
    expect(fs.existsSync(state.statePath())).toBe(true);
  });

  it("survives a corrupt file instead of crashing the boot", () => {
    fs.writeFileSync(state.statePath(), "{ not json");
    state._resetCache();
    expect(state.readState().installed).toBe(false);
  });

  it("reads a file written with a UTF-8 BOM", () => {
    // Every Windows tool that touches this file writes one — PowerShell's
    // Set-Content among them — and JSON.parse rejects it outright. Without this
    // a stray byte made a configured install look like a fresh one.
    state.writeState({ completedSteps: ["db", "meta"], mysql: { host: "h", database: "d" } });
    const json = fs.readFileSync(state.statePath(), "utf8");
    fs.writeFileSync(state.statePath(), "﻿" + json, "utf8");
    state._resetCache();
    const s = state.readState();
    expect(s.completedSteps).toEqual(["db", "meta"]);
    expect(s.mysql.host).toBe("h");
  });

  it("keeps a copy of an unreadable file rather than quietly replacing it", () => {
    // Falling back to defaults silently meant the NEXT write overwrote a working
    // install's credentials and progress with nothing, and said nothing about it.
    state.writeState({ completedSteps: ["db", "meta", "wati"] });
    fs.writeFileSync(state.statePath(), "{ truncated");
    state._resetCache();
    expect(state.readState().completedSteps).toEqual([]);   // continues, does not crash
    const kept = fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"));
    expect(kept.length, "the unreadable file must be preserved").toBe(1);
    expect(fs.readFileSync(path.join(dir, kept[0]), "utf8")).toContain("truncated");
  });
});

describe("ensureSessionSecret", () => {
  it("generates and persists a strong secret when nothing is set", () => {
    const s = state.ensureSessionSecret({ isStrongSecret });
    expect(isStrongSecret(s)).toBe(true);
    state._resetCache();
    expect(state.ensureSessionSecret({ isStrongSecret })).toBe(s); // stable across restarts
  });

  it("prefers an explicitly-set environment value", () => {
    process.env.SESSION_SECRET = "z".repeat(40);
    expect(state.ensureSessionSecret({ isStrongSecret })).toBe("z".repeat(40));
  });

  it("still refuses a placeholder the operator set on purpose", () => {
    // Removing the fatal exit must not mean accepting a known-bad value: if you
    // set it yourself, a placeholder is a mistake worth stopping for.
    process.env.SESSION_SECRET = "change-me";
    expect(() => state.ensureSessionSecret({ isStrongSecret })).toThrow(/placeholder|32/);
  });

  it("refuses an environment value that is merely too short", () => {
    process.env.SESSION_SECRET = "short";
    expect(() => state.ensureSessionSecret({ isStrongSecret })).toThrow();
  });
});

describe("ensureSecretKey", () => {
  it("generates a persistent 256-bit key", () => {
    const k = state.ensureSecretKey();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    state._resetCache();
    expect(state.ensureSecretKey()).toBe(k);
  });

  it("prefers the environment, so the key can live outside the container", () => {
    process.env.APP_SECRET_KEY = "c".repeat(64);
    expect(state.ensureSecretKey()).toBe("c".repeat(64));
  });
});
