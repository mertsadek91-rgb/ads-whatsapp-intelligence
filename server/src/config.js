// Central config: loads .env (from APP/.env) and exposes parsed settings.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// APP/.env  (two levels up from server/src)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function parseMysqlUrl(url) {
  // mysql://user:pass@host:port/db
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: (u.pathname || "/").replace(/^\//, "") || "default",
  };
}

const E = process.env;

// BUG-004 fix: fail fast on boot if security-critical secrets are missing,
// too short, or still a known placeholder value that once shipped in .env.
// This must run before the app starts listening — an insecure secret here
// means forgeable sessions for every user.
const PLACEHOLDER_SECRETS = new Set([
  "", "change-me-please", "please-change-this-to-a-long-random-string",
  "ist-markets", "ist-markets-2026",
]);

function assertSecret(name, value, minLen = 32) {
  if (!value || PLACEHOLDER_SECRETS.has(value) || value.length < minLen) {
    console.error(
      `\n[FATAL] ${name} is missing, a placeholder, or shorter than ${minLen} chars.\n` +
      `This is a hard stop — an insecure ${name} makes sessions/credentials forgeable.\n` +
      `Generate one and set it in APP/.env:\n` +
      `  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"\n`
    );
    process.exit(1);
  }
}
assertSecret("SESSION_SECRET", E.SESSION_SECRET);

export const config = {
  port: Number(E.PORT || 3000),
  mysql: parseMysqlUrl(E.MYSQL_URL || "mysql://root@127.0.0.1:3306/default"),
  wati: {
    endpoint: (E.WATI_API_ENDPOINT || "").replace(/\/$/, ""),
    token: (E.WATI_ACCESS_TOKEN || "").replace(/^Bearer\s+/i, ""),
    // Multiple connected WhatsApp numbers all share this one token; getMessages
    // is told which number via ?channelPhoneNumber=<number> (derived per contact
    // from its whatsapp_<number> param), so no second token/endpoint is needed.
  },
  appBaseUrl: (E.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  meta: {
    token: E.META_ACCESS_TOKEN || "",          // optional seed token (.env)
    appId: E.META_APP_ID || "",                 // for auto long-lived + OAuth
    appSecret: E.META_APP_SECRET || "",
    scopes: E.META_SCOPES || "ads_read,business_management",
    accountId: (E.META_AD_ACCOUNT_ID || "133471367053077").replace("act_", ""),
    lookbackDays: Number(E.META_LOOKBACK_DAYS || 120),
    apiVersion: E.META_API_VERSION || "v21.0",
    // The WhatsApp campaign tied to Wati (used for daily/monthly spend series).
    waCampaignId: E.META_WA_CAMPAIGN_ID || "120235482467810125",
    // Period covered by the analytics tables.
    periodSince: E.PERIOD_SINCE || "2026-02-24",
  },
  deepseek: {
    apiKey: E.DEEPSEEK_API_KEY || "",
    baseUrl: (E.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, ""),
    // DeepSeek retired "deepseek-chat" — the current models are deepseek-v4-pro
    // and deepseek-v4-flash. Default to flash (economical, fits the high
    // conversation-analysis volume + the $10/day budget guard); set
    // DEEPSEEK_MODEL=deepseek-v4-pro for higher-quality analysis.
    model: E.DEEPSEEK_MODEL || "deepseek-v4-flash",
    // BUG-027 fix: cost estimate only — verify against DeepSeek's current
    // pricing page before relying on this for real budgeting; it exists so
    // ads_ai_runs has an approximate cost figure, not an exact invoice match.
    inputCostPer1M: Number(E.DEEPSEEK_INPUT_COST_PER_1M || 0.28),
    outputCostPer1M: Number(E.DEEPSEEK_OUTPUT_COST_PER_1M || 1.10),
    dailyBudgetUsd: Number(E.DEEPSEEK_DAILY_BUDGET_USD || 10),
  },
  auth: {
    sessionSecret: E.SESSION_SECRET || "change-me-please",
  },
  // Company SMTP for the nightly report emails. All values via env (set in
  // Coolify) — never in source. When host/user/pass are absent the mailer is
  // a safe no-op, so the app runs identically with email simply disabled.
  smtp: {
    host: E.SMTP_HOST || "",
    port: Number(E.SMTP_PORT || 587),
    secure: String(E.SMTP_SECURE || "").toLowerCase() === "true" || Number(E.SMTP_PORT) === 465,
    user: E.SMTP_USER || "",
    pass: E.SMTP_PASS || "",
    from: E.MAIL_FROM || E.SMTP_USER || "",
  },
  // The nightly pipeline runs at 03:00 Asia/Dubai (the scheduler passes the
  // timezone explicitly; node-cron otherwise uses the server's local TZ).
  cronTime: E.CRON_TIME || "0 3 * * *",
  cronTimezone: E.CRON_TIMEZONE || "Asia/Dubai",
  // Lightweight sync+analyze that keeps the sales-floor leaderboard fresh: pull
  // recent Wati + Meta, analyze new conversations (budget-guarded), snapshot
  // contact status. Runs on its own cron ("" disables it).
  quickSyncCron: E.QUICK_SYNC_CRON ?? "*/30 * * * *",
  quickSyncAnalyzeCap: Number(E.QUICK_SYNC_ANALYZE_CAP || 60),
  // Which weekday (0=Sun..6=Sat, Dubai time) the weekly employee reports send.
  weeklyReportDow: Number(E.WEEKLY_REPORT_DOW ?? 1), // 1 = Monday
  autoAnalyzeCap: Number(E.AUTO_ANALYZE_CAP || 25),
  // The nightly pipeline lifts the daily 25-cap (the DeepSeek daily budget is
  // the real ceiling) so ALL new conversations get analyzed before reports.
  nightlyAnalyzeCap: Number(E.NIGHTLY_ANALYZE_CAP || 500),
  // Default working hours (Dubai) + off days (0=Sun..6=Sat), used to classify
  // a not-contacted lead as "after-hours" vs "negligence". Overridable at
  // runtime via the ads_settings `work_hours` key (Settings page).
  workHours: {
    start: Number(E.WORK_START_HOUR || 9),
    end: Number(E.WORK_END_HOUR || 19),
    offDays: (E.WORK_OFF_DAYS || "5").split(",").map((n) => Number(n.trim())).filter((n) => n >= 0 && n <= 6),
  },
};

export default config;
