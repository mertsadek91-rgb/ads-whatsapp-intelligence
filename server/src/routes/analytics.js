import { Router } from "express";
import { query } from "../db.js";
import * as ds from "../lib/deepseek.js";
import { normalizeAgentName, UNKNOWN_AGENT, BOT_AGENT } from "../lib/agentName.js";
import { adsManagerUrl } from "../lib/meta.js";
import { gatherCountries, gatherCampaignTree } from "../lib/analyticsReports.js";
import config from "../config.js";
import { wrap } from "../lib/wrap.js";
import { businessContext } from "../lib/promptContext.js";

// Read per call, not captured at import — the ad account is chosen during
// setup and can be changed later without restarting.
const ACCT = () => config.meta.accountId;

const router = Router();

const QUAL = "('qualified','interested','demo','deposit')";
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

/** since/until from query → { since, until } or nulls. */
function range(req) {
  const since = isDate(req.query.since) ? req.query.since : null;
  const until = isDate(req.query.until) ? req.query.until : null;
  return { since, until };
}
/** A `col BETWEEN ? AND ?`-style fragment (open-ended allowed). Returns {sql, params}. */
function dateFrag(col, since, until) {
  const parts = [], params = [];
  if (since) { parts.push(`${col} >= ?`); params.push(since); }
  if (until) { parts.push(`${col} <= ?`); params.push(until); }
  return { sql: parts.join(" and "), params };
}

router.get("/summary", wrap(async (req, res) => {
  const { since, until } = range(req);
  const f = dateFrag("created_date", since, until);
  const w = f.sql ? `where ${f.sql}` : "";
  const [t] = await query(
    `select
      (select coalesce(sum(spend_aed),0) from ads_meta_campaign_perf) spend,
      (select coalesce(sum(results),0) from ads_meta_campaign_perf) convos,
      (select count(*) from ads_wati_contacts ${w}) contacts,
      (select count(*) from ads_wati_contacts ${w ? w + " and" : "where"} source_ad_id is not null) attributed,
      (select count(*) from ads_wati_contacts ${w ? w + " and" : "where"} stage in ${QUAL}) qualified`,
    [...f.params, ...f.params, ...f.params]
  );
  const [r] = await query(
    `select count(*) real_accounts, sum(case when deposit_total_aed>0 then 1 else 0 end) depositors,
            coalesce(sum(deposit_total_aed),0) deposit_total
     from ads_lead_review where account_type='real'`
  );
  const cpq = t.qualified ? Number(t.spend) / t.qualified : null;
  const cpd = r.depositors ? Number(t.spend) / r.depositors : null;
  res.json({ ...t, real_accounts: r.real_accounts, depositors: r.depositors || 0,
    deposit_total: r.deposit_total, cost_per_qualified: cpq, cost_per_depositor: cpd,
    range: { since, until } });
}));

router.get("/campaigns", wrap(async (req, res) => {
  const rows = await query(`select campaign_id,campaign_name,status,spend_aed,impressions,clicks,ctr_pct,result_type,results,cpr_aed
                        from ads_meta_campaign_perf order by spend_aed desc`);
  for (const r of rows) r.manage_url = adsManagerUrl(ACCT(), { campaignId: r.campaign_id });
  res.json(rows);
}));

router.get("/ads", wrap(async (req, res) => {
  const { since, until } = range(req);
  const jf = dateFrag("w.created_date", since, until);
  const joinDate = jf.sql ? ` and ${jf.sql}` : "";
  const having = [];
  const hp = [];
  if (req.query.status) { having.push("p.status = ?"); hp.push(req.query.status); }
  if (req.query.q) { having.push("p.ad_name like ?"); hp.push(`%${req.query.q}%`); }
  if (req.query.minQualified) { having.push("qualified >= ?"); hp.push(Number(req.query.minQualified)); }
  const rows = await query(
    `select p.ad_id, p.campaign_id, p.adset_id,
            p.ad_name, p.campaign_name, p.status, p.spend_aed, p.impressions, p.clicks,
            p.ctr_pct, p.cpc_aed, p.cpm_aed, p.frequency, p.results convos_meta, p.cpr_aed,
            count(w.wa_id) contacts_wati,
            sum(case when w.stage in ${QUAL} then 1 else 0 end) qualified,
            sum(case when w.deposit_flag=1 then 1 else 0 end) deposits,
            round(100.0*count(w.wa_id)/nullif(p.results,0),1) wati_capture_pct,
            round(p.spend_aed / nullif(count(w.wa_id),0),2) cost_per_contact,
            round(100.0*sum(case when w.stage in ${QUAL} then 1 else 0 end)/nullif(count(w.wa_id),0),1) qual_rate_pct,
            round(p.spend_aed / nullif(sum(case when w.stage in ${QUAL} then 1 else 0 end),0),2) cost_per_qualified
     from ads_meta_ad_perf p
     left join ads_wati_contacts w on w.source_ad_id = p.ad_id${joinDate}
     group by p.ad_id, p.campaign_id, p.adset_id, p.ad_name, p.campaign_name, p.status, p.spend_aed, p.impressions, p.clicks,
              p.ctr_pct, p.cpc_aed, p.cpm_aed, p.frequency, p.results, p.cpr_aed
     ${having.length ? "having " + having.join(" and ") : ""}
     order by qualified desc, convos_meta desc`,
    [...jf.params, ...hp]
  );
  for (const r of rows) r.manage_url = adsManagerUrl(ACCT(), { adId: r.ad_id });
  res.json(rows);
}));

// Per-country breakdown: which countries the leads actually came from (derived
// from each contact's phone dial-code, since the Wati country field is empty),
// how many qualified, and Meta's spend served to that country — so the owner
// can see where to keep spending and which country to close a campaign on.
router.get("/countries", wrap(async (req, res) => {
  const { since, until } = range(req);
  res.json(await gatherCountries(since, until));
}));

// Full Campaign -> Ad Set -> Ad hierarchy with date-filtered spend/results
// (from ads_meta_daily) and each node's Wati outcome (contacts + qualified,
// date-filtered on created_date, rolled up from the ad leaves). Lets the owner
// drill from a campaign down to the exact ad and see which layer performs.
router.get("/campaign-tree", wrap(async (req, res) => {
  const { since, until } = range(req);
  res.json(await gatherCampaignTree(since, until));
}));

router.get("/posts", wrap(async (req, res) => {
  const { since, until } = range(req);
  const f = dateFrag("w.created_date", since, until);
  const where = ["w.source_url is not null", "w.source_url <> ''", ...(f.sql ? [f.sql] : [])];
  const wp = [...f.params];
  if (req.query.country) { where.push("w.country = ?"); wp.push(req.query.country); }
  if (req.query.campaignId) { where.push("p.campaign_id = ?"); wp.push(req.query.campaignId); }
  if (req.query.adsetId) { where.push("p.adset_id = ?"); wp.push(req.query.adsetId); }
  // Platform derived from the post URL's host — the one signal that's always
  // present, with no extra Meta permissions needed.
  if (req.query.platform === "instagram") where.push("w.source_url like '%instagram.com%'");
  if (req.query.platform === "facebook") where.push("(w.source_url like '%facebook.com%' or w.source_url like '%fb.watch%')");
  const having = [];
  const hp = [];
  if (req.query.q) { having.push("(post_url like ? or sample_ad like ?)"); hp.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = await query(
    // BUG-024 fix: max(ad_name) arbitrarily picked one ad's name to represent
    // a post that may have been used by several ads — ad_count lets the UI
    // flag "shown ad is one of N" instead of silently implying it's the only one.
    `select w.source_url post_url, max(p.ad_name) sample_ad, count(distinct p.ad_id) ad_count, count(*) contacts,
            max(p.ad_id) ad_id, max(p.campaign_id) campaign_id,
            max(p.thumbnail_url) thumbnail_url, max(p.creative_body) caption, max(p.media_type) media_type,
            max(case when p.status='ACTIVE' then 1 else 0 end) has_active,
            max(case when p.status is not null then 1 else 0 end) has_status,
            sum(case when w.stage in ${QUAL} then 1 else 0 end) qualified,
            sum(case when w.deposit_flag=1 then 1 else 0 end) deposits,
            round(100.0*sum(case when w.stage in ${QUAL} then 1 else 0 end)/nullif(count(*),0),1) qual_rate_pct
     from ads_wati_contacts w
     left join ads_meta_ad_perf p on p.ad_id = w.source_ad_id
     where ${where.join(" and ")}
     group by w.source_url
     ${having.length ? "having " + having.join(" and ") : ""}
     order by qualified desc, contacts desc limit 60`,
    [...wp, ...hp]
  );

  // Delivery status of the post's ads. Booleans over the repeated contacts
  // join are safe (unlike sums): "active" if ANY of the post's ads is
  // currently ACTIVE, "paused" otherwise, null when no ad status is known.
  for (const r of rows) {
    r.ad_status = Number(r.has_status) ? (Number(r.has_active) ? "active" : "paused") : null;
    delete r.has_active; delete r.has_status;
    // A post may back several ads; the deep link opens the ad when we have one,
    // otherwise the campaign — either way it lands the owner on this exact post.
    r.manage_url = adsManagerUrl(ACCT(), { adId: r.ad_id, campaignId: r.campaign_id });
  }

  // Ad-level delivery metrics per post. This CANNOT ride on the contacts join
  // above — there, each ad row repeats once per contact, so sum(p.impressions)
  // would multiply an ad's impressions by its contact count. Aggregate over
  // the DISTINCT (post, ad) pairs instead, then merge by post_url.
  if (rows.length) {
    const metrics = await query(
      `select t.source_url post_url, sum(p.impressions) impressions, sum(p.reach) reach,
              sum(p.clicks) clicks, sum(p.spend_aed) spend_aed,
              round(avg(p.frequency),2) frequency,
              round(100.0*sum(p.clicks)/nullif(sum(p.impressions),0),2) ctr_pct
       from (select distinct source_url, source_ad_id from ads_wati_contacts
             where source_url in (${rows.map(() => "?").join(",")}) and source_ad_id is not null) t
       join ads_meta_ad_perf p on p.ad_id = t.source_ad_id
       group by t.source_url`, rows.map((r) => r.post_url));
    const byUrl = Object.fromEntries(metrics.map((m) => [m.post_url, m]));
    for (const r of rows) {
      const m = byUrl[r.post_url] || {};
      r.impressions = m.impressions != null ? Number(m.impressions) : null;
      r.reach = m.reach != null ? Number(m.reach) : null;
      r.clicks = m.clicks != null ? Number(m.clicks) : null;
      r.spend_aed = m.spend_aed != null ? Number(m.spend_aed) : null;
      r.frequency = m.frequency != null ? Number(m.frequency) : null;
      r.ctr_pct = m.ctr_pct != null ? Number(m.ctr_pct) : null;
    }

    // Stored AI evaluation per post, in the viewer's language.
    const lang = req.query.lang === "en" ? "en" : "ar";
    const evals = await query(
      `select post_url, verdict, score, why, improve from ads_post_insights
       where lang = ? and post_url in (${rows.map(() => "?").join(",")})`,
      [lang, ...rows.map((r) => r.post_url)]);
    const evalByUrl = Object.fromEntries(evals.map((e) => [e.post_url, e]));
    for (const r of rows) {
      const e = evalByUrl[r.post_url] || {};
      r.verdict = e.verdict || null;
      r.ai_score = e.score ?? null;
      r.ai_why = e.why || null;
      r.ai_improve = e.improve || null;
    }
  }
  res.json(rows);
}));

router.get("/agents", wrap(async (req, res) => {
  const { since, until } = range(req);
  const f = dateFrag("created_date", since, until);
  const where = f.sql ? `where ${f.sql}` : "";
  const rows = await query(
    `select coalesce(nullif(contact_owner,''),'(غير مُسند)') agent, count(*) contacts,
            sum(case when stage in ${QUAL} then 1 else 0 end) qualified,
            sum(case when deposit_flag=1 then 1 else 0 end) deposits,
            round(avg(first_response_min),1) avg_first_response_min,
            round(100.0*sum(case when stage in ${QUAL} then 1 else 0 end)/nullif(count(*),0),1) qual_rate_pct
     from ads_wati_contacts ${where}
     group by coalesce(nullif(contact_owner,''),'(غير مُسند)') order by contacts desc`,
    f.params
  );
  res.json(rows);
}));

router.get("/daily", wrap(async (req, res) => {
  const { since, until } = range(req);
  const f = dateFrag("day", since, until);
  const extra = f.sql ? ` and ${f.sql}` : "";
  res.json(await query(
    `select day,spend_aed,convos_meta,contacts,qualified from ads_v_daily
     where spend_aed is not null${extra} order by day desc limit 90`, f.params));
}));

router.get("/monthly", wrap(async (req, res) => {
  res.json(await query(`select month,spend,convos,contacts,qualified from ads_v_monthly order by month`));
}));

// Period-over-period comparison for the dashboard: the last N days vs the N
// days before them (N = 7/30/365). Bucketing happens in SQL against curdate()
// so there is no JS-vs-MySQL date/timezone boundary to get subtly wrong.
router.get("/compare", wrap(async (req, res) => {
  const period = ["week", "month", "year"].includes(req.query.period) ? req.query.period : "month";
  const days = { week: 7, month: 30, year: 365 }[period];
  const buckets = await query(
    `select case when day >= (curdate() - interval ? day) then 'cur' else 'prev' end bucket,
            coalesce(sum(spend_aed),0) spend, coalesce(sum(contacts),0) contacts, coalesce(sum(qualified),0) qualified
     from ads_v_daily
     where day >= (curdate() - interval ? day)
     group by 1`, [days - 1, days * 2 - 1]);
  const bestRows = await query(
    `select day, contacts, qualified from ads_v_daily
     where day >= (curdate() - interval ? day)
     order by qualified desc, contacts desc limit 1`, [days - 1]);

  const raw = { cur: { spend: 0, contacts: 0, qualified: 0 }, prev: { spend: 0, contacts: 0, qualified: 0 } };
  for (const b of buckets) {
    if (raw[b.bucket]) raw[b.bucket] = { spend: Number(b.spend), contacts: Number(b.contacts), qualified: Number(b.qualified) };
  }
  const derive = (o) => ({
    ...o,
    cost_per_contact: o.contacts ? Math.round((o.spend / o.contacts) * 100) / 100 : null,
    cost_per_qualified: o.qualified ? Math.round((o.spend / o.qualified) * 100) / 100 : null,
    avg_daily_contacts: Math.round((o.contacts / days) * 10) / 10,
  });
  const cur = derive(raw.cur), prev = derive(raw.prev);
  // % change; null (not 0) when the previous period has no base to compare against.
  const pct = (a, b) => (a != null && b ? Math.round(((a - b) / b) * 1000) / 10 : null);

  res.json({
    period, days,
    current: {
      ...cur,
      best_day: bestRows.length
        ? { day: bestRows[0].day, contacts: Number(bestRows[0].contacts), qualified: Number(bestRows[0].qualified) }
        : null,
    },
    previous: prev,
    change: {
      spend_pct: pct(cur.spend, prev.spend),
      contacts_pct: pct(cur.contacts, prev.contacts),
      qualified_pct: pct(cur.qualified, prev.qualified),
      cost_per_contact_pct: pct(cur.cost_per_contact, prev.cost_per_contact),
      cost_per_qualified_pct: pct(cur.cost_per_qualified, prev.cost_per_qualified),
    },
  });
}));

// BUG-023 fix: ads_meta_daily is now also populated at level='ad'/'adset'
// (ingestMeta.js), so date-filtered spend/results is possible below the
// campaign level — this route is how the UI can query it per entity.
router.get("/entity-daily", wrap(async (req, res) => {
  const level = ["ad", "adset", "campaign"].includes(req.query.level) ? req.query.level : "ad";
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id مطلوب" });
  const { since, until } = range(req);
  const f = dateFrag("`date`", since, until);
  const extra = f.sql ? ` and ${f.sql}` : "";
  res.json(await query(
    `select \`date\`, entity_name, spend_aed, impressions, clicks, results, cost_per_result_aed
     from ads_meta_daily where level = ? and entity_id = ?${extra} order by \`date\``,
    [level, id, ...f.params]
  ));
}));

router.get("/weekly", wrap(async (req, res) => {
  const { since, until } = range(req);
  const f = dateFrag("created_date", since, until);
  const where = f.sql ? `and ${f.sql}` : "";
  res.json(await query(
    `select date_format(created_date - interval weekday(created_date) day,'%Y-%m-%d') wk,
            count(*) contacts, sum(case when stage in ${QUAL} then 1 else 0 end) qualified
     from ads_wati_contacts where created_date is not null ${where}
     group by wk order by wk desc limit 26`, f.params));
}));

// ---- dashboard highlights: best campaign / best ad / best post ----
// "Best" = most qualified customers actually produced (the business outcome),
// tie-broken by cost efficiency — not raw clicks/impressions, which reward
// spend rather than results.
router.get("/highlights", wrap(async (req, res) => {
  const { since, until } = range(req);
  const jf = dateFrag("w.created_date", since, until);
  const joinDate = jf.sql ? ` and ${jf.sql}` : "";

  const [bestCampaign] = await query(
    `select p.campaign_id, p.campaign_name, max(p2.spend_aed) spend_aed, max(p2.results) results, max(p2.cpr_aed) cpr_aed,
            count(w.wa_id) contacts,
            sum(case when w.stage in ${QUAL} then 1 else 0 end) qualified,
            round(max(p2.spend_aed) / nullif(sum(case when w.stage in ${QUAL} then 1 else 0 end),0),2) cost_per_qualified
     from ads_meta_ad_perf p
     join ads_meta_campaign_perf p2 on p2.campaign_id = p.campaign_id
     left join ads_wati_contacts w on w.source_ad_id = p.ad_id${joinDate}
     group by p.campaign_id, p.campaign_name
     order by qualified desc, contacts desc limit 1`, jf.params);

  const [bestAd] = await query(
    `select p.ad_id, p.ad_name, p.campaign_name, p.thumbnail_url, p.spend_aed,
            count(w.wa_id) contacts,
            sum(case when w.stage in ${QUAL} then 1 else 0 end) qualified,
            round(p.spend_aed / nullif(sum(case when w.stage in ${QUAL} then 1 else 0 end),0),2) cost_per_qualified
     from ads_meta_ad_perf p
     left join ads_wati_contacts w on w.source_ad_id = p.ad_id${joinDate}
     group by p.ad_id, p.ad_name, p.campaign_name, p.thumbnail_url, p.spend_aed
     order by qualified desc, contacts desc limit 1`, jf.params);

  const pf = dateFrag("w.created_date", since, until);
  const postWhere = ["w.source_url is not null", "w.source_url <> ''", ...(pf.sql ? [pf.sql] : [])];
  const [bestPost] = await query(
    `select w.source_url post_url, max(p.ad_name) sample_ad, max(p.thumbnail_url) thumbnail_url,
            count(*) contacts,
            sum(case when w.stage in ${QUAL} then 1 else 0 end) qualified,
            round(100.0*sum(case when w.stage in ${QUAL} then 1 else 0 end)/nullif(count(*),0),1) qual_rate_pct
     from ads_wati_contacts w
     left join ads_meta_ad_perf p on p.ad_id = w.source_ad_id
     where ${postWhere.join(" and ")}
     group by w.source_url
     order by qualified desc, contacts desc limit 1`, pf.params);

  res.json({ best_campaign: bestCampaign || null, best_ad: bestAd || null, best_post: bestPost || null });
}));

// ---- employee ranking for the dashboard (week/month) ----
// Ranked by business results (hot+warm conversations produced), tie-broken by
// avg agent score. Bot/unknown buckets are excluded — a bot can't be employee
// of the week. Doc 13's min-N fairness gate applies to the WINNER title: an
// agent below MIN_N conversations can appear in the list but can't "win".
router.get("/employee-ranking", wrap(async (req, res) => {
  const period = ["week", "month"].includes(req.query.period) ? req.query.period : "month";
  const days = period === "week" ? 7 : 30;
  const MIN_N = period === "week" ? 5 : 10;

  const owners = (await query(
    "select distinct contact_owner v from ads_wati_contacts where contact_owner is not null and contact_owner <> ''"
  )).map((r) => r.v);
  const rows = await query(
    `select coalesce(nullif(a.agent_name,''),'(غير معروف)') agent, a.agent_score, a.lead_intent, a.wrong_persuasion
     from ads_conversation_analysis a
     join ads_wati_contacts c on c.wa_id = a.wa_id
     where c.last_message_at >= (curdate() - interval ? day)`, [days - 1]);

  const byAgent = {};
  for (const r of rows) {
    const name = normalizeAgentName(r.agent, owners);
    if (name === BOT_AGENT || name === UNKNOWN_AGENT) continue;
    const a = (byAgent[name] ||= { agent: name, conversations: 0, scoreSum: 0, scoreN: 0, hot: 0, warm: 0, wrong_persuasion: 0 });
    a.conversations++;
    if (Number.isFinite(Number(r.agent_score))) { a.scoreSum += Number(r.agent_score); a.scoreN++; }
    if (r.lead_intent === "hot") a.hot++;
    if (r.lead_intent === "warm") a.warm++;
    if (r.wrong_persuasion) a.wrong_persuasion++;
  }
  const ranking = Object.values(byAgent).map((a) => ({
    agent: a.agent, conversations: a.conversations,
    avg_score: a.scoreN ? Math.round((a.scoreSum / a.scoreN) * 10) / 10 : null,
    hot: a.hot, warm: a.warm, results: a.hot + a.warm, wrong_persuasion: a.wrong_persuasion,
  })).sort((x, y) => (y.results - x.results) || ((y.avg_score || 0) - (x.avg_score || 0)));

  const winner = ranking.find((a) => a.conversations >= MIN_N) || null;
  res.json({ period, days, min_n: MIN_N, winner, ranking: ranking.slice(0, 10) });
}));

// ---- AI post insights: why did the top posts work? ----
// Text-signal analysis (ad copy/names, capture + qualification stats, and what
// customers attributed to each post actually asked for in their analyzed
// conversations). It does NOT see the image pixels — DeepSeek is text-only —
// so "image content" reasoning is inferred from the ad copy, stated honestly
// in the prompt so the model doesn't hallucinate visual details.
router.get("/post-insights", wrap(async (req, res) => {
  const lang = req.query.lang === "en" ? "en" : "ar";
  const r = await query("select data, generated_at from ads_ai_insights where k = ?", [`posts:${lang}`]);
  if (!r.length) return res.json({ generated: false });
  const data = typeof r[0].data === "string" ? JSON.parse(r[0].data) : r[0].data;
  res.json({ generated: true, generated_at: r[0].generated_at, ...data });
}));

// Two-phase evaluation of EVERY post (not just the winners):
//   Phase 1 — derive the "success playbook" (general content lessons) from
//   the top posts by qualified customers.
//   Phase 2 — judge every post AGAINST that playbook in batches, so weak ads
//   are evaluated with the winning formula in hand (verdict + score + why +
//   one concrete improvement each), persisted per post per language in
//   ads_post_insights.
const VERDICTS = new Set(["successful", "average", "unsuccessful"]);

router.post("/post-insights", wrap(async (req, res) => {
  if (!ds.hasKey()) return res.status(400).json({ error: "لا يوجد مفتاح DeepSeek" });
  const lang = req.body?.lang === "en" ? "en" : "ar";
  const en = lang === "en";

  const posts = await query(
    `select w.source_url post_url, max(p.ad_name) sample_ad, count(*) contacts,
            sum(case when w.stage in ${QUAL} then 1 else 0 end) qualified,
            round(100.0*sum(case when w.stage in ${QUAL} then 1 else 0 end)/nullif(count(*),0),1) qual_rate_pct
     from ads_wati_contacts w
     left join ads_meta_ad_perf p on p.ad_id = w.source_ad_id
     where w.source_url is not null and w.source_url <> ''
     group by w.source_url order by qualified desc, contacts desc limit 100`);
  if (!posts.length) return res.status(400).json({ error: "لا توجد بوستات بعد." });

  // The REAL post text (captions) — the primary content signal. A live
  // incident proved why: an ad NAMED "الوعود بالأرباح السريعة" actually WARNS
  // AGAINST profit promises; analyzing the name alone inverted its meaning.
  const captionRows = await query(
    `select distinct w.source_url post_url, p.creative_body
     from ads_wati_contacts w join ads_meta_ad_perf p on p.ad_id = w.source_ad_id
     where w.source_url in (${posts.map(() => "?").join(",")}) and p.creative_body is not null`,
    posts.map((p) => p.post_url));
  const captionsByPost = {};
  for (const r of captionRows) {
    const list = (captionsByPost[r.post_url] ||= []);
    if (list.length < 2) list.push(String(r.creative_body).slice(0, 700));
  }

  // What the customers each post brought actually wanted (from their analyses).
  const needsRows = await query(
    `select w.source_url post_url, a.customer_details
     from ads_wati_contacts w join ads_conversation_analysis a on a.wa_id = w.wa_id
     where w.source_url in (${posts.map(() => "?").join(",")})`, posts.map((p) => p.post_url));
  const needsByPost = {};
  for (const r of needsRows) {
    const cd = typeof r.customer_details === "string" ? JSON.parse(r.customer_details || "{}") : (r.customer_details || {});
    const list = (needsByPost[r.post_url] ||= []);
    if (cd.needs && list.length < 6) list.push(String(cd.needs).slice(0, 120));
  }
  const enrich = (p) => ({
    ...p,
    post_text: captionsByPost[p.post_url] || [],
    customer_needs: needsByPost[p.post_url] || [],
  });

  const honesty = en
    ? `Your PRIMARY content source is post_text — the REAL caption written on the post. The internal ad label (sample_ad) is NOT content and can be misleading (e.g. an ad labeled "promises of quick profits" whose actual caption WARNS AGAINST profit promises) — never infer the post's message from the label; if post_text is empty, say the content is unavailable rather than guessing. You cannot see images/video — do not invent visual details.`
    : `مصدرك الأساسي للمحتوى هو post_text — النص الحقيقي المكتوب على البوست. أما sample_ad فهو مجرد تسمية داخلية للإعلان وليست محتوى، وقد تكون مضلّلة (مثال حقيقي: إعلان مسمّى "الوعود بالأرباح السريعة" نصّه الفعلي يحذّر من الوعود بالأرباح) — لا تستنتج رسالة البوست من التسمية أبداً؛ وإن كان post_text فارغاً فقُل إن المحتوى غير متاح بدل التخمين. لا يمكنك رؤية الصور/الفيديو — لا تختلق تفاصيل بصرية.`;

  // ---- Phase 1: the success playbook from the winners ----
  const top = posts.slice(0, 10).map(enrich);
  const lessonsSystem = (en
    ? `${businessContext("en")}
You are a Meta ads content strategist for this company. Derive what makes this account's WINNING posts work. `
    : `${businessContext("ar")}
أنت خبير استراتيجية محتوى إعلانات Meta لهذه الشركة. استخلص ما الذي يجعل بوستات هذا الحساب الرابحة تنجح. `) + honesty
    + (en ? ` Reply in English, JSON only.` : ` أجب بالعربية وبصيغة JSON فقط.`);
  const lessonsUser = (en
    ? `Top posts by qualified customers:\n`
    : `أفضل البوستات حسب العملاء المؤهّلين:\n`) + JSON.stringify(top).slice(0, 40000) + (en
    ? `\n\nProduce JSON exactly like:\n{ "overall": ["4-6 specific content lessons that define this account's winning formula"] }`
    : `\n\nأنتج JSON بهذا الشكل بالضبط:\n{ "overall": ["4-6 دروس محتوى محدّدة تُعرّف وصفة النجاح لهذا الحساب"] }`);
  const lessons = await ds.chatJSON(lessonsSystem, lessonsUser, "post-insights:lessons");
  const playbook = Array.isArray(lessons.overall) ? lessons.overall : [];
  await query(
    `insert into ads_ai_insights (k, data) values (?, ?) as new on duplicate key update data=new.data, generated_at=now()`,
    [`posts:${lang}`, JSON.stringify({ overall: playbook })]
  );

  // ---- Phase 2: judge EVERY post against the playbook, in batches ----
  const judgeSystem = (en
    ? `${businessContext("en")}
You are a Meta ads content reviewer for this company. Judge EACH post against this account's proven winning formula:\n${playbook.map((l) => "- " + l).join("\n")}\n`
    : `${businessContext("ar")}
أنت مُقيِّم محتوى إعلانات Meta لهذه الشركة. قيِّم كل بوست مقابل وصفة النجاح المثبتة لهذا الحساب:\n${playbook.map((l) => "- " + l).join("\n")}\n`) + honesty
    + (en ? ` Reply in English, JSON only.` : ` أجب بالعربية وبصيغة JSON فقط.`);
  let evaluated = 0, failedChunks = 0;
  for (let i = 0; i < posts.length; i += 12) {
    const chunk = posts.slice(i, i + 12).map(enrich);
    const judgeUser = (en
      ? `Posts to judge (stats + real captions + what their customers asked for):\n`
      : `البوستات المطلوب تقييمها (الأرقام + النصوص الحقيقية + ما طلبه عملاؤها):\n`)
      + JSON.stringify(chunk).slice(0, 40000) + (en
      ? `\n\nProduce JSON exactly like:\n{ "posts": [{"post_url":"...","verdict":"successful|average|unsuccessful","score":0-100,"why":"2 sentences: why it worked or underperformed vs the winning formula","improve":"one concrete suggestion"}] }\nJudge every post in the input.`
      : `\n\nأنتج JSON بهذا الشكل بالضبط:\n{ "posts": [{"post_url":"...","verdict":"successful|average|unsuccessful","score":0-100,"why":"جملتان: لماذا نجح أو قصّر مقارنةً بوصفة النجاح","improve":"اقتراح ملموس واحد"}] }\nقيِّم كل بوست في المدخلات.`);
    try {
      const out = await ds.chatJSON(judgeSystem, judgeUser, `post-insights:judge:${i / 12 + 1}`);
      for (const p of out.posts || []) {
        if (!p.post_url) continue;
        const verdict = VERDICTS.has(p.verdict) ? p.verdict : "average";
        const score = Number.isFinite(Number(p.score)) ? Math.max(0, Math.min(100, Math.round(Number(p.score)))) : null;
        await query(
          `insert into ads_post_insights (post_url, lang, verdict, score, why, improve) values (?,?,?,?,?,?)
           as new on duplicate key update verdict=new.verdict, score=new.score, why=new.why, improve=new.improve, generated_at=now()`,
          [String(p.post_url).slice(0, 512), lang, verdict, score,
           String(p.why || "").slice(0, 2000), String(p.improve || "").slice(0, 2000)]);
        evaluated++;
      }
    } catch (e) {
      // Budget cap or a bad chunk — keep what we have; the next run resumes.
      failedChunks++;
      console.warn(`[post-insights] chunk ${i / 12 + 1} failed:`, e.message);
    }
  }

  res.json({ generated: true, generated_at: new Date(), overall: playbook, evaluated, total: posts.length, failed_chunks: failedChunks });
}));

// distinct values for filter dropdowns (countries, owners, campaigns)
router.get("/filters", wrap(async (req, res) => {
  const countries = await query("select distinct country c from ads_wati_contacts where country is not null and country<>'' order by 1");
  const owners = await query("select distinct contact_owner o from ads_wati_contacts where contact_owner is not null and contact_owner<>'' order by 1");
  res.json({
    countries: countries.map((r) => r.c),
    owners: owners.map((r) => r.o),
  });
}));

export default router;
