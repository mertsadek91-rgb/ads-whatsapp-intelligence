// App-wide settings not specific to any one data source. Currently just the
// currency display switcher (BUG-022 fix) — static, admin-edited exchange
// rates stored in the existing ads_settings key/value table (same table
// metaAuth.js already uses for the Meta OAuth token).
import { Router } from "express";
import { query } from "../db.js";
import { requireRole } from "../middleware/auth.js";
import { getIdentity, saveIdentity } from "../lib/appIdentity.js";
import { CURRENCIES, DEFAULT_RATES, sanitizeRates } from "../lib/currency.js";
import { baseCurrency } from "../lib/money.js";
import { COUNTRIES } from "../lib/phoneCountry.js";
import { isConfigured as smtpConfigured } from "../lib/mailer.js";
import { readWorkHours, sanitizeWorkHours } from "../lib/contactStatus.js";
import { wrap } from "../lib/wrap.js";
import config from "../config.js";
import { saveConfig } from "../lib/appConfig.js";
import { normalizeSince, describeRange } from "../lib/dataRange.js";

const router = Router();

// Only an admin may change how the system is configured or read the staff
// directory (which is a list of employee email addresses). Reads that the
// shared UI needs — the currency rates the CurrencyProvider loads on every
// page, and the country vocabulary — stay open to any signed-in account.
const admin = requireRole("admin");
const RATES_KEY = "currency_rates";
const EMAIL_ENABLED_KEY = "reports_email_enabled";
const WORK_HOURS_KEY = "work_hours";
const ROLES = new Set(["agent", "campaign_manager", "general_manager"]);

// `base` is what the stored amounts are actually in — read from the ad account,
// not assumed. The browser needs it to know which rate is fixed at 1 and what
// the other rates are relative to.
router.get("/currency", wrap(async (req, res) => {
  const base = await baseCurrency();
  const r = await query("select v from ads_settings where k = ?", [RATES_KEY]);
  const rates = r.length ? sanitizeRates(JSON.parse(r[0].v), base) : sanitizeRates(DEFAULT_RATES, base);
  res.json({ currencies: CURRENCIES, rates, base });
}));

router.post("/currency", admin, wrap(async (req, res) => {
  const base = await baseCurrency();
  const rates = sanitizeRates(req.body?.rates, base);
  await query(
    "insert into ads_settings (k, v) values (?, ?) on duplicate key update v=values(v), updated_at=now()",
    [RATES_KEY, JSON.stringify(rates)]
  );
  res.json({ currencies: CURRENCIES, rates, base });
}));

// ---- App identity: what this installation calls itself ----
router.get("/identity", wrap(async (req, res) => res.json(await getIdentity({ fresh: true }))));

router.post("/identity", admin, wrap(async (req, res) => res.json(await saveIdentity(req.body))));

// ---- Employee directory for the nightly report emails ----
const ISO2 = new Set(COUNTRIES.map((c) => c.iso2));
const safeJson = (v) => { try { return typeof v === "string" ? JSON.parse(v) : (v || []); } catch { return []; } };

// The country vocabulary for the multi-select on the admin page.
router.get("/country-options", wrap(async (req, res) => res.json(COUNTRIES)));

router.get("/employees", admin, wrap(async (req, res) => {
  const rows = await query(
    "select id, owner_name, email, full_name, role, lang, active, countries, notes from ads_employees order by role, owner_name, id");
  for (const r of rows) r.countries = safeJson(r.countries);
  res.json(rows);
}));

// Upsert one employee (insert when no id, update when id given).
router.post("/employees", admin, wrap(async (req, res) => {
  const b = req.body || {};
  const role = ROLES.has(b.role) ? b.role : "agent";
  const lang = b.lang === "en" ? "en" : "ar";
  const active = b.active ? 1 : 0;
  const email = String(b.email || "").trim();
  // owner_name only meaningful for agents; managers/GM are role-addressed.
  const owner = role === "agent" ? (String(b.owner_name || "").trim() || null) : null;
  const full = String(b.full_name || "").trim() || null;
  const notes = String(b.notes || "").trim() || null;
  // Whitelist submitted country codes against the known ISO-2 vocabulary.
  const countries = JSON.stringify((Array.isArray(b.countries) ? b.countries : []).filter((c) => ISO2.has(c)));
  if (!email) return res.status(400).json({ error: "الإيميل مطلوب" });

  if (b.id) {
    await query(
      "update ads_employees set owner_name=?, email=?, full_name=?, role=?, lang=?, active=?, countries=?, notes=? where id=?",
      [owner, email, full, role, lang, active, countries, notes, b.id]);
  } else {
    await query(
      "insert into ads_employees (owner_name, email, full_name, role, lang, active, countries, notes) values (?,?,?,?,?,?,?,?)",
      [owner, email, full, role, lang, active, countries, notes]);
  }
  res.json({ ok: true });
}));

router.delete("/employees/:id", admin, wrap(async (req, res) => {
  await query("delete from ads_employees where id=?", [Number(req.params.id)]);
  res.json({ ok: true });
}));

// Seed agent rows from the distinct Wati owners that don't have a row yet
// (empty email — the admin fills it in). Bot/blank owners are excluded.
router.post("/employees/seed", admin, wrap(async (req, res) => {
  const owners = await query(
    `select distinct contact_owner o from ads_wati_contacts
     where contact_owner is not null and trim(contact_owner) <> ''`);
  const existing = new Set((await query("select owner_name from ads_employees where owner_name is not null"))
    .map((r) => r.owner_name));
  let added = 0;
  for (const { o } of owners) {
    const name = String(o).replace(/\s+/g, " ").trim();
    if (!name || /bot/i.test(name) || existing.has(name)) continue;
    await query(
      "insert into ads_employees (owner_name, email, role, active) values (?, '', 'agent', 1)", [name])
      .then(() => { added++; }).catch(() => {}); // unique clash = already there
  }
  res.json({ added });
}));

// ---- Nightly-report master send switch + SMTP status ----
router.get("/reports", admin, wrap(async (req, res) => {
  const r = await query("select v from ads_settings where k = ?", [EMAIL_ENABLED_KEY]);
  res.json({ email_enabled: r.length ? r[0].v === "1" : false, smtp_configured: smtpConfigured() });
}));

router.post("/reports", admin, wrap(async (req, res) => {
  const enabled = req.body?.email_enabled ? "1" : "0";
  await query(
    "insert into ads_settings (k, v) values (?, ?) on duplicate key update v=values(v), updated_at=now()",
    [EMAIL_ENABLED_KEY, enabled]);
  res.json({ email_enabled: enabled === "1", smtp_configured: smtpConfigured() });
}));

// ---- How far back imports read ----
// The wizard asks this once; it must be changeable afterwards, because the
// honest first answer is often "the last 90 days" and the answer six weeks
// later is "actually, everything". Stored in app_config rather than
// ads_settings so it reaches the running process through the same hydrate path
// as every other configurable value.
router.get("/data-range", admin, wrap(async (req, res) => {
  res.json({ ...describeRange(config), lookbackDays: config.meta.lookbackDays });
}));

router.post("/data-range", admin, wrap(async (req, res) => {
  await saveConfig({
    "data.since": normalizeSince(req.body?.since),
    "data.watiMessages": !!req.body?.watiMessages,
  }, { updatedBy: req.session?.email || "settings" });
  // Changing the range changes nothing already stored — it decides what the
  // NEXT import reads. Say so, and offer to run one now.
  res.json({ ...describeRange(config), lookbackDays: config.meta.lookbackDays });
}));

/** Re-import over the new range. Same job the admin backfill button runs. */
router.post("/data-range/import", admin, wrap(async (req, res) => {
  const { backfill } = await import("../jobs/backfill.js");
  const { runJob } = await import("./admin.js");
  const started = await runJob("wati", () => backfill());
  if (!started) return res.status(409).json({ error: "الاستيراد قيد التشغيل بالفعل" });
  res.json({ started: true, ...describeRange(config) });
}));

// ---- Working hours (Dubai) — classify not-contacted leads as after-hours ----
router.get("/work-hours", wrap(async (req, res) => res.json(await readWorkHours())));

router.post("/work-hours", admin, wrap(async (req, res) => {
  const wh = sanitizeWorkHours(req.body);
  await query(
    "insert into ads_settings (k, v) values (?, ?) on duplicate key update v=values(v), updated_at=now()",
    [WORK_HOURS_KEY, JSON.stringify(wh)]);
  res.json(wh);
}));

export default router;
