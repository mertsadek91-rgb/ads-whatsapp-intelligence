// WhatsApp broadcast campaigns: our own native version of Wati's "Create New
// Campaign" wizard — template selection, audience filters, send. Modeled
// tightly on watiAssign.js's preview/execute/audit pattern, because this is
// the SECOND place in the app that writes to the live customer system, and
// the first that writes to CUSTOMERS rather than internal ownership.
//
// The send call itself (wati.createBroadcast) is Wati's own dashboard's
// UNDOCUMENTED internal endpoint, not the public REST API — reverse-engineered
// live because the documented sendTemplateMessages rejected every real contact
// on this account with "There are no valid Receivers". It targets contacts by
// Wati's own internal contact id, not by phone number, and templates by their
// internal id, not by name — see wati.js for the full story. One consequence:
// Wati fills template variables (e.g. {{name}}) from the contact's own stored
// name itself; this app has no per-variable mapping control over that.
//
// Safety layers (each one independently sufficient, on purpose):
//  - a master switch (ads_settings.broadcasts_send_enabled) that defaults OFF
//    and is checked again inside sendBroadcast, not just in the route;
//  - customers carrying ENG_OPTED_OUT / ENG_DO_NOT_WHATSAPP (our own AI-detected
//    signal), OR whose Wati "Allow Campaign" toggle (allow_broadcast) is off,
//    are excluded from every audience unconditionally — no filter combination
//    can re-include them;
//  - only APPROVED templates can be sent;
//  - a contact never backfilled with Wati's internal id is reported, not
//    silently dropped or silently attempted.
//
// V1 scope, stated rather than silently omitted: Single Send only. No Drip,
// no auto-retry, no SMS fallback (Wati wizard features we deliberately did
// not build).
import { query } from "../db.js";
import * as wati from "./wati.js";
import { DO_NOT_WHATSAPP_TAGS } from "./tagBoard.js";

const SETTINGS_KEY = "broadcasts_send_enabled";
// BUG fix: this was 300 on the assumption createAndAddLinks takes an
// unbounded contact-id list in one call (like Wati's own UI does for large
// segments). Observed live: a real 649-contact send had both of its
// 300-sized chunks rejected outright (HTTP 400, empty body) while the final
// 49-sized chunk succeeded — real evidence the per-call cap sits somewhere
// under 300. 50 is a conservative value under the one confirmed-working
// point, not a documented limit — tighten further if a smaller batch still
// gets rejected.
export const CHUNK_SIZE = 50;
export const CHUNK_DELAY_MS = 800; // between chunks — gentle on the API
export const MAX_AUDIENCE = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Master switch
// ---------------------------------------------------------------------------
export async function sendEnabled() {
  const r = await query("select v from ads_settings where k = ?", [SETTINGS_KEY]);
  return r.length ? r[0].v === "1" : false;
}
export async function setSendEnabled(on) {
  await query(
    "insert into ads_settings (k, v) values (?, ?) on duplicate key update v=values(v), updated_at=now()",
    [SETTINGS_KEY, on ? "1" : "0"]);
  return sendEnabled();
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
let cache = null, cacheAt = 0, cacheChannel = undefined;
const CACHE_MS = 5 * 60 * 1000;

function extractVars(body) {
  const set = new Set();
  for (const m of String(body || "").matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) set.add(m[1]);
  return [...set];
}

/** Every template Wati reports for a channel, normalized. Cached briefly. */
export async function templates({ channel = null, force = false } = {}) {
  if (!force && cache && cacheChannel === channel && Date.now() - cacheAt < CACHE_MS) return cache;
  const raw = await wati.getMessageTemplates(channel);
  cache = raw.map((t) => ({
    id: t.id, name: t.elementName, category: t.category || null, status: t.status || null,
    language: t.language?.key || t.language?.value || null,
    body: t.bodyOriginal || t.body || "",
    footer: t.footer || null,
    buttons: t.buttons || [],
    // Informational only — Wati fills these from the contact's own record on
    // send; this app has no control over the value used.
    vars: extractVars(t.bodyOriginal || t.body || ""),
  }));
  cacheAt = Date.now(); cacheChannel = channel;
  return cache;
}

export async function approvedTemplates(opts = {}) {
  return (await templates(opts)).filter((t) => t.status === "APPROVED");
}

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------
const NORM_OWNER = "trim(regexp_replace(coalesce(c.contact_owner,''), '[[:space:]]+', ' '))";
const cleanTags = (list) => [...new Set((Array.isArray(list) ? list : [])
  .map((s) => String(s || "").trim().toUpperCase()).filter(Boolean))];

/** Shared WHERE/JOIN builder for the audience filter used by preview/ids/send. */
function buildAudienceFilter(f = {}) {
  const where = ["c.num_messages > 0"];
  const params = [];
  if (f.owner) { where.push(`${NORM_OWNER} = trim(regexp_replace(?, '[[:space:]]+', ' '))`); params.push(f.owner); }
  if (f.country) { where.push("c.country_iso2 = ?"); params.push(String(f.country).toUpperCase()); }
  if (f.stage) { where.push("c.stage = ?"); params.push(f.stage); }
  if (f.leadStage) { where.push("c.lead_stage = ?"); params.push(f.leadStage); }
  if (f.campaign) { where.push("p.campaign_id = ?"); params.push(f.campaign); }
  if (f.channel) { where.push("c.business_channel = ?"); params.push(f.channel); }
  if (f.since) { where.push("c.created_date >= ?"); params.push(f.since); }
  if (f.until) { where.push("c.created_date <= ?"); params.push(f.until); }
  // Last activity is a separate axis from when the lead was created — "created
  // in Q1 but silent since" and "created in Q1, active this week" are different
  // audiences a campaign might want.
  if (f.activeSince) { where.push("c.last_message_at >= ?"); params.push(f.activeSince); }
  if (f.activeUntil) { where.push("c.last_message_at <= ?"); params.push(f.activeUntil); }
  if (f.source) { where.push("c.source = ?"); params.push(f.source); }
  if (f.scoreBand) { where.push("c.score_band = ?"); params.push(f.scoreBand); }
  if (f.deposit === "yes") where.push("c.deposit_flag = 1");
  if (f.deposit === "no") where.push("coalesce(c.deposit_flag, 0) = 0");
  if (f.minMessages != null && f.minMessages !== "") { where.push("c.num_messages >= ?"); params.push(Math.max(0, parseInt(f.minMessages, 10) || 0)); }
  if (f.maxMessages != null && f.maxMessages !== "") { where.push("c.num_messages <= ?"); params.push(Math.max(0, parseInt(f.maxMessages, 10) || 0)); }
  if (f.excludeUnlinked) where.push("coalesce(c.msg_unavailable, 0) = 0");
  // Engagement state — same semantics as the Assignment page's filter, so a
  // "not_contacted" audience here means the same thing it means there.
  if (f.state === "contacted") where.push("(m.conv_type = 'human_handled' or m.human_replied = 1)");
  if (f.state === "not_contacted") where.push("(m.conv_type is null or (m.conv_type <> 'human_handled' and coalesce(m.human_replied,0) = 0))");
  if (f.state === "bot_only") where.push("m.conv_type = 'bot_only'");
  if (f.q) {
    where.push("(c.full_name like ? or c.phone like ? or c.wa_id like ?)");
    const like = `%${String(f.q).slice(0, 60)}%`;
    params.push(like, like, like);
  }

  const tags = cleanTags(f.tags);
  let tagSql = "", tagParams = [];
  if (tags.length) {
    const ph = tags.map(() => "?").join(",");
    tagSql = f.tagMatch === "all"
      ? `c.wa_id in (select wa_id from ads_conversation_tag where review_status <> 'rejected' and tag in (${ph}) group by wa_id having count(distinct tag) = ${tags.length})`
      : `c.wa_id in (select distinct wa_id from ads_conversation_tag where review_status <> 'rejected' and tag in (${ph}))`;
    tagParams = tags;
  }
  return { where: where.join(" and "), params, tagSql, tagParams };
}

// Two independent, unconditional exclusions — an opt-out signal we derived
// ourselves (AI reading of the conversation) and Wati's own native toggle.
const OPTOUT_EXCLUDE = `c.wa_id not in (select wa_id from ads_conversation_tag where review_status <> 'rejected' and tag in (${DO_NOT_WHATSAPP_TAGS.map(() => "?").join(",")}))`;
const ALLOWED_EXCLUDE = "coalesce(c.allow_broadcast, 1) = 1";
const HAS_CONTACT_ID = "c.wati_contact_id is not null and c.wati_contact_id <> ''";
const FROM = `from ads_wati_contacts c
  left join ads_meta_ad_perf p on p.ad_id = c.source_ad_id
  left join ads_conversation_meta m on m.wa_id = c.wa_id`;

/** Audience size + breakdown + sample for a filter, before any send. Read-only. */
export async function audiencePreview(filter = {}) {
  const { where, params, tagSql, tagParams } = buildAudienceFilter(filter);
  const coreWhere = where + (tagSql ? ` and ${tagSql}` : "");
  const coreParams = [...params, ...tagParams];
  const optedWhere = `${coreWhere} and ${OPTOUT_EXCLUDE} and ${ALLOWED_EXCLUDE}`;
  const optedParams = [...coreParams, ...DO_NOT_WHATSAPP_TAGS];
  const fullWhere = `${optedWhere} and ${HAS_CONTACT_ID}`;

  const [[totalRow], [optedRow], [eligibleRow], byCountry, sample] = await Promise.all([
    query(`select count(*) n ${FROM} where ${coreWhere}`, coreParams),
    query(`select count(*) n ${FROM} where ${optedWhere}`, optedParams),
    query(`select count(*) n ${FROM} where ${fullWhere}`, optedParams),
    query(`select c.country_iso2 iso2, count(*) n ${FROM} where ${fullWhere} group by c.country_iso2 order by n desc limit 40`, optedParams),
    query(`select c.wa_id, c.full_name, c.phone, c.country_iso2, c.contact_owner
           ${FROM} where ${fullWhere} order by c.last_message_at desc limit 12`, optedParams),
  ]);
  const total = Number(totalRow?.n || 0);
  const opted = Number(optedRow?.n || 0);
  const eligible = Number(eligibleRow?.n || 0);
  return {
    total_matching: total,
    eligible,
    excluded_opted_out: total - opted,
    // Matched, not opted out, but never backfilled with Wati's internal id —
    // real, visible gap rather than a silent drop. Re-run the Wati sync to
    // clear it.
    missing_contact_id: opted - eligible,
    by_country: byCountry.map((r) => ({ iso2: r.iso2 || null, n: Number(r.n) })),
    sample: sample.map((r) => ({
      wa_id: r.wa_id, name: r.full_name || null, phone: r.phone || null,
      country_iso2: r.country_iso2 || null, owner: r.contact_owner || null,
    })),
  };
}

/** {wa_id, wati_contact_id} pairs a send would act on — capped, fully eligible only. */
export async function audienceRecipients(filter = {}, cap = MAX_AUDIENCE) {
  const { where, params, tagSql, tagParams } = buildAudienceFilter(filter);
  const fullWhere = `${where}${tagSql ? ` and ${tagSql}` : ""} and ${OPTOUT_EXCLUDE} and ${ALLOWED_EXCLUDE} and ${HAS_CONTACT_ID}`;
  const fullParams = [...params, ...tagParams, ...DO_NOT_WHATSAPP_TAGS];
  const rows = await query(
    `select c.wa_id, c.wati_contact_id ${FROM} where ${fullWhere} limit ${Math.min(cap, MAX_AUDIENCE)}`, fullParams);
  return rows.map((r) => ({ wa_id: r.wa_id, wati_contact_id: r.wati_contact_id }));
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
async function logRecipients(runId, rows) {
  if (!rows.length) return;
  const values = rows.map(() => "(?,?,?,?)").join(",");
  const flat = rows.flatMap((r) => [runId, r.wa_id, r.status, r.error ?? null]);
  await query(`insert into ads_broadcast_recipient (run_id, wa_id, status, error) values ${values}`, flat).catch(() => {});
}

/**
 * A real failure came back as: {"items":[{"code":"Broadcast","description":
 * "Can't create a broadcast with exists invalid contact"}]} — Wati rejects
 * the WHOLE call the instant one contact id in it is invalid, contradicting
 * IsExcludeInValidContact (that flag apparently doesn't apply to an explicit
 * selectedContactIds list). Detected from the raw body so wording changes in
 * `error`'s "HTTP 400: ..." prefix don't break the check.
 */
function isInvalidContactError(r) {
  const text = JSON.stringify(r?.raw ?? r?.error ?? "");
  return /invalid contact/i.test(text);
}

/**
 * Send one batch, bisecting on an "invalid contact" rejection so ONE bad id
 * doesn't sink everyone else who happened to share its batch — it used to:
 * a real send had two 50-contact batches fail outright over what turned out
 * to be a single bad id each. Any other error (auth, template, rate limit)
 * would fail identically on every subset, so it's applied to the whole batch
 * without wasting calls bisecting something that can't be isolated.
 */
async function sendBatch(o, batch, label) {
  let r;
  try {
    r = await wati.createBroadcast({
      broadcastName: `${o.name} (${label})`,
      templateId: o.templateId,
      contactIds: batch.map((b) => b.wati_contact_id),
      quickReplyCount: o.quickReplyCount,
    });
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  // A real success response looks like {ok:true, result:{errorCode:0, ...}}
  // — check both, in case a future response ever returns ok:true alongside a
  // nonzero error code.
  const ok = r?.ok !== false && (r?.result?.errorCode ?? 0) === 0;
  if (ok) return batch.map((b) => ({ wa_id: b.wa_id, status: "queued", error: null }));

  if (batch.length > 1 && isInvalidContactError(r)) {
    const mid = Math.ceil(batch.length / 2);
    const left = await sendBatch(o, batch.slice(0, mid), `${label}a`);
    await sleep(300);
    const right = await sendBatch(o, batch.slice(mid), `${label}b`);
    return [...left, ...right];
  }
  const error = r?.error || "rejected";
  return batch.map((b) => ({ wa_id: b.wa_id, status: "error", error }));
}

/**
 * Run a broadcast that was already created as a row (status='running').
 * @param {number} runId
 * @param {{name,templateName,channel,filter,onProgress}} o
 */
export async function sendBroadcast(runId, { name, templateName, channel, filter = {}, onProgress = null } = {}) {
  if (!(await sendEnabled())) throw new Error("الإرسال الجماعي مُعطَّل — فعِّله من الإعدادات أولاً");

  const recipients = await audienceRecipients(filter, MAX_AUDIENCE);
  if (!recipients.length) throw new Error("لا يوجد عملاء مؤهّلون للإرسال بهذا الفلتر");

  const tpl = (await approvedTemplates({ channel })).find((t) => t.name === templateName);
  if (!tpl) throw new Error("القالب غير موجود أو غير مُعتمد من واتساب لهذه القناة");
  // Wati's Reaction.QuickReplies array must have exactly one slot per
  // quick-reply button THE TEMPLATE ITSELF has — a url/phone button doesn't
  // count. Get this wrong and Wati rejects the whole batch with "Invalid
  // broadcast reaction setup" regardless of how valid the contacts are.
  const quickReplyCount = (tpl.buttons || []).filter((b) => String(b.type || "").toLowerCase() === "quick_reply").length;
  const sendOpts = { name, templateId: tpl.id, quickReplyCount };

  let sent = 0, failed = 0;
  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const batch = recipients.slice(i, i + CHUNK_SIZE);
    const rows = await sendBatch(sendOpts, batch, String(i / CHUNK_SIZE + 1));
    const chunkSent = rows.filter((r) => r.status === "queued").length;
    sent += chunkSent; failed += rows.length - chunkSent;
    await logRecipients(runId, rows);
    await query("update ads_broadcast_run set sent=?, failed=? where id=?", [sent, failed, runId]).catch(() => {});
    if (onProgress) onProgress({ done: Math.min(i + CHUNK_SIZE, recipients.length), total: recipients.length, sent, failed });
    if (i + CHUNK_SIZE < recipients.length) await sleep(CHUNK_DELAY_MS);
  }

  await query("update ads_broadcast_run set status='done', finished_at=now() where id=?", [runId]).catch(() => {});
  return { runId, total: recipients.length, sent, failed, skipped: 0 };
}

export default {
  sendEnabled, setSendEnabled, templates, approvedTemplates,
  audiencePreview, audienceRecipients, sendBroadcast, MAX_AUDIENCE, CHUNK_SIZE,
};
