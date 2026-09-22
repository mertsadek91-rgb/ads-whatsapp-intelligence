// WhatsApp broadcast campaigns — our own version of Wati's "Create New
// Campaign" wizard: name -> channel -> template -> audience filters -> send.
// The write side follows the same two-step contract as assignment.js
// (/preview never touches Wati, /execute requires an explicit confirm and a
// stale-selection guard) plus one more gate assignment.js doesn't need: a
// master switch, because this endpoint messages CUSTOMERS, not internal
// ownership. Defaults OFF; see broadcast.js for why.
import { Router } from "express";
import { query } from "../db.js";
import { wrap } from "../lib/wrap.js";
import * as bc from "../lib/broadcast.js";
import { COUNTRIES, flagEmoji } from "../lib/phoneCountry.js";
import { getProfile } from "../lib/profileStore.js";
import { categories } from "../lib/profileDerived.js";

const CATEGORIES = () => categories(getProfile());

const router = Router();
const COUNTRY_BY_ISO = new Map(COUNTRIES.map((c) => [c.iso2, c]));
const performer = (req) => req.session?.email || `user#${req.session?.userId || "?"}`;

// ---- master switch ----
router.get("/enabled", wrap(async (req, res) => res.json({ enabled: await bc.sendEnabled() })));
router.post("/enabled", wrap(async (req, res) => res.json({ enabled: await bc.setSendEnabled(!!req.body?.enabled) })));

// ---- templates ----
router.get("/templates", wrap(async (req, res) => {
  const channel = req.query.channel || null;
  const all = await bc.templates({ channel, force: req.query.force === "1" });
  res.json({ templates: all.filter((t) => t.status === "APPROVED"), all });
}));

// ---- audience-builder facets: owners, countries, stages, channels, tag taxonomy ----
router.get("/facets", wrap(async (req, res) => {
  const [countries, owners, campaigns, stages, channels, leadStages, sources, scoreBands, messageStats] = await Promise.all([
    query(`select country_iso2 iso2, count(*) n from ads_wati_contacts
           where country_iso2 is not null and country_iso2 <> '' group by iso2 order by n desc`),
    query(`select trim(regexp_replace(coalesce(contact_owner,''), '[[:space:]]+', ' ')) owner, count(*) n
           from ads_wati_contacts where contact_owner is not null and contact_owner <> ''
           group by owner order by n desc`),
    query(`select p.campaign_id id, p.campaign_name name, count(*) n
           from ads_wati_contacts c join ads_meta_ad_perf p on p.ad_id = c.source_ad_id
           group by p.campaign_id, p.campaign_name order by n desc limit 60`),
    query(`select stage, count(*) n from ads_wati_contacts
           where stage is not null and stage <> '' group by stage order by n desc`),
    query(`select business_channel ch, count(*) n from ads_wati_contacts
           where business_channel is not null and business_channel <> '' group by ch order by n desc`),
    query(`select lead_stage, count(*) n from ads_wati_contacts
           where lead_stage is not null and lead_stage <> '' group by lead_stage order by n desc limit 60`),
    query(`select source, count(*) n from ads_wati_contacts
           where source is not null and source <> '' group by source order by n desc`),
    query(`select score_band, count(*) n from ads_wati_contacts
           where score_band is not null and score_band <> '' group by score_band order by field(score_band,'hot','warm','cold')`),
    query(`select min(num_messages) lo, max(num_messages) hi from ads_wati_contacts where num_messages is not null`),
  ]);
  res.json({
    countries: countries.map((c) => {
      const meta = COUNTRY_BY_ISO.get(c.iso2);
      return { iso2: c.iso2, n: Number(c.n), flag: flagEmoji(c.iso2), ar: meta?.ar || c.iso2, en: meta?.en || c.iso2 };
    }),
    owners, campaigns, stages, channels, leadStages, sources, scoreBands,
    messageRange: { lo: Number(messageStats[0]?.lo || 0), hi: Number(messageStats[0]?.hi || 0) },
    // CATEGORIES is a function; JSON.stringify drops function values, so the
    // key vanished from the payload entirely and the filter UI had no groups.
    categories: CATEGORIES(),
  });
}));

// ---- audience preview (read-only, no Wati call) ----
router.post("/audience/preview", wrap(async (req, res) => {
  res.json(await bc.audiencePreview(req.body?.filter || {}));
}));

// ---- campaign preview: audience + template together, before creating a run ----
router.post("/preview", wrap(async (req, res) => {
  const { name, templateName, channel } = req.body || {};
  if (!String(name || "").trim()) return res.status(400).json({ error: "اسم الحملة مطلوب" });
  if (!templateName) return res.status(400).json({ error: "اختر قالباً" });
  const tpl = (await bc.approvedTemplates({ channel: channel || null })).find((t) => t.name === templateName);
  if (!tpl) return res.status(400).json({ error: "القالب غير موجود أو غير مُعتمد من واتساب لهذه القناة" });
  const audience = await bc.audiencePreview(req.body?.filter || {});
  res.json({ audience, template: tpl, send_enabled: await bc.sendEnabled() });
}));

// ---- execute: creates the run row, then sends ----
router.post("/execute", wrap(async (req, res) => {
  const { name, templateName, channel, filter = {}, confirm, expected } = req.body || {};
  if (!String(name || "").trim()) return res.status(400).json({ error: "اسم الحملة مطلوب" });
  if (!templateName) return res.status(400).json({ error: "اختر قالباً" });
  if (!confirm) return res.status(400).json({ error: "التنفيذ يتطلّب تأكيداً صريحاً" });
  if (!(await bc.sendEnabled())) return res.status(409).json({ error: "الإرسال الجماعي مُعطَّل من الإعدادات — فعِّله أولاً" });

  const tpl = (await bc.approvedTemplates({ channel: channel || null })).find((t) => t.name === templateName);
  if (!tpl) return res.status(400).json({ error: "القالب غير موجود أو غير مُعتمد من واتساب لهذه القناة" });

  const audience = await bc.audiencePreview(filter);
  // The client echoes back what /preview told it; a mismatch means the
  // audience shifted (new opt-out, new contact) since the preview.
  if (expected != null && Number(expected) !== audience.eligible) {
    return res.status(409).json({ error: "تغيّر الجمهور بعد المعاينة — أعد المعاينة", audience });
  }
  if (audience.eligible === 0) return res.status(400).json({ error: "لا يوجد عملاء مؤهّلون لهذا الفلتر" });

  const ins = await query(
    `insert into ads_broadcast_run (name, template_name, channel, filter_json, total, status, created_by)
     values (?,?,?,?,?,?,?)`,
    [String(name).trim(), templateName, channel || null, JSON.stringify(filter),
      audience.eligible, "running", performer(req)]);
  const runId = ins.insertId;

  try {
    const r = await bc.sendBroadcast(runId, { name: String(name).trim(), templateName, channel, filter });
    res.json({ ...r, runId });
  } catch (e) {
    await query("update ads_broadcast_run set status='error' where id=?", [runId]).catch(() => {});
    res.status(400).json({ error: e.message, runId });
  }
}));

// ---- history ----
router.get("/runs", wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "30", 10) || 30, 1), 100);
  const runs = await query(
    `select id, name, template_name, channel, total, sent, failed, skipped, status, created_by, created_at, finished_at
     from ads_broadcast_run order by created_at desc limit ${limit}`);
  res.json({ runs });
}));

router.get("/runs/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [rows, recipients] = await Promise.all([
    query("select * from ads_broadcast_run where id=?", [id]),
    query(`select wa_id, status, error, created_at from ads_broadcast_recipient
           where run_id=? order by id limit 1000`, [id]),
  ]);
  if (!rows.length) return res.status(404).json({ error: "غير موجود" });
  const run = rows[0];
  res.json({
    run: { ...run, filter: safeJson(run.filter_json), param_map: safeJson(run.param_map_json) },
    recipients,
  });
}));

function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

export default router;
