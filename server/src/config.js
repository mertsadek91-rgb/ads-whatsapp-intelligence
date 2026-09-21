// Runtime configuration.
//
// This object is DELIBERATELY MUTABLE and is the single thing ~19 modules
// import. Values start as the environment's (or a built-in default), and
// lib/appConfig.js hydrates database-backed overrides over the top at boot and
// again after every save from the setup wizard or the Settings page.
//
// That is what makes a browser-driven wizard possible without a restart: call
// sites keep reading `config.wati.token` synchronously and simply see the new
// value. The one rule this imposes on the rest of the codebase is that no
// module may copy a config value into a module-level `const` at import time,
// because that snapshot would never update. (meta.js, wati.js, metaAuth.js and
// ingestMeta.js all used to do exactly that; they now read through a function.)
//
// Precedence, highest first:
//   1. Infrastructure env vars — PORT, APP_BASE_URL, NODE_ENV, TRUST_PROXY_HOPS,
//      DATA_DIR, APP_SECRET_KEY. Owned by whoever deploys the container.
//   2. MYSQL_URL / SESSION_SECRET from the environment when set, otherwise from
//      setup.json (written by the wizard, which runs before any database
//      exists). An operator who sets these keeps full control.
//   3. Everything else: the environment provides the starting value, and
//      app_config overrides it once an admin saves something in the UI. An
//      existing .env-only install therefore behaves exactly as before until
//      someone changes something in the browser.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo-root .env (two levels up from server/src), optional.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/**
 * Parse mysql://user:pass@host:port/db. Returns null — not a fabricated
 * localhost default — when there is no URL to parse. A fresh install genuinely
 * has no database yet, and inventing `root@127.0.0.1/default` only turns that
 * into a confusing connection error instead of "not configured yet".
 */
export function parseMysqlUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: (u.pathname || "/").replace(/^\//, "") || "",
    };
  } catch {
    return null;
  }
}

// Placeholders that must never be accepted as a real session secret. Kept
// generic: the previous list named one company's own strings, which told a new
// installer nothing and protected them from nothing.
export const PLACEHOLDER_SECRETS = new Set([
  "", "change-me", "change-me-please", "changeme", "secret", "password",
  "please-change-this-to-a-long-random-string",
  "change-me-to-a-long-random-string",
]);

export const MIN_SECRET_LEN = 32;

/** True when the value is a real secret rather than a placeholder or a stub. */
export function isStrongSecret(v) {
  const s = String(v || "");
  return s.length >= MIN_SECRET_LEN && !PLACEHOLDER_SECRETS.has(s);
}

const E = process.env;
const num = (v, d) => (v == null || v === "" ? d : Number(v));

export const config = {
  port: num(E.PORT, 3000),
  // null until configured. db.js reports "not configured" rather than dialling
  // a made-up host, and the setup wizard fills this in.
  mysql: parseMysqlUrl(E.MYSQL_URL),
  wati: {
    endpoint: (E.WATI_API_ENDPOINT || "").replace(/\/$/, ""),
    token: (E.WATI_ACCESS_TOKEN || "").replace(/^Bearer\s+/i, ""),
    // Multiple connected WhatsApp numbers share one token; getMessages is told
    // which number via ?channelPhoneNumber=<number>, derived per contact from
    // its whatsapp_<number> param, so no second token/endpoint is needed.
  },
  appBaseUrl: (E.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  meta: {
    token: E.META_ACCESS_TOKEN || "",   // optional seed; the live token lives in the DB
    appId: E.META_APP_ID || "",
    appSecret: E.META_APP_SECRET || "",
    scopes: E.META_SCOPES || "ads_read,business_management",
    // No default. A hardcoded account id meant a fresh install with no env var
    // silently issued Graph API calls against somebody else's ad account.
    accountId: (E.META_AD_ACCOUNT_ID || "").replace("act_", ""),
    lookbackDays: num(E.META_LOOKBACK_DAYS, 120),
    apiVersion: E.META_API_VERSION || "v21.0",
    // Earliest date the analytics tables cover. Empty = decided at install.
    periodSince: E.PERIOD_SINCE || "",
  },
  deepseek: {
    apiKey: E.DEEPSEEK_API_KEY || "",
    baseUrl: (E.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    model: E.DEEPSEEK_MODEL || "deepseek-v4-flash",
    // Cost estimates only — they exist so ads_ai_runs carries an approximate
    // figure, not an invoice match. Verify against current pricing.
    inputCostPer1M: num(E.DEEPSEEK_INPUT_COST_PER_1M, 0.28),
    outputCostPer1M: num(E.DEEPSEEK_OUTPUT_COST_PER_1M, 1.10),
    dailyBudgetUsd: num(E.DEEPSEEK_DAILY_BUDGET_USD, 10),
  },
  auth: {
    // Filled by the bootstrap layer when absent: either from setup.json or
    // freshly generated. No longer a process.exit() at import time — that made
    // a fresh clone unbootable and made the test suite depend on a developer
    // happening to have a .env on disk.
    sessionSecret: E.SESSION_SECRET || "",
  },
  smtp: {
    host: E.SMTP_HOST || "",
    port: num(E.SMTP_PORT, 587),
    secure: String(E.SMTP_SECURE || "").toLowerCase() === "true" || num(E.SMTP_PORT, 587) === 465,
    user: E.SMTP_USER || "",
    pass: E.SMTP_PASS || "",
    from: E.MAIL_FROM || E.SMTP_USER || "",
  },
  // Nightly pipeline. The timezone is passed to node-cron explicitly, which
  // otherwise uses the server's local zone.
  cronTime: E.CRON_TIME || "0 3 * * *",
  cronTimezone: E.CRON_TIMEZONE || "UTC",
  // Lightweight sync that keeps the live boards fresh. "" disables it.
  quickSyncCron: E.QUICK_SYNC_CRON ?? "*/30 * * * *",
  quickSyncAnalyzeCap: num(E.QUICK_SYNC_ANALYZE_CAP, 60),
  // 0=Sun..6=Sat — which weekday the weekly employee reports send.
  weeklyReportDow: num(E.WEEKLY_REPORT_DOW, 1),
  autoAnalyzeCap: num(E.AUTO_ANALYZE_CAP, 25),
  // The nightly pipeline lifts the daily cap (the AI budget is the real
  // ceiling) so every new conversation is analyzed before reports go out.
  nightlyAnalyzeCap: num(E.NIGHTLY_ANALYZE_CAP, 500),
  // Used to classify a not-contacted lead as "after hours" rather than
  // "neglected". Also overridable at runtime via ads_settings `work_hours`.
  workHours: {
    start: num(E.WORK_START_HOUR, 9),
    end: num(E.WORK_END_HOUR, 17),
    offDays: (E.WORK_OFF_DAYS ?? "0,6").split(",").map((n) => Number(n.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  },
};

export default config;
