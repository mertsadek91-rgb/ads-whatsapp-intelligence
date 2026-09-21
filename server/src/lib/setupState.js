// State that has to exist BEFORE a database does.
//
// The setup wizard collects the database credentials, so it cannot store them
// in the database. It also cannot write the operator's environment from a
// browser, and it must survive a crash halfway through the wizard — which
// rules out memory. So: one small JSON file, written atomically with
// restrictive permissions.
//
// DATA_DIR overrides the location, which is how this is mounted as a Docker
// volume so an install survives a container rebuild.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function dataDir() {
  return process.env.DATA_DIR || path.resolve(__dirname, "../../data");
}
export function statePath() {
  return path.join(dataDir(), "setup.json");
}

const DEFAULTS = {
  version: 1,
  installed: false,
  installedAt: null,
  installToken: null,
  claim: null,
  completedSteps: [],
  mysql: null,
  sessionSecret: null,
  secretKey: null,
};

let cache = null;

export function readState({ reload = false } = {}) {
  if (cache && !reload) return cache;
  let raw;
  try {
    raw = fs.readFileSync(statePath(), "utf8");
  } catch {
    cache = { ...DEFAULTS };          // no file yet: a genuinely fresh install
    return cache;
  }
  try {
    // Strip a UTF-8 BOM. Any Windows tool that touches this file — PowerShell's
    // Set-Content among them — writes one, and JSON.parse rejects it outright.
    cache = { ...DEFAULTS, ...JSON.parse(raw.replace(/^﻿/, "")) };
  } catch (e) {
    // A file we cannot read is NOT the same as no file. Silently falling back to
    // defaults meant the next write replaced a working install's database
    // credentials and completed steps with nothing — an install lost to a stray
    // byte, with no message. Keep the original so it can be recovered, and say
    // so loudly instead of pretending this is a first run.
    const backup = `${statePath()}.corrupt-${Date.now()}`;
    try { fs.copyFileSync(statePath(), backup); } catch { /* best effort */ }
    console.error(
      `[setup] ${statePath()} could not be parsed (${e.message}).\n` +
      `        Your previous answers are NOT lost — the original is at:\n` +
      `        ${backup}\n` +
      "        Continuing as a fresh install.");
    cache = { ...DEFAULTS };
  }
  return cache;
}

/**
 * Atomic write: a crash mid-write must not leave a half-written file holding
 * the only copy of the database password. Mode 0600 because this file holds
 * credentials in plaintext — on Windows the mode is advisory, which is why the
 * secrets in app_config are additionally encrypted.
 */
export function writeState(patch) {
  const next = { ...readState(), ...patch };
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.setup.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, statePath());
  try { fs.chmodSync(statePath(), 0o600); } catch { /* best effort on Windows */ }
  cache = next;
  return next;
}

export const isInstalled = () => readState().installed === true;

/** Test hook — drops the in-process cache. */
export function _resetCache() { cache = null; }

/**
 * Produce a session secret without ever hard-exiting.
 *
 * config.js used to call process.exit(1) at import time when SESSION_SECRET was
 * missing or weak. That made a fresh clone unbootable, made the test suite
 * depend on a developer happening to have a .env on disk, and — worst — pushed
 * operators toward pasting the example value to get past it. A wizard that
 * generates a strong secret is strictly safer than a fatal error that
 * encourages a weak one.
 *
 * An explicitly-set environment value is still validated strictly: if you set
 * it, a placeholder is a mistake worth stopping for.
 */
export function ensureSessionSecret({ isStrongSecret }) {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) {
    if (!isStrongSecret(fromEnv)) {
      throw new Error(
        "SESSION_SECRET is set but is a placeholder or shorter than 32 characters. " +
        "An insecure value here makes every session forgeable. Generate one with:\n" +
        `  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`);
    }
    return fromEnv;
  }
  const saved = readState().sessionSecret;
  if (saved && isStrongSecret(saved)) return saved;
  const generated = crypto.randomBytes(48).toString("hex");
  writeState({ sessionSecret: generated });
  return generated;
}

/** The AES key protecting credentials in app_config. Generated once, persisted. */
export function ensureSecretKey() {
  const fromEnv = process.env.APP_SECRET_KEY;
  if (fromEnv) return fromEnv;
  const saved = readState().secretKey;
  if (saved) return saved;
  const generated = crypto.randomBytes(32).toString("hex");
  writeState({ secretKey: generated });
  return generated;
}

export default {
  dataDir, statePath, readState, writeState, isInstalled,
  ensureSessionSecret, ensureSecretKey, _resetCache,
};
