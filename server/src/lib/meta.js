// Meta Marketing (Graph) API client — port of ingest_meta.py.
// Requires META_ACCESS_TOKEN (long-lived, ads_read). Without it, calls throw and
// the daily job skips Meta (data stays as last loaded).
import axios from "axios";
import config from "../config.js";
import { getToken } from "./metaAuth.js";

// Read through functions, never captured at import: the setup wizard and the
// Settings page write these into the running process, and a module-level const
// would keep serving the value that happened to be set at boot.
const API = () => `https://graph.facebook.com/${config.meta.apiVersion}`;
const ACCT = () => config.meta.accountId;

/** Throws a clear message instead of building a request against act_undefined. */
function acctOrThrow() {
  const a = ACCT();
  if (!a) throw new Error("حساب إعلانات Meta غير مهيّأ — أكمل خطوة الإعداد (Meta ad account not configured)");
  return a;
}
const MSG_RESULT = "onsite_conversion.messaging_conversation_started_7d";

/**
 * Deep link into Meta Ads Manager pre-selecting a specific ad or campaign, so
 * the owner can jump from a row here straight to the exact same entity in
 * their ad account. Ad selection wins when both ids are given (more specific).
 * Returns null when neither an account id nor an entity id is available — the
 * UI then just shows the raw id with no link. Values are URL-encoded.
 */
export function adsManagerUrl(accountId, { adId, campaignId } = {}) {
  const acct = accountId || ACCT();
  if (!acct || (!adId && !campaignId)) return null;
  const base = "https://adsmanager.facebook.com/adsmanager/manage";
  const q = `act=${encodeURIComponent(acct)}`;
  if (adId) return `${base}/ads?${q}&selected_ad_ids=${encodeURIComponent(adId)}`;
  return `${base}/campaigns?${q}&selected_campaign_ids=${encodeURIComponent(campaignId)}`;
}

export async function hasToken() {
  return !!(await getToken());
}

async function token() {
  const t = await getToken();
  if (!t) throw new Error("لا يوجد توكن Meta — اربط الحساب من صفحة الإعدادات");
  return t;
}

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

// BUG-021 fix: Graph API rate-limit errors (app/user/page/custom throttling —
// codes 4/17/32/613, or a bare HTTP 429) used to propagate straight up and
// abort the whole daily sync. Retry those with bounded exponential backoff
// before giving up; every other error still fails immediately as before.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wrap axios so the real Graph API error message surfaces (token expiry, perms…).
export async function fbGet(url, params, attempt = 0) {
  try {
    return await axios.get(url, { params, timeout: 60000 });
  } catch (e) {
    const fb = e.response?.data?.error;
    const rateLimited = e.response?.status === 429 || (fb && RATE_LIMIT_CODES.has(fb.code));
    if (rateLimited && attempt < MAX_RETRIES) {
      const delay = 1000 * 4 ** attempt; // 1s, 4s, 16s
      console.warn(`[meta] rate-limited (${fb?.code ?? e.response?.status}) — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
      await sleep(delay);
      return fbGet(url, params, attempt + 1);
    }
    if (fb) {
      const msg = fb.code === 190
        ? `توكن Meta غير صالح/منتهي: ${fb.message}`
        : rateLimited
        ? `تجاوز حدّ معدّل طلبات Meta API (بعد ${MAX_RETRIES} محاولات): ${fb.message}`
        : `خطأ Meta API: ${fb.message}`;
      throw new Error(msg);
    }
    throw e;
  }
}

async function insights(params) {
  const t = await token();
  let url = `${API()}/act_${acctOrThrow()}/insights`;
  let q = { ...params, access_token: t };
  const out = [];
  while (url) {
    const r = await fbGet(url, q);
    const j = r.data;
    out.push(...(j.data || []));
    url = j.paging?.next || null;
    q = {}; // 'next' is fully-qualified
  }
  return out;
}

// BUG-016 fix: previously every objective was counted against the single
// hardcoded `messaging_conversation_started_7d` action type. A lead-gen
// campaign in this account ("LP 2026 Ads", objective OUTCOME_LEADS) reports
// 1,925 real website leads that were silently counted as 0 results because
// its actions never contain that message-specific action type.
//
// The `offsite_conversion.fb_pixel_lead` mapping below is NOT a guess — it
// was confirmed via a live Graph API call on this account
// (result_values indicator = "action_values:offsite_conversion.fb_pixel_lead"
// for campaign 120238871357660125). The onsite_conversion.lead_grouped/"lead"
// fallbacks cover accounts using Instant Forms or a differently-configured
// pixel instead of a website pixel event; extend this list if a new
// objective/setup appears with an unrecognized action_type.
export const OBJECTIVE_RESULT_TYPES = {
  OUTCOME_LEADS: [
    { type: "offsite_conversion.fb_pixel_lead", label: "Website leads" },
    { type: "onsite_conversion.lead_grouped", label: "Leads" },
    { type: "lead", label: "Leads" },
  ],
  OUTCOME_ENGAGEMENT: [{ type: MSG_RESULT, label: "Messaging conversations started" }],
};
const DEFAULT_RESULT_TYPES = [{ type: MSG_RESULT, label: "Messaging conversations started" }];

export function resultTypesFor(objective) {
  return OBJECTIVE_RESULT_TYPES[objective] || DEFAULT_RESULT_TYPES;
}

function resultCount(row, objective) {
  const actions = row.actions || [];
  for (const { type } of resultTypesFor(objective)) {
    const a = actions.find((x) => x.action_type === type);
    if (a) return Math.round(Number(a.value));
  }
  return 0;
}

/** Which candidate result type actually matched (for a human-readable label). */
function resultLabel(row, objective) {
  const actions = row.actions || [];
  const candidates = resultTypesFor(objective);
  const matched = candidates.find(({ type }) => actions.some((x) => x.action_type === type));
  return (matched || candidates[0]).label;
}

function costPerResult(row, results, objective) {
  const costs = row.cost_per_action_type || [];
  for (const { type } of resultTypesFor(objective)) {
    const a = costs.find((x) => x.action_type === type);
    if (a) return num(a.value);
  }
  const sp = num(row.spend);
  return sp && results ? Math.round((sp / results) * 1000) / 1000 : null;
}

const BASE_FIELDS = "spend,impressions,reach,clicks,ctr,cpc,cpm,frequency";
const ACT_FIELDS = BASE_FIELDS + ",actions,cost_per_action_type";

// BUG-020 fix: a single `limit:500` call silently dropped every entity past
// the 500th (no pagination). Follow `paging.next` like insights() does —
// accounts with more than 500 ads/adsets would otherwise get wrong/missing
// statuses with no error at all.
async function statusMap(entityPath) {
  const map = {};
  let url = `${API()}/act_${acctOrThrow()}/${entityPath}`;
  let params = { fields: "effective_status", limit: 500, access_token: await token() };
  while (url) {
    const r = await fbGet(url, params);
    for (const a of r.data.data || []) map[a.id] = a.effective_status;
    url = r.data.paging?.next || null;
    params = {}; // 'next' is fully-qualified, same pattern as insights()
  }
  return map;
}

async function effectiveStatusMap() {
  return statusMap("ads");
}

/**
 * Sharp cover frames for video creatives, video_id -> image URL.
 * The creative-level thumbnail_url of a VIDEO ad — even with
 * thumbnail_width(1080) — is an UPSCALE of a small preview crop, so it passes
 * a pixel-dimension check while still looking blurry on a card. The video
 * node's own /thumbnails edge returns the real source-resolution covers
 * (measured 1440x2560 on this account). Per-video failures are non-fatal:
 * the ad just keeps its sized-thumbnail fallback.
 */
async function videoCovers(videoIds) {
  const covers = {};
  const t = await token();
  for (const vid of videoIds) {
    try {
      const r = await fbGet(`${API()}/${vid}/thumbnails`, { access_token: t });
      const th = r.data.data || [];
      const best = th.find((x) => x.is_preferred)
        || th.reduce((a, b) => ((b.width || 0) > (a?.width || 0) ? b : a), null);
      if (best?.uri) covers[vid] = best.uri;
    } catch (e) { console.warn(`[meta] video ${vid} thumbnails skipped:`, e.message); }
  }
  return covers;
}

/**
 * ad_id -> { url, body, media_type } for the posts/highlights display +
 * content analysis.
 * - url: creative image. Signed Meta CDN URLs that eventually expire —
 *   acceptable because the daily sync refreshes them; never permanent links.
 *   For video ads the sharp cover comes from videoCovers() above.
 * - body: the REAL post text (the caption shown under/above the ad) — from
 *   creative.body, or the object_story_spec's link/video message. This is
 *   what content analysis must read; the ad NAME is just an internal label
 *   and can be actively misleading about what the post actually says.
 * - media_type: video | carousel | image. Detection must NOT rely on
 *   object_story_spec alone: ads promoting an EXISTING post (this account's
 *   normal setup) carry only object_story_id, so their spec is empty — for
 *   those, creative.object_type === "VIDEO" / creative.video_id is the signal.
 */
export async function adCreatives() {
  const map = {};
  const videoOf = {}; // ad_id -> video_id, for ads still lacking a sharp cover
  let url = `${API()}/act_${acctOrThrow()}/ads`;
  let params = {
    fields: "creative.thumbnail_width(1080).thumbnail_height(1080){image_url,thumbnail_url,body,title,object_type,video_id,object_story_spec{link_data{message,name,description,picture,child_attachments{picture}},video_data{message,title,image_url,video_id}}}",
    limit: 500, access_token: await token(),
  };
  while (url) {
    const r = await fbGet(url, params);
    for (const a of r.data.data || []) {
      const c = a.creative || {};
      const oss = c.object_story_spec || {};
      const body = c.body || oss.link_data?.message || oss.video_data?.message
        || oss.link_data?.description || c.title || oss.link_data?.name || oss.video_data?.title || null;
      const videoId = c.video_id || oss.video_data?.video_id || null;
      const media_type = (videoId || c.object_type === "VIDEO" || oss.video_data) ? "video"
        : oss.link_data?.child_attachments?.length ? "carousel" : "image";
      const sharp = c.image_url || oss.video_data?.image_url || oss.link_data?.picture
        || oss.link_data?.child_attachments?.[0]?.picture || null;
      const img = sharp || c.thumbnail_url || null;
      if (img || body) map[a.id] = { url: img, body, media_type };
      if (media_type === "video" && !sharp && videoId && map[a.id]) videoOf[a.id] = videoId;
    }
    url = r.data.paging?.next || null;
    params = {}; // 'next' is fully-qualified, same pattern as statusMap()
  }
  const covers = await videoCovers([...new Set(Object.values(videoOf))]);
  for (const [adId, vid] of Object.entries(videoOf)) {
    if (covers[vid]) map[adId].url = covers[vid];
  }
  return map;
}

async function adsetStatusMap() {
  return statusMap("adsets");
}

/** Ad-level period totals (no time_increment) -> ads_meta_ad_perf rows. */
export async function adPeriod(since, until) {
  const esmap = await effectiveStatusMap();
  const rows = await insights({
    level: "ad",
    fields: `ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,objective,${ACT_FIELDS}`,
    time_range: JSON.stringify({ since, until }),
  });
  return rows.map((r) => {
    const res = resultCount(r, r.objective);
    return {
      ad_id: r.ad_id, ad_name: r.ad_name, adset_id: r.adset_id, adset_name: r.adset_name,
      campaign_id: r.campaign_id, campaign_name: r.campaign_name,
      status: esmap[r.ad_id] || null, spend: num(r.spend), impressions: num(r.impressions) || 0,
      reach: num(r.reach) || 0,
      clicks: num(r.clicks) || 0, ctr: num(r.ctr), cpc: num(r.cpc), cpm: num(r.cpm),
      frequency: num(r.frequency), results: res, cpr: costPerResult(r, res, r.objective),
    };
  });
}

/** Ad-set-level period totals -> ads_meta_adset_perf rows. */
export async function adsetPeriod(since, until) {
  const esmap = await adsetStatusMap();
  const rows = await insights({
    level: "adset",
    fields: `adset_id,adset_name,campaign_id,campaign_name,objective,${ACT_FIELDS}`,
    time_range: JSON.stringify({ since, until }),
  });
  return rows.map((r) => {
    const res = resultCount(r, r.objective);
    return {
      adset_id: r.adset_id, adset_name: r.adset_name, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
      status: esmap[r.adset_id] || null, spend: num(r.spend), impressions: num(r.impressions) || 0,
      clicks: num(r.clicks) || 0, ctr: num(r.ctr), cpc: num(r.cpc), cpm: num(r.cpm),
      frequency: num(r.frequency), result_type: resultLabel(r, r.objective),
      results: res, cpr: costPerResult(r, res, r.objective),
    };
  });
}

/** Campaign-level period totals -> ads_meta_campaign_perf rows. */
export async function campaignPeriod(since, until) {
  const rows = await insights({
    level: "campaign",
    fields: `campaign_id,campaign_name,objective,${ACT_FIELDS}`,
    time_range: JSON.stringify({ since, until }),
  });
  return rows.map((r) => {
    const res = resultCount(r, r.objective);
    return {
      campaign_id: r.campaign_id, campaign_name: r.campaign_name, objective: r.objective, status: null,
      spend: num(r.spend), impressions: num(r.impressions) || 0, clicks: num(r.clicks) || 0,
      ctr: num(r.ctr), cpm: num(r.cpm), frequency: num(r.frequency),
      result_type: resultLabel(r, r.objective), results: res, cpr: costPerResult(r, res, r.objective),
    };
  });
}

/** Daily campaign series (time_increment=1) -> ads_meta_daily (level='campaign'). */
export async function campaignDaily(since, until) {
  const rows = await insights({
    level: "campaign",
    fields: `campaign_id,campaign_name,objective,${ACT_FIELDS}`,
    time_range: JSON.stringify({ since, until }),
    time_increment: 1,
  });
  return rows.map((r) => {
    const res = resultCount(r, r.objective);
    return {
      date: r.date_start, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
      spend: num(r.spend), impressions: num(r.impressions) || 0, reach: num(r.reach) || 0,
      clicks: num(r.clicks) || 0, frequency: num(r.frequency),
      results: res, cpr: costPerResult(r, res, r.objective),
    };
  });
}

// BUG-023 fix: ads_meta_daily was only ever populated at level='campaign', so
// date-filtered spend/results below the campaign level was impossible even
// though the table itself is already level-polymorphic (`level`+`entity_id`,
// see schema.sql) — this was a missing ingest call, not a schema gap.
// Mechanically identical to campaignDaily, just at level="ad"/"adset".

/** Daily ad series (time_increment=1) -> ads_meta_daily (level='ad'). */
export async function adDaily(since, until) {
  const rows = await insights({
    level: "ad",
    fields: `ad_id,ad_name,campaign_id,objective,${ACT_FIELDS}`,
    time_range: JSON.stringify({ since, until }),
    time_increment: 1,
  });
  return rows.map((r) => {
    const res = resultCount(r, r.objective);
    return {
      date: r.date_start, ad_id: r.ad_id, ad_name: r.ad_name, campaign_id: r.campaign_id,
      spend: num(r.spend), impressions: num(r.impressions) || 0, reach: num(r.reach) || 0,
      clicks: num(r.clicks) || 0, frequency: num(r.frequency),
      results: res, cpr: costPerResult(r, res, r.objective),
    };
  });
}

/** Daily ad-set series (time_increment=1) -> ads_meta_daily (level='adset'). */
export async function adsetDaily(since, until) {
  const rows = await insights({
    level: "adset",
    fields: `adset_id,adset_name,campaign_id,objective,${ACT_FIELDS}`,
    time_range: JSON.stringify({ since, until }),
    time_increment: 1,
  });
  return rows.map((r) => {
    const res = resultCount(r, r.objective);
    return {
      date: r.date_start, adset_id: r.adset_id, adset_name: r.adset_name, campaign_id: r.campaign_id,
      spend: num(r.spend), impressions: num(r.impressions) || 0, reach: num(r.reach) || 0,
      clicks: num(r.clicks) || 0, frequency: num(r.frequency),
      results: res, cpr: costPerResult(r, res, r.objective),
    };
  });
}

/**
 * Daily spend/impressions/clicks split by AUDIENCE country (Meta's `country`
 * breakdown, reported as ISO-2). Populates ads_meta_country_daily so the
 * country report can show cost-per-lead per country. Note the country here is
 * where Meta served the impression, which broadly matches — but is not
 * guaranteed identical to — the customer's phone country used on the Wati side.
 */
export async function countryDaily(since, until) {
  const rows = await insights({
    level: "account",
    fields: BASE_FIELDS,
    breakdowns: "country",
    time_range: JSON.stringify({ since, until }),
    time_increment: 1,
  });
  return rows.map((r) => ({
    date: r.date_start, country: r.country,
    spend: num(r.spend), impressions: num(r.impressions) || 0, clicks: num(r.clicks) || 0,
    ctr: num(r.ctr), cpc: num(r.cpc), cpm: num(r.cpm),
  }));
}

/** Monthly campaign series -> ads_meta_month. */
export async function campaignMonthly(since, until) {
  const rows = await insights({
    level: "campaign",
    fields: `campaign_id,objective,${ACT_FIELDS}`,
    time_range: JSON.stringify({ since, until }),
    time_increment: "monthly",
  });
  return rows.map((r) => ({
    month: (r.date_start || "").slice(0, 7), campaign_id: r.campaign_id,
    spend: num(r.spend), impressions: num(r.impressions) || 0, clicks: num(r.clicks) || 0,
    results: resultCount(r, r.objective),
  }));
}

export default { hasToken, fbGet, adPeriod, adsetPeriod, campaignPeriod, campaignDaily, adDaily, adsetDaily, campaignMonthly, countryDaily, adCreatives, adsManagerUrl };
