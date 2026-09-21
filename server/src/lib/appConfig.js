// The bridge between the app_config table and the mutable `config` object that
// ~19 modules import synchronously.
//
// The design choice worth stating: there is no `await getConfig()`. Making
// every config read asynchronous would have rippled into every call site and
// every test for no benefit, because configuration changes a handful of times
// in a process's life and is read thousands of times. Instead the object is
// hydrated once at boot and re-hydrated after each save, and modules that
// memoize something derived from it register an onConfigChange listener.
//
// The rule this places on the rest of the codebase: never copy a config value
// into a module-level const at import time.
import { query } from "../db.js";
import config from "../config.js";
import { seal, open, isSealed, mask } from "./secretBox.js";

/**
 * Which keys hold credentials. These are encrypted at rest and never sent back
 * to a browser in full — only masked.
 */
export const SECRET_KEYS = new Set([
  "meta.appSecret", "meta.token",
  "wati.token",
  "deepseek.apiKey",
  "smtp.pass",
]);

/**
 * Keys an admin may set from the UI, with how to coerce the stored string back
 * into the type the config object expects. Anything not listed here is ignored
 * on both read and write, so a stray or malicious row cannot inject arbitrary
 * settings into a running process.
 */
const NUM = (v) => Number(v);
const BOOL = (v) => v === true || v === "1" || v === "true";
const STR = (v) => String(v ?? "");
const CSV_NUMS = (v) => String(v ?? "").split(",").map((n) => Number(n.trim()))
  .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

export const CONFIG_SCHEMA = {
  "appBaseUrl": STR,
  "wati.endpoint": (v) => STR(v).replace(/\/$/, ""),
  "wati.token": (v) => STR(v).replace(/^Bearer\s+/i, ""),
  "meta.appId": STR,
  "meta.appSecret": STR,
  "meta.token": STR,
  "meta.scopes": STR,
  "meta.accountId": (v) => STR(v).replace("act_", ""),
  "meta.lookbackDays": NUM,
  "meta.apiVersion": STR,
  // How far back to import, for both sources at once. "" = everything available.
  "data.since": STR,
  "data.watiMessages": BOOL,
  "deepseek.apiKey": STR,
  "deepseek.baseUrl": (v) => STR(v).replace(/\/$/, ""),
  "deepseek.model": STR,
  "deepseek.inputCostPer1M": NUM,
  "deepseek.outputCostPer1M": NUM,
  "deepseek.dailyBudgetUsd": NUM,
  "smtp.host": STR,
  "smtp.port": NUM,
  "smtp.secure": BOOL,
  "smtp.user": STR,
  "smtp.pass": STR,
  "smtp.from": STR,
  "cronTime": STR,
  "cronTimezone": STR,
  "quickSyncCron": STR,
  "quickSyncAnalyzeCap": NUM,
  "weeklyReportDow": NUM,
  "autoAnalyzeCap": NUM,
  "nightlyAnalyzeCap": NUM,
  "workHours.start": NUM,
  "workHours.end": NUM,
  "workHours.offDays": CSV_NUMS,
};

const listeners = [];
/** Called after every hydrate, for modules that memoize something derived. */
export function onConfigChange(fn) { listeners.push(fn); return () => {
  const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1);
}; }

function setDeep(obj, path, value) {
  const parts = path.split(".");
  let node = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof node[p] !== "object" || node[p] === null) node[p] = {};
    node = node[p];
  }
  node[parts.at(-1)] = value;
}

export function getDeep(obj, path) {
  return path.split(".").reduce((n, p) => (n == null ? undefined : n[p]), obj);
}

/**
 * Read app_config over the top of whatever the environment supplied.
 * A single unreadable row must not take the app down, so a value that fails to
 * decrypt is skipped loudly rather than thrown — the env/default value stands.
 */
export async function hydrate() {
  let rows = [];
  try {
    rows = await query("select k, v, is_secret from app_config");
  } catch (e) {
    // Table not created yet (first boot, before ensureSchema) — the env
    // defaults are correct at this point, so this is not an error.
    if (!/doesn't exist|ER_NO_SUCH_TABLE/i.test(e.message)) throw e;
    return { applied: 0, skipped: 0 };
  }
  let applied = 0, skipped = 0;
  for (const { k, v, is_secret } of rows) {
    const coerce = CONFIG_SCHEMA[k];
    if (!coerce) { skipped++; continue; }         // unknown key: ignore, never eval
    try {
      setDeep(config, k, coerce(is_secret ? open(v) : v));
      applied++;
    } catch (e) {
      skipped++;
      console.error(`[config] could not apply "${k}": ${e.message} — keeping the previous value`);
    }
  }
  for (const fn of listeners) {
    try { fn(config); } catch (e) { console.error("[config] listener failed:", e.message); }
  }
  return { applied, skipped };
}

/**
 * Persist a patch of { "dotted.key": value } and re-hydrate, so the change
 * takes effect in this process immediately — no restart.
 */
export async function saveConfig(patch, { updatedBy = null } = {}) {
  const entries = Object.entries(patch || {}).filter(([k]) => CONFIG_SCHEMA[k]);
  for (const [k, raw] of entries) {
    const isSecret = SECRET_KEYS.has(k);
    const value = isSecret ? seal(String(raw ?? "")) : String(raw ?? "");
    await query(
      `insert into app_config (k, v, is_secret, updated_by) values (?, ?, ?, ?)
       as new on duplicate key update v=new.v, is_secret=new.is_secret, updated_by=new.updated_by`,
      [k, value, isSecret ? 1 : 0, updatedBy]);
  }
  await hydrate();
  return { saved: entries.length };
}

/** Current values for the UI. Secrets are masked, never returned in full. */
export function describeConfig() {
  const out = {};
  for (const k of Object.keys(CONFIG_SCHEMA)) {
    const v = getDeep(config, k);
    out[k] = SECRET_KEYS.has(k) ? mask(v) : v;
  }
  return out;
}

export default { hydrate, saveConfig, onConfigChange, describeConfig, CONFIG_SCHEMA, SECRET_KEYS, getDeep };
