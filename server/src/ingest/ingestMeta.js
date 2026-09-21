// Meta -> MySQL ingestion. Fills ads_meta_ad_perf, ads_meta_campaign_perf,
// ads_meta_month, ads_meta_daily. Needs META_ACCESS_TOKEN (else skipped).
import * as meta from "../lib/meta.js";
import * as metaAuth from "../lib/metaAuth.js";
import { upsert, query } from "../db.js";
import config from "../config.js";
import { metaSince } from "../lib/dataRange.js";

// Read per run, not at import: the start date is chosen during setup and can be
// changed afterwards from Settings. See lib/dataRange.js for what blank, a date
// and "all" each mean, and why Meta clamps the last of those.
const since = () => metaSince(config);
const AD_COLS = ["ad_id","ad_name","campaign_id","campaign_name","adset_id","adset_name","status","spend_aed",
  "impressions","reach","clicks","ctr_pct","cpc_aed","cpm_aed","frequency","results","cpr_aed","period_since","period_until"];
const ADSET_COLS = ["adset_id","adset_name","campaign_id","campaign_name","status","spend_aed","impressions",
  "clicks","ctr_pct","cpc_aed","cpm_aed","frequency","result_type","results","cpr_aed","period_since","period_until"];
const C_COLS = ["campaign_id","campaign_name","objective","status","spend_aed","impressions","clicks",
  "ctr_pct","cpm_aed","frequency","result_type","results","cpr_aed","period_since","period_until"];
const M_COLS = ["month","campaign_id","spend_aed","impressions","clicks","results"];
const COUNTRY_COLS = ["date","country","spend_aed","impressions","clicks","ctr_pct","cpc_aed","cpm_aed"];
const D_COLS = ["date","level","entity_id","entity_name","campaign_id","spend_aed","impressions",
  "reach","clicks","frequency","results","cost_per_result_aed"];

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** opts: { until, full:bool }. full=true pulls the daily series for the whole period. */
export async function ingestMeta(opts = {}) {
  // keep the token long-lived before using it
  await metaAuth.ensureFresh().catch(() => {});
  if (!(await meta.hasToken())) {
    console.log("[meta] SKIPPED — no Meta token (connect from Settings)");
    return { skipped: true };
  }
  const until = opts.until || daysAgo(1);
  const dailySince = opts.full ? since() : daysAgo(8);

  const ads = await meta.adPeriod(since(), until);
  await upsert("ads_meta_ad_perf", AD_COLS, ads.map((a) => [
    a.ad_id, a.ad_name, a.campaign_id, a.campaign_name, a.adset_id, a.adset_name, a.status, a.spend,
    a.impressions, a.reach, a.clicks, a.ctr, a.cpc, a.cpm, a.frequency, a.results, a.cpr, since(), until,
  ]), ["ad_id"]);

  // Creative image + real post text (caption) for display and content
  // analysis. Non-fatal: a missing permission or transient failure here must
  // never sink the numeric sync — pages just fall back to their no-image
  // placeholder until the next run.
  let creatives = 0;
  try {
    const cmap = await meta.adCreatives();
    for (const [adId, c] of Object.entries(cmap)) {
      await query("update ads_meta_ad_perf set thumbnail_url=?, creative_body=?, media_type=? where ad_id=?",
        [c.url, c.body, c.media_type || null, adId]);
      creatives++;
    }
  } catch (e) { console.warn("[meta] creatives skipped:", e.message); }

  const adsets = await meta.adsetPeriod(since(), until);
  await upsert("ads_meta_adset_perf", ADSET_COLS, adsets.map((s) => [
    s.adset_id, s.adset_name, s.campaign_id, s.campaign_name, s.status, s.spend, s.impressions,
    s.clicks, s.ctr, s.cpc, s.cpm, s.frequency, s.result_type, s.results, s.cpr, since(), until,
  ]), ["adset_id"]);

  const camps = await meta.campaignPeriod(since(), until);
  await upsert("ads_meta_campaign_perf", C_COLS, camps.map((c) => [
    c.campaign_id, c.campaign_name, c.objective, c.status, c.spend, c.impressions, c.clicks,
    c.ctr, c.cpm, c.frequency, c.result_type, c.results, c.cpr, since(), until,
  ]), ["campaign_id"]);

  const months = await meta.campaignMonthly(since(), until);
  await upsert("ads_meta_month", M_COLS, months.map((m) => [
    m.month, m.campaign_id, m.spend, m.impressions, m.clicks, m.results,
  ]), ["month", "campaign_id"]);

  const daily = await meta.campaignDaily(dailySince, until);
  await upsert("ads_meta_daily", D_COLS, daily.map((d) => [
    d.date, "campaign", d.campaign_id, d.campaign_name, d.campaign_id, d.spend,
    d.impressions, d.reach, d.clicks, d.frequency, d.results, d.cpr,
  ]), ["date", "level", "entity_id"]);

  // BUG-023 fix: same table (already level-polymorphic), same date window,
  // now also at ad/adset granularity so spend/results can be date-filtered
  // below the campaign level.
  const adDaily = await meta.adDaily(dailySince, until);
  await upsert("ads_meta_daily", D_COLS, adDaily.map((d) => [
    d.date, "ad", d.ad_id, d.ad_name, d.campaign_id, d.spend,
    d.impressions, d.reach, d.clicks, d.frequency, d.results, d.cpr,
  ]), ["date", "level", "entity_id"]);

  const adsetDaily = await meta.adsetDaily(dailySince, until);
  await upsert("ads_meta_daily", D_COLS, adsetDaily.map((d) => [
    d.date, "adset", d.adset_id, d.adset_name, d.campaign_id, d.spend,
    d.impressions, d.reach, d.clicks, d.frequency, d.results, d.cpr,
  ]), ["date", "level", "entity_id"]);

  // Spend/impressions/clicks split by audience country (for the country report's
  // cost-per-lead). Non-fatal like creatives — a breakdown-permission or
  // transient failure must never sink the numeric sync.
  let countries = 0;
  try {
    const cd = await meta.countryDaily(dailySince, until);
    await upsert("ads_meta_country_daily", COUNTRY_COLS, cd.map((d) => [
      d.date, d.country, d.spend, d.impressions, d.clicks, d.ctr, d.cpc, d.cpm,
    ]), ["date", "country"]);
    countries = cd.length;
  } catch (e) { console.warn("[meta] country daily skipped:", e.message); }

  console.log(`[meta] ads=${ads.length} adsets=${adsets.length} campaigns=${camps.length} months=${months.length} daily=${daily.length}+${adDaily.length}ad+${adsetDaily.length}adset creatives=${creatives} countries=${countries} (until ${until})`);
  return {
    ads: ads.length, adsets: adsets.length, campaigns: camps.length, months: months.length,
    daily: daily.length, adDaily: adDaily.length, adsetDaily: adsetDaily.length, creatives, countries,
  };
}

export default ingestMeta;
