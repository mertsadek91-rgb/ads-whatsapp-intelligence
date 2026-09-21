// App-wide settings not specific to any one data source. Currently just the
// currency display switcher (BUG-022 fix) — static, admin-edited exchange
// rates stored in the existing ads_settings key/value table (same table
// metaAuth.js already uses for the Meta OAuth token).
import { Router } from "express";
import { query } from "../db.js";
import { CURRENCIES, DEFAULT_RATES, sanitizeRates } from "../lib/currency.js";
import { COUNTRIES } from "../lib/phoneCountry.js";
import { isConfigured as smtpConfigured } from "../lib/mailer.js";
import { readWorkHours, sanitizeWorkHours } from "../lib/contactStatus.js";
import { wrap } from "../lib/wrap.js";

const router = Router();
const RATES_KEY = "currency_rates";
const EMAIL_ENABLED_KEY = "reports_email_enabled";
const WORK_HOURS_KEY = "work_hours";
const ROLES = new Set(["agent", "campaign_manager", "general_manager"]);

router.get("/currency", wrap(async (req, res) => {
  const r = await query("select v from ads_settings where k = ?", [RATES_KEY]);
  const rates = r.length ? sanitizeRates(JSON.parse(r[0].v)) : DEFAULT_RATES;
  res.json({ currencies: CURRENCIES, rates });
}));

router.post("/currency", wrap(async (req, res) => {
  const rates = sanitizeRates(req.body?.rates);
  await query(
    "insert into ads_settings (k, v) values (?, ?) as new on duplicate key update v=new.v, updated_at=now()",
    [RATES_KEY, JSON.stringify(rates)]
  );
  res.json({ currencies: CURRENCIES, rates });
}));

// ---- Employee directory for the nightly report emails ----
const ISO2 = new Set(COUNTRIES.map((c) => c.iso2));
const safeJson = (v) => { try { return typeof v === "string" ? JSON.parse(v) : (v || []); } catch { return []; } };

// The country vocabulary for the multi-select on the admin page.
router.get("/country-options", wrap(async (req, res) => res.json(COUNTRIES)));

router.get("/employees", wrap(async (req, res) => {
  const rows = await query(
    "select id, owner_name, email, full_name, role, lang, active, countries, notes from ads_employees order by role, owner_name, id");
  for (const r of rows) r.countries = safeJson(r.countries);
  res.json(rows);
}));

// Upsert one employee (insert when no id, update when id given).
router.post("/employees", wrap(async (req, res) => {
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

router.delete("/employees/:id", wrap(async (req, res) => {
  await query("delete from ads_employees where id=?", [Number(req.params.id)]);
  res.json({ ok: true });
}));

// Seed agent rows from the distinct Wati owners that don't have a row yet
// (empty email — the admin fills it in). Bot/blank owners are excluded.
router.post("/employees/seed", wrap(async (req, res) => {
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
router.get("/reports", wrap(async (req, res) => {
  const r = await query("select v from ads_settings where k = ?", [EMAIL_ENABLED_KEY]);
  res.json({ email_enabled: r.length ? r[0].v === "1" : false, smtp_configured: smtpConfigured() });
}));

router.post("/reports", wrap(async (req, res) => {
  const enabled = req.body?.email_enabled ? "1" : "0";
  await query(
    "insert into ads_settings (k, v) values (?, ?) as new on duplicate key update v=new.v, updated_at=now()",
    [EMAIL_ENABLED_KEY, enabled]);
  res.json({ email_enabled: enabled === "1", smtp_configured: smtpConfigured() });
}));

// ---- Working hours (Dubai) — classify not-contacted leads as after-hours ----
router.get("/work-hours", wrap(async (req, res) => res.json(await readWorkHours())));

router.post("/work-hours", wrap(async (req, res) => {
  const wh = sanitizeWorkHours(req.body);
  await query(
    "insert into ads_settings (k, v) values (?, ?) as new on duplicate key update v=new.v, updated_at=now()",
    [WORK_HOURS_KEY, JSON.stringify(wh)]);
  res.json(wh);
}));

export default router;
