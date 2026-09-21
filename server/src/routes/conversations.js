import { Router } from "express";
import { query } from "../db.js";
import * as wati from "../lib/wati.js";
import * as analysis from "../lib/conversationAnalysis.js";
import * as cmeta from "../lib/conversationMeta.js";
import { loadJobState, saveJobState, correctInterrupted } from "../lib/jobState.js";
import { wrap } from "../lib/wrap.js";

const router = Router();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const HUMAN_TYPES = ["human_handled", "awaiting_human"];

function buildFilter(qp) {
  const where = ["1=1"];
  const params = [];
  if (qp.q) { where.push("(c.full_name like ? or c.phone like ?)"); params.push(`%${qp.q}%`, `%${qp.q}%`); }
  if (qp.stage) { where.push("c.stage = ?"); params.push(qp.stage); }
  if (qp.owner) { where.push("c.contact_owner = ?"); params.push(qp.owner); }
  if (qp.convType) { where.push("m.conv_type = ?"); params.push(qp.convType); }
  if (qp.leadStage) { where.push("c.lead_stage = ?"); params.push(qp.leadStage); }
  if (qp.postUrl) { where.push("c.source_url = ?"); params.push(qp.postUrl); }
  if (qp.adId) { where.push("c.source_ad_id = ?"); params.push(qp.adId); }
  if (qp.campaignId) { where.push("p.campaign_id = ?"); params.push(qp.campaignId); }
  if (qp.adsetId) { where.push("p.adset_id = ?"); params.push(qp.adsetId); }
  if (qp.tag) { where.push("json_contains(c.tags, json_quote(?))"); params.push(qp.tag); }
  if (qp.scoreMin) { where.push("a.conv_score >= ?"); params.push(Number(qp.scoreMin)); }
  if (qp.scoreMax) { where.push("a.conv_score < ?"); params.push(Number(qp.scoreMax)); }
  if (isDate(qp.since)) { where.push("date(c.last_message_at) >= ?"); params.push(qp.since); }
  if (isDate(qp.until)) { where.push("date(c.last_message_at) <= ?"); params.push(qp.until); }
  if (qp.analyzed === "1") where.push("a.wa_id is not null");
  if (qp.analyzed === "0") where.push("a.wa_id is null");
  if (qp.stale === "1") where.push("(a.wa_id is not null and (a.message_count is null or a.message_count <> m.msg_total))");
  return { clause: where.join(" and "), params };
}

const LIST_SELECT = `select c.wa_id, c.full_name, c.phone, c.stage, c.lead_score, c.score_band,
   c.contact_owner, c.num_messages, c.last_message_at, c.created_at, c.created_date, c.country,
   p.campaign_id, p.campaign_name, p.adset_id, p.adset_name,
   m.conv_type, m.customer_msgs, m.agent_msgs, m.human_replied, m.msg_total,
   a.conv_score, a.agent_score, a.lead_intent, a.wrong_persuasion, a.analyzed_at, a.message_count,
   case when a.wa_id is not null and (a.message_count is null or a.message_count <> m.msg_total) then 1 else 0 end as stale
 from ads_wati_contacts c
 left join ads_meta_ad_perf p on p.ad_id = c.source_ad_id
 left join ads_conversation_meta m on m.wa_id = c.wa_id
 left join ads_conversation_analysis a on a.wa_id = c.wa_id`;

// BUG-031 fix (two stages): first an honest "showing first N of M" total,
// now real pagination via a validated offset so every page is reachable.
router.get("/", wrap(async (req, res) => {
  const f = buildFilter(req.query);
  const limit = Math.min(parseInt(req.query.limit || "300", 10) || 300, 1000);
  const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);
  const [rows, countRows] = await Promise.all([
    query(`${LIST_SELECT} where ${f.clause} order by coalesce(c.last_message_at, c.created_at) desc limit ${limit} offset ${offset}`, f.params),
    query(
      `select count(*) total from ads_wati_contacts c
       left join ads_meta_ad_perf p on p.ad_id = c.source_ad_id
       left join ads_conversation_meta m on m.wa_id = c.wa_id
       left join ads_conversation_analysis a on a.wa_id = c.wa_id
       where ${f.clause}`, f.params),
  ]);
  res.json({ rows, total: countRows[0]?.total ?? rows.length, limit, offset });
}));

// BUG-032 fix (stage 2): server-side search over ALL distinct posts, so a
// post beyond the dropdown's 400-item cap is still findable by typing.
router.get("/post-search", wrap(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const rows = await query(
    `select distinct source_url v from ads_wati_contacts
     where source_url like ? order by 1 limit 30`, [`%${q}%`]);
  res.json(rows.map((r) => r.v));
}));

// ---- background jobs (sync metrics, analyze) ----
// BUG-012 fix: hydrated from + persisted to ads_job_state (see jobState.js)
// so a restart mid-run reports "error" instead of a misleading fresh "idle".
function idleJob() { return { state: "idle", total: 0, done: 0, failed: 0, skipped: 0, current: null, startedAt: null, finishedAt: null, error: null }; }
let syncJob = idleJob();
let batch = idleJob();

// Called from server.js's boot() AFTER ensureSchema() — see admin.js's
// hydrateJobs() for why this can't run at module-import time.
export async function hydrateJobs() {
  try {
    const s = correctInterrupted(await loadJobState("conv:sync"));
    if (s) syncJob = s;
  } catch (e) { console.error("[conversations] sync job hydrate failed:", e.message); }
  try {
    const b = correctInterrupted(await loadJobState("conv:analyze"));
    if (b) batch = b;
  } catch (e) { console.error("[conversations] analyze job hydrate failed:", e.message); }
}

router.get("/jobs-status", (req, res) => res.json({ sync: syncJob, analyze: batch }));
router.post("/stop-jobs", (req, res) => {
  if (syncJob.state === "running") { syncJob.state = "stopped"; saveJobState("conv:sync", syncJob).catch(() => {}); }
  if (batch.state === "running") { batch.state = "stopped"; saveJobState("conv:analyze", batch).catch(() => {}); }
  res.json({ ok: true });
});

// dropdown options for the filter bar (campaigns/adsets/ads form a cascading hierarchy)
router.get("/filter-options", wrap(async (req, res) => {
  const stages = (await query("select distinct lead_stage v from ads_wati_contacts where lead_stage is not null and lead_stage<>'' order by 1")).map((r) => r.v);
  const campaigns = await query("select campaign_id id, campaign_name name from ads_meta_campaign_perf order by campaign_name");
  const adsets = await query("select adset_id id, adset_name name, campaign_id from ads_meta_adset_perf order by adset_name");
  // BUG-030 fix: this used to be built only from contacts that already have a
  // linked ad (67 of 188 known ads), so ads with zero contacts so far never
  // appeared in the filter — union with the full ads table, keeping the
  // contacts side only as a fallback for orphan source_ad_ids not in it.
  const ads = await query(
    `select ad_id id, ad_name name, campaign_id, adset_id from ads_meta_ad_perf
     union
     select distinct c.source_ad_id id, c.source_ad_id name, null campaign_id, null adset_id
     from ads_wati_contacts c
     where c.source_ad_id is not null and c.source_ad_id<>''
       and c.source_ad_id not in (select ad_id from ads_meta_ad_perf)
     order by 2`);
  // BUG-032 fix: this list used to be silently truncated at 400 distinct
  // posts with no way for the UI to tell "400 total" from "400 of many more"
  // — same class of issue as BUG-031. Report the true count alongside it.
  const posts = (await query("select distinct source_url v from ads_wati_contacts where source_url is not null and source_url<>'' order by 1 limit 400")).map((r) => r.v);
  const [{ n: postsTotal }] = await query(
    "select count(distinct source_url) n from ads_wati_contacts where source_url is not null and source_url<>''");
  const tags = (await query(
    `select distinct jt.tag v from ads_wati_contacts, json_table(coalesce(tags,'[]'), '$[*]' columns (tag varchar(191) path '$')) jt
     where jt.tag is not null order by 1 limit 200`).catch(() => [])).map((r) => r.v);
  res.json({ stages, campaigns, adsets, ads, posts, postsTotal, tags });
}));

async function runPool(ids, worker, concurrency, job) {
  let i = 0;
  const next = async () => {
    while (i < ids.length && job.state === "running") {
      const id = ids[i++]; job.current = id;
      try { await worker(id); } catch (e) { job.failed++; console.error("[job]", id, e.message); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, next));
}

// Sync engagement metrics/classification for the filtered set (no AI; cheap).
router.post("/sync-batch", wrap(async (req, res) => {
  if (syncJob.state === "running") return res.status(409).json({ error: "مزامنة قيد التشغيل" });
  const f = buildFilter(req.body || {});
  const max = Math.min(parseInt(req.body?.max || "8000", 10), 10000);
  const ids = (await query(`${LIST_SELECT} where ${f.clause} order by coalesce(c.last_message_at, c.created_at) desc limit ${max}`, f.params)).map((r) => r.wa_id);
  syncJob = { ...idleJob(), state: "running", total: ids.length, startedAt: Date.now() };
  saveJobState("conv:sync", syncJob).catch(() => {});
  res.json({ started: true, total: ids.length });
  await runPool(ids, async (id) => {
    await cmeta.syncOne(id);
    syncJob.done++;
    if (syncJob.done % 20 === 0) saveJobState("conv:sync", syncJob).catch(() => {});
  }, 3, syncJob)
    .then(() => { if (syncJob.state !== "stopped") syncJob.state = "done"; syncJob.current = null; syncJob.finishedAt = Date.now(); saveJobState("conv:sync", syncJob).catch(() => {}); })
    .catch((e) => { syncJob.state = "error"; syncJob.error = e.message; saveJobState("conv:sync", syncJob).catch(() => {}); });
}));

// Analyze the filtered set. Smart filter: skip bot-only/no-customer by default.
router.post("/analyze-batch", wrap(async (req, res) => {
  if (batch.state === "running") return res.status(409).json({ error: "تحليل دفعة قيد التشغيل" });
  const onlyUnanalyzed = req.body?.onlyUnanalyzed !== false;
  const skipBot = req.body?.skipBot !== false;
  // score filters operate on conv_score (analysis output) and conflict with
  // "only unanalyzed", so they are ignored when selecting what to analyze.
  const { scoreMin, scoreMax, ...sel } = req.body || {};
  const f = buildFilter({ ...sel, analyzed: onlyUnanalyzed ? "0" : undefined });
  const max = Math.min(parseInt(req.body?.max || "500", 10), 2000);
  const ids = (await query(`${LIST_SELECT} where ${f.clause} order by coalesce(c.last_message_at, c.created_at) desc limit ${max}`, f.params)).map((r) => r.wa_id);
  batch = { ...idleJob(), state: "running", total: ids.length, startedAt: Date.now() };
  saveJobState("conv:analyze", batch).catch(() => {});
  res.json({ started: true, total: ids.length });
  await runPool(ids, async (id) => {
    const synced = await cmeta.syncOne(id);          // fetch thread once + classify
    if (skipBot && !HUMAN_TYPES.includes(synced.conv_type)) { batch.skipped++; }
    else { await analysis.analyze(id, synced.thread); batch.done++; }  // reuse fetched thread
    if ((batch.done + batch.skipped + batch.failed) % 10 === 0) saveJobState("conv:analyze", batch).catch(() => {});
  }, 2, batch)
    .then(() => { if (batch.state !== "stopped") batch.state = "done"; batch.current = null; batch.finishedAt = Date.now(); saveJobState("conv:analyze", batch).catch(() => {}); })
    .catch((e) => { batch.state = "error"; batch.error = e.message; saveJobState("conv:analyze", batch).catch(() => {}); });
}));

router.get("/:waId", wrap(async (req, res) => {
  const waId = req.params.waId;
  const [contact] = await query(
    `select c.*, p.ad_name, p.campaign_name, p.adset_name,
            r.account_type, r.deposit_total_aed, r.deposit_count, r.review_status, r.notes
     from ads_wati_contacts c
     left join ads_meta_ad_perf p on p.ad_id = c.source_ad_id
     left join ads_lead_review r on r.wa_id = c.wa_id
     where c.wa_id = ?`, [waId]);
  if (!contact) return res.status(404).json({ error: "غير موجود" });
  // Route to the contact's own business-number credentials when configured
  // (a second WhatsApp number the primary token can't read).
  const [messages, events] = await Promise.all([
    wati.getThread(waId, contact.business_channel), wati.getActivity(waId, contact.business_channel)]);
  // BUG-026 fix: a failed Wati fetch is now distinguishable from an empty
  // thread (the .failed marker) — don't re-sync classification off failed
  // data, and tell the UI the view is partial.
  const partial = !!(messages.failed || events.failed);
  if (!partial) await cmeta.syncOne(waId, messages).catch(() => {});
  const an = await analysis.getAnalysis(waId);
  const m = await cmeta.getMeta(waId);
  const stale = an && m && (an.message_count == null || an.message_count !== m.msg_total);

  // all attributes: prefer the structured column, else derive from raw.customParams
  const J = (v) => (typeof v === "string" ? safeJson(v) : v);
  let attributes = J(contact.attributes);
  if (!attributes || !Object.keys(attributes).length) {
    const raw = J(contact.raw) || {};
    attributes = {};
    for (const p of raw.customParams || []) {
      if (p.name && !/^whatsapp_\d+$/i.test(p.name)) attributes[p.name] = p.value;
    }
  }
  const tags = J(contact.tags) || [];
  delete contact.raw; // don't ship the whole blob to the client
  res.json({ contact, messages, events, attributes, tags, analysis: an, meta: m, stale: !!stale, partial });
}));

router.post("/:waId/analyze", wrap(async (req, res) => {
  res.json(await analysis.analyze(req.params.waId));
}));

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

export default router;
