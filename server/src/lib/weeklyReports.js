// Data-gathering + AI aggregation for the nightly report emails. Kept separate
// from the HTTP routes so the nightly orchestrator can call it directly. Two
// products: a per-employee weekly comparison (this week vs last), and a daily
// active-campaign comparison. Each makes ONE bilingual DeepSeek call (returns
// Arabic + English together) to halve token spend, cached in ads_ai_insights.
import { query } from "../db.js";
import { businessContext } from "./promptContext.js";
import * as ds from "../lib/deepseek.js";
import { employeeRows, computeKpisAndThemes } from "../routes/report.js";
import { patternGroups } from "../routes/report.js";
import { gatherCountries, gatherCampaignTree } from "./analyticsReports.js";
import { gatherContactStatus, rollup as contactRollup } from "./contactStatus.js";
import { getProfile } from "./profileStore.js";
import { businessRules } from "./profileDerived.js";
import config from "../config.js";

// ---- Dubai-time week windows (no server-TZ dependence) ----
export function dubaiYmd(date) {
  // en-CA formats as YYYY-MM-DD; timeZone pins it to Dubai's calendar day.
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.cronTimezone || "Asia/Dubai" }).format(date);
}
function addDays(ymd, n) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isoWeekKey(ymd) {
  const d = new Date(ymd + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this ISO week
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The last completed 7-day week (cur) and the one before it (prev), Dubai time. */
export function weekWindows(now = new Date()) {
  const today = dubaiYmd(now);
  const curUntil = addDays(today, -1);       // yesterday (Sunday on a Monday run)
  const curSince = addDays(curUntil, -6);
  const prevUntil = addDays(curSince, -1);
  const prevSince = addDays(prevUntil, -6);
  return { cur: { since: curSince, until: curUntil }, prev: { since: prevSince, until: prevUntil }, isoWeek: isoWeekKey(curUntil) };
}

/** Which weekday it is in Dubai (0=Sun..6=Sat) — the weekly-report send gate. */
export function dubaiDow(now = new Date()) {
  const ymd = dubaiYmd(now);
  return new Date(ymd + "T00:00:00Z").getUTCDay();
}

/** Day-of-month in Dubai (1..31) — the monthly-report send gate (day 1). */
export function dubaiDom(now = new Date()) {
  return Number(dubaiYmd(now).slice(8, 10));
}

const firstOfMonth = (ymd) => ymd.slice(0, 8) + "01";

/** Yesterday vs the day before (Dubai) — the daily campaign report window. */
export function dailyWindows(now = new Date()) {
  const curUntil = addDays(dubaiYmd(now), -1);
  const prevUntil = addDays(curUntil, -1);
  return { cur: { since: curUntil, until: curUntil }, prev: { since: prevUntil, until: prevUntil }, key: curUntil };
}

/** Last completed calendar month vs the month before it (Dubai). */
export function monthWindows(now = new Date()) {
  const curUntil = addDays(firstOfMonth(dubaiYmd(now)), -1);   // last day of previous month
  const curSince = firstOfMonth(curUntil);
  const prevUntil = addDays(curSince, -1);
  const prevSince = firstOfMonth(prevUntil);
  return { cur: { since: curSince, until: curUntil }, prev: { since: prevSince, until: prevUntil }, key: curSince.slice(0, 7) };
}

/** Resolve the {cur, prev, key} window trio for a campaign-report cadence. */
export function campaignWindows(cadence, now = new Date()) {
  if (cadence === "daily") return dailyWindows(now);
  if (cadence === "monthly") return monthWindows(now);
  const w = weekWindows(now); // weekly (default)
  return { cur: w.cur, prev: w.prev, key: w.isoWeek };
}

// ---- Explicit period selection (pick ANY past week/month, not just the last) ----
/** A specific week identified by its Monday (YYYY-MM-DD). */
export function weekWindowFrom(mondayYmd) {
  const until = addDays(mondayYmd, 6);
  return { cur: { since: mondayYmd, until }, prev: { since: addDays(mondayYmd, -7), until: addDays(mondayYmd, -1) },
    key: isoWeekKey(mondayYmd), isoWeek: isoWeekKey(mondayYmd) };
}
/** A specific calendar month identified by "YYYY-MM". */
export function monthWindowFrom(monthKey) {
  const since = monthKey + "-01";
  const d = new Date(since + "T00:00:00Z");
  const until = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); // last day
  const prevUntil = addDays(since, -1);
  return { cur: { since, until }, prev: { since: firstOfMonth(prevUntil), until: prevUntil }, key: monthKey };
}

/**
 * All selectable, COMPLETED weeks (Mondays) and months within the data range,
 * newest first — for the on-demand report preview pickers.
 */
export async function availablePeriods(now = new Date()) {
  const [r] = await query(
    "select min(created_date) mn from ads_wati_contacts where created_date is not null");
  const yesterday = addDays(dubaiYmd(now), -1);
  const minDay = r?.mn ? new Date(r.mn).toISOString().slice(0, 10) : addDays(yesterday, -120);

  // Months: from the first month with data to the last fully-completed month.
  const months = [];
  const lastMonthEnd = addDays(firstOfMonth(dubaiYmd(now)), -1); // last day of previous month
  let mk = minDay.slice(0, 7);
  const lastMk = lastMonthEnd.slice(0, 7);
  while (mk <= lastMk) {
    const w = monthWindowFrom(mk);
    months.push({ key: mk, since: w.cur.since, until: w.cur.until });
    // advance one month
    const d = new Date(mk + "-01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1);
    mk = d.toISOString().slice(0, 7);
  }

  // Weeks: Mondays from the first data week to the last completed week (Sun <= yesterday).
  const weeks = [];
  let mon = minDay;
  while (new Date(mon + "T00:00:00Z").getUTCDay() !== 1) mon = addDays(mon, 1);
  for (; addDays(mon, 6) <= yesterday; mon = addDays(mon, 7)) {
    weeks.push({ key: isoWeekKey(mon), monday: mon, since: mon, until: addDays(mon, 6) });
  }
  return { weeks: weeks.reverse(), months: months.reverse() };
}

const VERDICTS = new Set(["improved", "declined", "steady"]);
const CAMP_VERDICTS = new Set(["keep", "watch", "close"]);
const QUAL_SET = "('qualified','interested','demo','deposit')";
const arr = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === "string").slice(0, 6) : []);
const cacheGet = async (k) => {
  const r = await query("select data from ads_ai_insights where k = ?", [k]);
  if (!r.length) return null;
  return typeof r[0].data === "string" ? JSON.parse(r[0].data) : r[0].data;
};
const cachePut = (k, data) => query(
  "insert into ads_ai_insights (k, data) values (?, ?) on duplicate key update data=values(data), generated_at=now()",
  [k, JSON.stringify(data)]);

// ---- Employee weekly ----
export async function gatherEmployeeWeekly(agent, { now = new Date(), force = false, window = null } = {}) {
  const w = window || weekWindows(now);
  const curRows = await employeeRows(agent, w.cur.since, w.cur.until);
  const prevRows = await employeeRows(agent, w.prev.since, w.prev.until);
  const cur = computeKpisAndThemes(curRows);
  const prev = computeKpisAndThemes(prevRows);
  const opening = patternGroups(curRows, "opening_pattern_key", "opening_excerpt");
  const dropout = patternGroups(curRows, "dropout_pattern_key", "dropout_point_excerpt");

  const cacheKey = ("empweekly:" + agent).slice(0, 55) + ":" + w.isoWeek;
  let ai = force ? null : await cacheGet(cacheKey);
  if (!ai && ds.hasKey()) {
    try { ai = await aiEmployee(agent, cur, prev, w); await cachePut(cacheKey, ai); }
    catch (e) { console.error("[weekly] employee AI failed:", agent, e.message); ai = null; }
  }

  const conversations = curRows.map((r) => ({
    full_name: r.full_name, phone: r.phone, date: r.last_message_at,
    agent_score: r.agent_score, lead_intent: r.lead_intent, lead_status: r.lead_status,
  }));
  const contacts = await gatherEmployeeContactCost(agent, w.cur, now).catch(() => ({ key: agent, ...ZERO_CONTACTS, cost_total: 0 }));
  return {
    agent, period: w.cur, prevPeriod: w.prev, isoWeek: w.isoWeek,
    cur: { kpis: cur.kpis }, prev: { kpis: prev.kpis }, themes: cur.themes,
    opening_patterns: opening.groups, dropout_patterns: dropout.groups, conversations, contacts, ai,
  };
}

// ---- Employee monthly package (sent day 1): week-by-week progression within
// the just-completed month + month-vs-month, with resolved/new/persisting
// points synthesized from the stored weekly notes. ----
function monthWeeks(monthWin) {
  let mon = monthWin.cur.since;
  while (new Date(mon + "T00:00:00Z").getUTCDay() !== 1) mon = addDays(mon, 1); // first Monday in the month
  const prev0 = { since: addDays(mon, -7), until: addDays(mon, -1), isoWeek: isoWeekKey(addDays(mon, -7)) }; // last week of the prior month
  const weeks = [];
  for (let d = mon; d <= monthWin.cur.until; d = addDays(d, 7)) weeks.push({ since: d, until: addDays(d, 6), isoWeek: isoWeekKey(d) });
  return { prev0, weeks };
}

export async function gatherEmployeeMonthly(agent, { now = new Date(), force = false, window = null } = {}) {
  const m = window || monthWindows(now);
  const { prev0, weeks } = monthWeeks(m);

  const snapshot = async (win) => {
    const rows = await employeeRows(agent, win.since, win.until);
    const { kpis } = computeKpisAndThemes(rows);
    const opening = patternGroups(rows, "opening_pattern_key", "opening_excerpt");
    const dropout = patternGroups(rows, "dropout_pattern_key", "dropout_point_excerpt");
    const patterns = [...opening.groups, ...dropout.groups].map((g) => ({ pattern_key: g.pattern_key, count: g.count }));
    return { since: win.since, until: win.until, isoWeek: win.isoWeek, kpis, patterns };
  };

  const week0 = await snapshot(prev0);
  const weekSnaps = [];
  for (const w of weeks) weekSnaps.push(await snapshot(w));

  const curMonth = computeKpisAndThemes(await employeeRows(agent, m.cur.since, m.cur.until));
  const prevMonth = computeKpisAndThemes(await employeeRows(agent, m.prev.since, m.prev.until));

  // Prior weekly notes (if the weekly job cached them) feed the resolved/new
  // synthesis. Missing weeks are fine — the AI works with what's available.
  const priorNotes = [];
  for (const s of weekSnaps) {
    const n = await cacheGet(("empweekly:" + agent).slice(0, 55) + ":" + s.isoWeek);
    if (n?.ar) priorNotes.push({ week: s.isoWeek, tips: n.ar.tips, mistakes: n.ar.mistakes, verdict: n.ar.verdict });
  }

  const cacheKey = ("empmonthly:" + agent).slice(0, 54) + ":" + m.key;
  let ai = force ? null : await cacheGet(cacheKey);
  if (!ai && ds.hasKey()) {
    try { ai = await aiEmployeeMonthly(agent, { week0, weekSnaps, curMonth, prevMonth, priorNotes, m }); await cachePut(cacheKey, ai); }
    catch (e) { console.error("[monthly] employee AI failed:", agent, e.message); ai = null; }
  }

  const contacts = await gatherEmployeeContactCost(agent, m.cur, now).catch(() => ({ key: agent, ...ZERO_CONTACTS, cost_total: 0 }));
  return {
    agent, monthKey: m.key, month: m.cur, prevMonth: m.prev,
    week0, weeks: weekSnaps,
    cur: { kpis: curMonth.kpis }, prev: { kpis: prevMonth.kpis }, contacts, ai,
  };
}

async function aiEmployeeMonthly(agent, d) {
  const system = `${businessContext("ar")}
أنت مدرّب مبيعات لهذه الشركة. تكتب تقريراً شهرياً لأداء موظف مبيعات: تحلّل تطوّره أسبوعاً بأسبوع داخل الشهر (كل أسبوع مقارنةً بالذي قبله)، وتقارن الشهر كاملاً بالشهر السابق.
قواعد العمل الثابتة:
${businessRules(getProfile(), "ar")}
اعتماداً على ملاحظات الأسابيع السابقة المعطاة، حدّد: النقاط التي حُلّت (كانت ملاحظة وتحسّنت)، النقاط الجديدة التي ظهرت، والأخطاء المستمرّة التي ما زال يكرّرها.
أعِد JSON فقط: {"ar":{"weekly_narrative":"سرد تطوّر الأسابيع","resolved":["..."],"new_points":["..."],"persisting":["..."],"month_narrative":"سرد الشهر مقابل السابق","verdict":"improved|declined|steady"},"en":{...same keys in English...}}.
verdict إلزامي من القيم الثلاث. استند للأرقام والملاحظات المعطاة فقط، لا تختلق.`;
  const user = JSON.stringify({
    agent,
    weeks: [d.week0, ...d.weekSnaps].map((s) => ({ week: s.isoWeek, period: { since: s.since, until: s.until }, kpis: s.kpis, patterns: s.patterns })),
    this_month: { period: d.m.cur, kpis: d.curMonth.kpis, top_mistakes: d.curMonth.themes.mistakes, top_improvements: d.curMonth.themes.improvements },
    previous_month: { period: d.m.prev, kpis: d.prevMonth.kpis },
    prior_weekly_notes: d.priorNotes,
  });
  const raw = await ds.chatJSON(system, user, "empmonthly:" + agent);
  const norm = (o) => ({
    weekly_narrative: typeof o?.weekly_narrative === "string" ? o.weekly_narrative : "",
    month_narrative: typeof o?.month_narrative === "string" ? o.month_narrative : "",
    resolved: arr(o?.resolved), new_points: arr(o?.new_points), persisting: arr(o?.persisting),
    verdict: VERDICTS.has(o?.verdict) ? o.verdict : "steady",
  });
  return { ar: norm(raw?.ar), en: norm(raw?.en) };
}

async function aiEmployee(agent, cur, prev, w) {
  const system = `${businessContext("ar")}
أنت مدرّب مبيعات لهذه الشركة. تكتب تقييماً أسبوعياً لأداء موظف مبيعات بمقارنة أسبوعه الحالي بالأسبوع السابق.
قواعد العمل الثابتة:
${businessRules(getProfile(), "ar")}
أعِد JSON فقط بالشكل: {"ar":{"verdict":"improved|declined|steady","narrative":"فقرة موجزة","tips":["..."],"mistakes":["..."]},"en":{...same keys in English...}}.
verdict إلزامي من هذه القيم الثلاث فقط. tips نصائح تسويقية عملية للأسبوع القادم، mistakes أخطاء يجب تجنّبها. كن محدداً واستند للأرقام المعطاة فقط، لا تختلق بيانات.`;
  const user = JSON.stringify({
    agent,
    this_week: { period: w.cur, kpis: cur.kpis, top_improvements: cur.themes.improvements, top_mistakes: cur.themes.mistakes, top_strengths: cur.themes.strengths },
    previous_week: { period: w.prev, kpis: prev.kpis },
  });
  const raw = await ds.chatJSON(system, user, "empweekly:" + agent);
  const norm = (o) => ({
    verdict: VERDICTS.has(o?.verdict) ? o.verdict : "steady",
    narrative: typeof o?.narrative === "string" ? o.narrative : "",
    tips: arr(o?.tips), mistakes: arr(o?.mistakes),
  });
  return { ar: norm(raw?.ar), en: norm(raw?.en) };
}

// ---- Campaign report (daily | weekly | monthly) ----
export async function gatherCampaignReport({ cadence = "weekly", now = new Date(), force = false, window = null } = {}) {
  const w = window || campaignWindows(cadence, now);
  const rows = await query(
    `select c.campaign_id, c.campaign_name,
       sum(case when d.date between ? and ? then d.spend_aed else 0 end) spend,
       sum(case when d.date between ? and ? then d.results else 0 end) results,
       sum(case when d.date between ? and ? then d.spend_aed else 0 end) prev_spend,
       sum(case when d.date between ? and ? then d.results else 0 end) prev_results
     from ads_meta_campaign_perf c
     left join ads_meta_daily d on d.level='campaign' and d.entity_id = c.campaign_id
     -- campaign-level status is never populated by the sync (it's set at the
     -- ad level), so "active" = the campaign has at least one ACTIVE ad.
     where c.campaign_id in (select campaign_id from ads_meta_ad_perf where status = 'ACTIVE')
     group by c.campaign_id, c.campaign_name
     order by spend desc`,
    [w.cur.since, w.cur.until, w.cur.since, w.cur.until, w.prev.since, w.prev.until, w.prev.since, w.prev.until]);

  const campaigns = rows.map((r) => {
    const spend = Number(r.spend) || 0, results = Number(r.results) || 0;
    const prev_spend = Number(r.prev_spend) || 0, prev_results = Number(r.prev_results) || 0;
    return {
      campaign_id: r.campaign_id, campaign_name: r.campaign_name,
      spend, results, cpr: results ? Math.round((spend / results) * 100) / 100 : null,
      prev_spend, prev_results, prev_cpr: prev_results ? Math.round((prev_spend / prev_results) * 100) / 100 : null,
    };
  });
  const totals = {
    active: campaigns.length,
    spend: campaigns.reduce((s, c) => s + c.spend, 0),
    results: campaigns.reduce((s, c) => s + c.results, 0),
  };

  const metrics = await gatherCostBlock(w.cur);

  const cacheKey = `camp:${cadence}:${w.key}`;
  let ai = force ? null : await cacheGet(cacheKey);
  if (!ai && ds.hasKey() && campaigns.length) {
    try { ai = await aiCampaigns(campaigns, w); await cachePut(cacheKey, ai); }
    catch (e) { console.error("[campaign] AI failed:", e.message); ai = null; }
  }
  // Full Campaign→AdSet→Ad hierarchy + per-country breakdown for the same
  // window, so the emailed campaign PDF carries the complete picture.
  const [tree, countries, employeeContacts] = await Promise.all([
    gatherCampaignTree(w.cur.since, w.cur.until).catch((e) => { console.error("[campaign] tree:", e.message); return []; }),
    gatherCountries(w.cur.since, w.cur.until).catch((e) => { console.error("[campaign] countries:", e.message); return { rows: [], totals: {} }; }),
    gatherEmployeeContacts(w.cur, now).catch((e) => { console.error("[campaign] employeeContacts:", e.message); return []; }),
  ]);

  // Merge AI verdict/adjustment/warning onto each campaign, per language.
  const byId = {};
  for (const c of (ai?.campaigns || [])) byId[c.campaign_id] = c;
  return { cadence, period: w.cur, prevPeriod: w.prev, key: w.key, dateKey: w.key,
    totals, campaigns, ai: byId, tree, countries, employeeContacts, metrics };
}

// Back-compat alias (the "daily campaign report" — a weekly window sent daily).
export const gatherCampaignDaily = (opts = {}) => gatherCampaignReport({ cadence: "weekly", ...opts });

// Wati owner names that are automations, not human employees (bot/qualifier
// accounts and uuid-suffixed system owners) — excluded from the staff table.
const AUTOMATION_OWNER = /bot|qualifier|inquiry|counsel|[0-9a-f]{8}-[0-9a-f]{4}-/i;
async function gatherEmployeeContacts(cur, now) {
  const { leads } = await gatherContactStatus(cur.since, cur.until, { now });
  const human = leads.filter((l) => l.owner && !AUTOMATION_OWNER.test(l.owner));
  return contactRollup(human, (l) => l.owner);
}

const ZERO_CONTACTS = { leads: 0, contacted: 0, not_contacted: 0, after_hours: 0, negligence: 0,
  expired: 0, awaiting: 0, interested: 0, cost_contacted: 0, cost_not_contacted: 0, contact_rate_pct: 0 };
const squashName = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * One employee's contact-cost rollup for a window: how many of the leads THEY
 * received got a human reply vs not, the not-contacted split (after-hours vs
 * negligence), and the ad-spend cost attributed to contacted vs not-contacted
 * leads. Feeds the "cost of contacted vs missed" block in the weekly/monthly
 * employee reports.
 */
async function gatherEmployeeContactCost(agent, cur, now) {
  const { leads } = await gatherContactStatus(cur.since, cur.until, { now });
  const mine = leads.filter((l) => squashName(l.owner) === squashName(agent));
  const [row] = contactRollup(mine, () => agent);
  const r = row || { key: agent, ...ZERO_CONTACTS };
  return { ...r, cost_total: Math.round((r.cost_contacted + r.cost_not_contacted) * 100) / 100 };
}

// "Cost of everything obtained this period": reach/impressions/clicks/
// conversations(=results) from Meta + interested (Wati qualified) + spend, and
// the cost of each. New page followers need Page Insights (separate token) and
// are surfaced as null (shown "—") until that's connected.
async function gatherCostBlock(cur) {
  const [m] = await query(
    `select sum(spend_aed) spend, sum(impressions) impressions, sum(reach) reach,
            sum(clicks) clicks, sum(results) results
     from ads_meta_daily where level='campaign' and date between ? and ?`, [cur.since, cur.until]);
  const [w] = await query(
    `select sum(case when stage in ${QUAL_SET} then 1 else 0 end) interested
     from ads_wati_contacts where created_date between ? and ?`, [cur.since, cur.until]);
  const spend = Number(m?.spend) || 0;
  const impressions = Number(m?.impressions) || 0, reach = Number(m?.reach) || 0;
  const clicks = Number(m?.clicks) || 0, conversations = Number(m?.results) || 0;
  const interested = Number(w?.interested) || 0;
  const per = (n) => (spend && n ? Math.round((spend / n) * 100) / 100 : null);
  return {
    spend, reach, impressions, clicks, conversations, interested,
    new_followers: null, // deferred — needs Page Insights (pages_read_engagement)
    cost_per_conversation: per(conversations),
    cost_per_interested: per(interested),
    cost_per_click: per(clicks),
    cost_per_1k_impressions: impressions ? Math.round((spend / impressions) * 1000 * 100) / 100 : null,
    cost_per_new_follower: null,
  };
}

async function aiCampaigns(campaigns, w) {
  const system = `${businessContext("ar")}
أنت محلل حملات إعلانية مدفوعة (Meta) لهذه الشركة. تقارن أداء كل حملة نشطة في آخر 7 أيام بالأسبوع السابق وتوصي بقرار.
أعِد JSON فقط: {"campaigns":[{"campaign_id":"..","verdict":"keep|watch|close","adjustment_ar":"..","adjustment_en":"..","warning_ar":"..","warning_en":".."}]}.
verdict إلزامي من: keep (أداء جيد، أبقِها)، watch (متذبذبة، راقبها)، close (ضعيفة/مكلفة، أغلِقها). adjustment تعديل عملي مقترح، warning تحذير إن وُجد (أو نص فارغ). استند للأرقام فقط، لا تختلق.`;
  const user = JSON.stringify({
    this_week: w.cur, previous_week: w.prev,
    campaigns: campaigns.map((c) => ({
      campaign_id: c.campaign_id, name: c.campaign_name,
      spend: c.spend, results: c.results, cpr: c.cpr,
      prev_spend: c.prev_spend, prev_results: c.prev_results, prev_cpr: c.prev_cpr,
    })),
  });
  const raw = await ds.chatJSON(system, user, "campdaily");
  const list = Array.isArray(raw?.campaigns) ? raw.campaigns : [];
  return {
    campaigns: list.map((c) => ({
      campaign_id: String(c.campaign_id || ""),
      verdict: CAMP_VERDICTS.has(c.verdict) ? c.verdict : "watch",
      adjustment_ar: String(c.adjustment_ar || ""), adjustment_en: String(c.adjustment_en || ""),
      warning_ar: String(c.warning_ar || ""), warning_en: String(c.warning_en || ""),
    })),
  };
}

// ---- Shape gathered data into the per-language object each HTML builder wants ----
export function employeeReportData(g, lang, generatedAt = new Date()) {
  return {
    agent: g.agent, lang, period: g.period, prevPeriod: g.prevPeriod, generatedAt,
    cur: g.cur, prev: g.prev,
    opening_patterns: g.opening_patterns, dropout_patterns: g.dropout_patterns,
    conversations: g.conversations, contacts: g.contacts || null,
    ai: g.ai ? (g.ai[lang] || g.ai.ar || null) : null,
  };
}

export function campaignReportData(g, lang, generatedAt = new Date()) {
  const campaigns = g.campaigns.map((c) => {
    const a = g.ai?.[c.campaign_id];
    return {
      ...c,
      verdict: a?.verdict || null,
      adjustment: a ? (lang === "en" ? a.adjustment_en : a.adjustment_ar) : "",
      warning: a ? (lang === "en" ? a.warning_en : a.warning_ar) : "",
    };
  });
  return { lang, cadence: g.cadence, period: g.period, prevPeriod: g.prevPeriod, generatedAt, totals: g.totals, campaigns,
    metrics: g.metrics || null, tree: g.tree || [], countries: g.countries || { rows: [] },
    employeeContacts: g.employeeContacts || [] };
}

export function employeeMonthlyData(g, lang, generatedAt = new Date()) {
  return {
    agent: g.agent, lang, monthKey: g.monthKey, month: g.month, prevMonth: g.prevMonth, generatedAt,
    week0: g.week0, weeks: g.weeks, cur: g.cur, prev: g.prev, contacts: g.contacts || null,
    ai: g.ai ? (g.ai[lang] || g.ai.ar || null) : null,
  };
}

export default { weekWindows, monthWindows, dailyWindows, campaignWindows, weekWindowFrom, monthWindowFrom,
  availablePeriods, dubaiDow, dubaiDom, gatherEmployeeWeekly, gatherEmployeeMonthly, gatherCampaignReport,
  gatherCampaignDaily, employeeReportData, employeeMonthlyData, campaignReportData };
