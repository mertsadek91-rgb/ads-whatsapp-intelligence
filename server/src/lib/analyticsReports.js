// Shared data-gathering for the country analysis and the Campaign→AdSet→Ad
// hierarchy, so BOTH the on-screen routes (routes/analytics.js) and the emailed
// campaign PDF (lib/campaignReport.js via weeklyReports.js) render from one
// source of truth instead of duplicating the SQL + aggregation.
import { query } from "../db.js";
import { countryOf } from "./phoneCountry.js";
import { adsManagerUrl } from "./meta.js";
import config from "../config.js";

// Read per call, not captured at import — the ad account is chosen during
// setup and can be changed later without restarting.
const ACCT = () => config.meta.accountId;
const QUAL = "('qualified','interested','demo','deposit')";
const QSET = new Set(["qualified", "interested", "demo", "deposit"]);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
function frag(col, since, until) {
  const parts = [], params = [];
  if (isDate(since)) { parts.push(`${col} >= ?`); params.push(since); }
  if (isDate(until)) { parts.push(`${col} <= ?`); params.push(until); }
  return { sql: parts.join(" and "), params };
}

/** Per-country leads (phone-derived) + interested + Meta spend + verdict. */
export async function gatherCountries(since, until) {
  const f = frag("created_date", since, until);
  const contacts = await query(
    `select c.phone, c.stage, c.deposit_flag, c.source_ad_id,
            case when m.conv_type='human_handled' or m.human_replied=1 then 1 else 0 end human_contacted
     from ads_wati_contacts c left join ads_conversation_meta m on m.wa_id = c.wa_id
     ${f.sql ? "where " + f.sql.replace(/created_date/g, "c.created_date") : ""}`, f.params);
  const adMap = Object.fromEntries(
    (await query("select ad_id, campaign_name from ads_meta_ad_perf")).map((a) => [a.ad_id, a.campaign_name]));

  const byC = {};
  for (const c of contacts) {
    const co = countryOf(c.phone);
    const key = co.iso2 || "unknown";
    const g = (byC[key] ||= { iso2: co.iso2, ar: co.ar, en: co.en, flag: co.flag,
      contacts: 0, contacted: 0, qualified: 0, deposits: 0, _camps: {} });
    g.contacts++;
    if (c.human_contacted === 1) g.contacted++;
    if (QSET.has(c.stage)) g.qualified++;
    if (c.deposit_flag === 1) g.deposits++;
    const cn = adMap[c.source_ad_id];
    if (cn) g._camps[cn] = (g._camps[cn] || 0) + 1;
  }

  const sf = frag("`date`", since, until);
  const spendRows = await query(
    `select country, sum(spend_aed) spend from ads_meta_country_daily
     ${sf.sql ? "where " + sf.sql : ""} group by country`, sf.params);
  const spendByIso = Object.fromEntries(spendRows.map((s) => [s.country, Number(s.spend) || 0]));

  // Which employees work each country (from the directory) -> iso2: [names].
  const empByIso = {};
  const emps = await query(
    "select coalesce(nullif(full_name,''), owner_name) name, countries from ads_employees where active=1 and countries is not null");
  for (const e of emps) {
    if (!e.name) continue;
    const list = typeof e.countries === "string" ? JSON.parse(e.countries || "[]") : (e.countries || []);
    for (const iso of list) (empByIso[iso] ||= []).push(e.name);
  }

  let rows = Object.values(byC).map((g) => {
    const spend = g.iso2 ? (spendByIso[g.iso2] ?? null) : null;
    const qual_rate_pct = g.contacts ? Math.round((1000 * g.qualified) / g.contacts) / 10 : 0;
    const top_campaigns = Object.entries(g._camps).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([name, n]) => ({ name, n }));
    delete g._camps;
    return {
      ...g, spend_aed: spend, qual_rate_pct,
      cost_per_lead: spend != null && g.contacts ? Math.round((100 * spend) / g.contacts) / 100 : null,
      cost_per_qualified: spend != null && g.qualified ? Math.round((100 * spend) / g.qualified) / 100 : null,
      top_campaigns,
      employees: g.iso2 ? (empByIso[g.iso2] || []) : [],
    };
  });

  const judged = rows.filter((r) => r.contacts >= 10);
  const avgRate = judged.length ? judged.reduce((s, r) => s + r.qual_rate_pct, 0) / judged.length : 0;
  const cplVals = judged.map((r) => r.cost_per_lead).filter((v) => v != null);
  const avgCpl = cplVals.length ? cplVals.reduce((s, v) => s + v, 0) / cplVals.length : null;
  for (const r of rows) {
    if (r.contacts < 10) { r.verdict = "watch"; continue; }
    const goodRate = r.qual_rate_pct >= avgRate;
    const goodCost = avgCpl == null || r.cost_per_lead == null || r.cost_per_lead <= avgCpl;
    r.verdict = goodRate && goodCost ? "keep" : (!goodRate && !goodCost ? "close" : "watch");
  }

  rows.sort((a, b) => b.contacts - a.contacts);
  const totals = {
    countries: rows.length,
    contacts: rows.reduce((s, r) => s + r.contacts, 0),
    qualified: rows.reduce((s, r) => s + r.qualified, 0),
    spend_aed: rows.reduce((s, r) => s + (r.spend_aed || 0), 0),
    has_spend: spendRows.length > 0,
  };
  return { rows, totals };
}

/** Campaign→AdSet→Ad tree with date-filtered spend/results + Wati outcome. */
export async function gatherCampaignTree(since, until) {
  const ads = await query(
    `select ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, status
     from ads_meta_ad_perf`);

  const df = frag("`date`", since, until);
  const daily = await query(
    `select entity_id, sum(spend_aed) spend, sum(results) results,
            sum(impressions) impressions, sum(clicks) clicks
     from ads_meta_daily where level='ad' ${df.sql ? "and " + df.sql : ""} group by entity_id`, df.params);
  const dByAd = Object.fromEntries(daily.map((d) => [d.entity_id, d]));

  const wf = frag("created_date", since, until);
  const wati = await query(
    `select source_ad_id, count(*) contacts,
            sum(case when stage in ${QUAL} then 1 else 0 end) qualified
     from ads_wati_contacts where source_ad_id is not null ${wf.sql ? "and " + wf.sql : ""}
     group by source_ad_id`, wf.params);
  const wByAd = Object.fromEntries(wati.map((w) => [w.source_ad_id, w]));

  const zero = () => ({ spend_aed: 0, results: 0, impressions: 0, clicks: 0, contacts: 0, qualified: 0 });
  const add = (acc, m) => { for (const k of Object.keys(acc)) acc[k] += Number(m[k]) || 0; };

  const camps = {};
  for (const a of ads) {
    const d = dByAd[a.ad_id] || {};
    const w = wByAd[a.ad_id] || {};
    const m = {
      spend_aed: Number(d.spend) || 0, results: Number(d.results) || 0,
      impressions: Number(d.impressions) || 0, clicks: Number(d.clicks) || 0,
      contacts: Number(w.contacts) || 0, qualified: Number(w.qualified) || 0,
    };
    const c = (camps[a.campaign_id] ||= {
      campaign_id: a.campaign_id, name: a.campaign_name, metrics: zero(), adsets: {},
      manage_url: adsManagerUrl(ACCT(), { campaignId: a.campaign_id }),
    });
    const s = (c.adsets[a.adset_id] ||= { adset_id: a.adset_id, name: a.adset_name, metrics: zero(), ads: [] });
    s.ads.push({ ad_id: a.ad_id, name: a.ad_name, status: a.status, metrics: m,
      manage_url: adsManagerUrl(ACCT(), { adId: a.ad_id }) });
    add(s.metrics, m);
    add(c.metrics, m);
  }

  const bySpend = (a, b) => b.metrics.spend_aed - a.metrics.spend_aed || b.metrics.contacts - a.metrics.contacts;
  return Object.values(camps).map((c) => ({
    ...c,
    adsets: Object.values(c.adsets).map((s) => ({ ...s, ads: s.ads.sort(bySpend) })).sort(bySpend),
  })).sort(bySpend);
}

export default { gatherCountries, gatherCampaignTree };
