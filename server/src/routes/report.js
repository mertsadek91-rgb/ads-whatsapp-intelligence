// Comprehensive reports built on top of the AI analysis + engagement metrics.
import { Router } from "express";
import { query } from "../db.js";
import * as ds from "../lib/deepseek.js";
import { streamCsv } from "../lib/csvStream.js";
import { langOf, headers, cellMapper, agentLabel } from "../lib/reportI18n.js";
import { normalizeAgentName } from "../lib/agentName.js";
import { getProfile } from "../lib/profileStore.js";
import { patternLabel as patternLabelFor, businessRules } from "../lib/profileDerived.js";

const patternLabel = (k, lang) => patternLabelFor(getProfile(), k, lang);
import { buildReportHtml, htmlToPdf } from "../lib/pdfReport.js";
import { wrap } from "../lib/wrap.js";
import { businessContext } from "../lib/promptContext.js";

// Clean employee names from Wati (the canonical vocabulary the noisy
// AI-extracted agent_name values are normalized against).
export async function knownOwners() {
  const rows = await query(
    "select distinct contact_owner v from ads_wati_contacts where contact_owner is not null and contact_owner <> ''");
  return rows.map((r) => r.v);
}

const router = Router();

// ---- AI summary (customers + employees) ----
router.get("/ai-summary", wrap(async (req, res) => {
  const [tot] = await query(
    `select count(*) analyzed, round(avg(conv_score),1) avg_conv, round(avg(agent_score),1) avg_agent,
            round(avg(follow_up_min),1) avg_follow_up,
            sum(case when wrong_persuasion=1 then 1 else 0 end) wrong_persuasion,
            sum(case when lead_intent='hot' then 1 else 0 end) hot,
            sum(case when lead_intent='warm' then 1 else 0 end) warm,
            sum(case when lead_intent='cold' then 1 else 0 end) cold
     from ads_conversation_analysis`);
  // Grouped by raw agent_name in SQL (sums+counts, not avgs, so groups can be
  // merged), then normalized to canonical names in JS — the AI extracts many
  // variants of the same person's name ("X", "X و Y", bot spellings…).
  const owners = await knownOwners();
  const empRaw = await query(
    `select coalesce(nullif(agent_name,''),'(غير معروف)') agent, count(*) n,
            sum(agent_score) sa, count(agent_score) na,
            sum(conv_score) sc, count(conv_score) nc,
            sum(follow_up_min) sf, count(follow_up_min) nf,
            sum(case when wrong_persuasion=1 then 1 else 0 end) w
     from ads_conversation_analysis group by 1`);
  const eagg = {};
  for (const r of empRaw) {
    const k = normalizeAgentName(r.agent, owners);
    const e = (eagg[k] ||= { agent: k, n: 0, sa: 0, na: 0, sc: 0, nc: 0, sf: 0, nf: 0, w: 0 });
    e.n += Number(r.n); e.sa += Number(r.sa || 0); e.na += Number(r.na); e.sc += Number(r.sc || 0);
    e.nc += Number(r.nc); e.sf += Number(r.sf || 0); e.nf += Number(r.nf); e.w += Number(r.w);
  }
  const rnd = (s, n) => (n ? Math.round((s / n) * 10) / 10 : null);
  // `agent` stays the canonical key the UI passes back in /employee/:agent —
  // `agent_label` is the display string, so the "(unknown)" bucket reads in the
  // report's language without breaking lookups.
  const lang = langOf(req);
  const employees = Object.values(eagg).map((e) => ({
    agent: e.agent, agent_label: agentLabel(e.agent, lang), conversations: e.n,
    avg_agent_score: rnd(e.sa, e.na), avg_conv_score: rnd(e.sc, e.nc),
    avg_follow_up_min: rnd(e.sf, e.nf), wrong_persuasion: e.w,
  })).sort((a, b) => b.conversations - a.conversations);

  const customers = (await query(
    `select a.wa_id, c.full_name, c.phone, a.conv_score, a.lead_intent, a.lead_status,
            a.agent_name, a.follow_up_min, c.contact_owner
     from ads_conversation_analysis a join ads_wati_contacts c on c.wa_id=a.wa_id
     order by a.conv_score desc limit 50`))
    .map((r) => ({ ...r, agent_name: normalizeAgentName(r.agent_name, owners) }));
  const flagged = (await query(
    `select a.wa_id, c.full_name, a.agent_name, a.conv_score, a.summary
     from ads_conversation_analysis a join ads_wati_contacts c on c.wa_id=a.wa_id
     where a.wrong_persuasion=1 order by a.analyzed_at desc limit 50`))
    .map((r) => ({ ...r, agent_name: normalizeAgentName(r.agent_name, owners) }));
  res.json({ totals: tot, employees, customers, flagged });
}));

// ---- conversation-type breakdown (engagement) + wasted-spend signal ----
router.get("/engagement", wrap(async (req, res) => {
  const types = await query(
    // A stable key, not a display string — the client and the PDF both label it,
    // so an Arabic literal here would leak into the English report.
    `select coalesce(conv_type,'not_synced') conv_type, count(*) n
     from ads_wati_contacts c left join ads_conversation_meta m on m.wa_id=c.wa_id
     group by 1 order by n desc`);
  const [tot] = await query("select count(*) total from ads_wati_contacts");
  res.json({ total: tot.total, types });
}));

// ---- re-engagement list: interested customers with no human reply ----
router.get("/re-engagement", wrap(async (req, res) => {
  const minMsgs = Number(req.query.minMsgs || 2);
  const rows = await query(
    `select c.wa_id, c.full_name, c.phone, c.country, c.stage, c.lead_score, c.score_band,
            c.contact_owner, p.ad_name, m.conv_type, m.customer_msgs, m.last_activity
     from ads_wati_contacts c
     join ads_conversation_meta m on m.wa_id=c.wa_id
     left join ads_meta_ad_perf p on p.ad_id=c.source_ad_id
     where m.conv_type in ('awaiting_human','bot_only') and m.customer_msgs >= ?
     order by c.lead_score desc, m.customer_msgs desc limit 500`, [minMsgs]);
  res.json(rows);
}));

router.get("/re-engagement.csv", wrap(async (req, res) => {
  const minMsgs = Number(req.query.minMsgs || 2);
  const cols = ["full_name", "phone", "country", "stage", "lead_score", "contact_owner", "ad_name", "conv_type", "customer_msgs", "last_activity"];
  const lang = langOf(req);
  await streamCsv(res, {
    headers: headers(cols, lang), map: cellMapper(lang),
    sql: `select c.full_name, c.phone, c.country, c.stage, c.lead_score, c.contact_owner,
            p.ad_name, m.conv_type, m.customer_msgs, m.last_activity
     from ads_wati_contacts c join ads_conversation_meta m on m.wa_id=c.wa_id
     left join ads_meta_ad_perf p on p.ad_id=c.source_ad_id
     where m.conv_type in ('awaiting_human','bot_only') and m.customer_msgs >= ?
     order by c.lead_score desc, m.customer_msgs desc`,
    params: [minMsgs], cols,
    filename: lang === "en" ? "re-engagement.csv" : "إعادة-التواصل.csv",
    filenameAscii: "re-engagement.csv",
  });
}));

// ---- per-agent coaching (no AI; aggregates stored eval bullets) ----
router.get("/coaching", wrap(async (req, res) => {
  const owners = await knownOwners();
  const rows = await query(
    `select coalesce(nullif(agent_name,''),'(غير معروف)') agent, agent_score, agent_eval, wrong_persuasion
     from ads_conversation_analysis`);
  const byAgent = {};
  for (const r of rows) {
    const key = normalizeAgentName(r.agent, owners);
    const a = (byAgent[key] ||= { agent: key, n: 0, scoreSum: 0, wrong: 0, improvements: {}, mistakes: {} });
    a.n++; a.scoreSum += r.agent_score || 0; a.wrong += r.wrong_persuasion ? 1 : 0;
    const ev = typeof r.agent_eval === "string" ? safe(r.agent_eval) : (r.agent_eval || {});
    for (const t of ev.improvements || []) a.improvements[t] = (a.improvements[t] || 0) + 1;
    for (const t of ev.wrong_persuasion_examples || []) a.mistakes[t] = (a.mistakes[t] || 0) + 1;
  }
  const top = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([t, c]) => ({ text: t, count: c }));
  const lang = langOf(req);
  const agents = Object.values(byAgent).map((a) => ({
    agent: a.agent, agent_label: agentLabel(a.agent, lang),
    conversations: a.n, avg_score: Math.round((a.scoreSum / a.n) * 10) / 10,
    wrong_persuasion: a.wrong, top_improvements: top(a.improvements), top_mistakes: top(a.mistakes),
  })).sort((x, y) => y.conversations - x.conversations);
  res.json(agents);
}));

// ---- per-employee detailed report ----
// Conversations here = AI-analyzed conversations attributed to this agent
// (agent_name as detected by the analysis), date-filtered on the contact's
// last_message_at. Includes per-conversation results + aggregated themes.
const AGENT_KEY = "coalesce(nullif(a.agent_name,''),'(غير معروف)')";
const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

// A canonical agent maps back to MANY stored raw agent_name variants —
// SQL filtering has to match all of them, so resolve the variant set first.
async function agentVariants(agent) {
  const owners = await knownOwners();
  const rows = await query(`select distinct ${AGENT_KEY} raw from ads_conversation_analysis a`);
  return rows.map((r) => r.raw).filter((raw) => normalizeAgentName(raw, owners) === agent);
}

function employeeFilter(variants, since, until) {
  const where = [`${AGENT_KEY} in (${variants.map(() => "?").join(",")})`];
  const params = [...variants];
  if (isDateStr(since)) { where.push("date(c.last_message_at) >= ?"); params.push(since); }
  if (isDateStr(until)) { where.push("date(c.last_message_at) <= ?"); params.push(until); }
  return { clause: where.join(" and "), params };
}

export async function employeeRows(agent, since, until) {
  const variants = await agentVariants(agent);
  if (!variants.length) return [];
  const f = employeeFilter(variants, since, until);
  return query(
    `select a.wa_id, c.full_name, c.phone, c.last_message_at, a.conv_score, a.agent_score,
            a.lead_intent, a.lead_status, a.summary, a.wrong_persuasion, a.follow_up_min,
            a.message_count, a.agent_eval, a.flags, a.analyzed_at
     from ads_conversation_analysis a
     join ads_wati_contacts c on c.wa_id = a.wa_id
     where ${f.clause}
     order by c.last_message_at desc`, f.params);
}

router.get("/employees", wrap(async (req, res) => {
  const owners = await knownOwners();
  const rows = await query(
    `select ${AGENT_KEY} agent, count(*) c
     from ads_conversation_analysis a group by 1`);
  const agg = {};
  for (const r of rows) {
    const k = normalizeAgentName(r.agent, owners);
    agg[k] = (agg[k] || 0) + Number(r.c);
  }
  res.json(Object.entries(agg)
    .map(([agent, conversations]) => ({ agent, conversations }))
    .sort((a, b) => b.conversations - a.conversations));
}));

function top(o, max = 8) { return Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, max).map(([text, count]) => ({ text, count })); }

// Shared by the JSON report route and the PDF export route so the two never
// drift apart (e.g. one route's KPI math silently diverging from the other's).
export function computeKpisAndThemes(rows) {
  const n = rows.length;
  const avg = (k) => (n ? Math.round((rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) / n) * 10) / 10 : null);
  const intents = { hot: 0, warm: 0, cold: 0 };
  const improvements = {}, mistakes = {}, strengths = {};
  for (const r of rows) {
    if (intents[r.lead_intent] !== undefined) intents[r.lead_intent]++;
    const ev = typeof r.agent_eval === "string" ? safe(r.agent_eval) : (r.agent_eval || {});
    for (const x of ev.improvements || []) improvements[x] = (improvements[x] || 0) + 1;
    for (const x of ev.wrong_persuasion_examples || []) mistakes[x] = (mistakes[x] || 0) + 1;
    for (const x of ev.strengths || []) strengths[x] = (strengths[x] || 0) + 1;
  }
  return {
    kpis: {
      conversations: n, avg_agent_score: avg("agent_score"), avg_conv_score: avg("conv_score"),
      avg_follow_up_min: avg("follow_up_min"), wrong_persuasion: rows.filter((r) => r.wrong_persuasion).length, intents,
    },
    themes: { improvements: top(improvements), mistakes: top(mistakes), strengths: top(strengths) },
  };
}

router.get("/employee/:agent", wrap(async (req, res) => {
  const rows = await employeeRows(req.params.agent, req.query.since, req.query.until);
  const { kpis, themes } = computeKpisAndThemes(rows);
  res.json({
    agent: req.params.agent,
    kpis,
    conversations: rows.map((r) => ({
      wa_id: r.wa_id, full_name: r.full_name, phone: r.phone, date: r.last_message_at,
      conv_score: r.conv_score, agent_score: r.agent_score, lead_intent: r.lead_intent,
      lead_status: r.lead_status, summary: r.summary, wrong_persuasion: !!r.wrong_persuasion,
      follow_up_min: r.follow_up_min, message_count: r.message_count,
    })),
    themes,
  });
}));

// Streamed CSV export of the employee's per-conversation results (same
// variant expansion + date filtering as the JSON report).
router.get("/employee/:agent/export.csv", wrap(async (req, res) => {
  const variants = await agentVariants(req.params.agent);
  if (!variants.length) return res.status(404).json({ error: "not found" });
  const f = employeeFilter(variants, req.query.since, req.query.until);
  const cols = ["full_name", "phone", "date", "agent_score", "conv_score", "lead_intent",
    "lead_status", "wrong_persuasion", "follow_up_min", "message_count", "summary"];
  const lang = langOf(req);
  await streamCsv(res, {
    headers: headers(cols, lang), map: cellMapper(lang),
    sql: `select c.full_name, c.phone, c.last_message_at date, a.agent_score, a.conv_score,
                 a.lead_intent, a.lead_status, a.wrong_persuasion, a.follow_up_min,
                 a.message_count, a.summary
          from ads_conversation_analysis a
          join ads_wati_contacts c on c.wa_id = a.wa_id
          where ${f.clause}
          order by c.last_message_at desc`,
    params: f.params, cols,
    filename: lang === "en" ? "employee-report.csv" : "تقرير-الموظف.csv",
    filenameAscii: "employee-report.csv",
  });
}));

// AI coaching notes for one employee, generated in the requested language and
// cached per agent+language (regenerating overwrites the previous period's).
const empKey = (agent, lang) => ("emp:" + agent).slice(0, 58) + ":" + (lang === "en" ? "en" : "ar");

router.get("/employee/:agent/notes", wrap(async (req, res) => {
  const r = await query("select data, generated_at from ads_ai_insights where k = ?", [empKey(req.params.agent, req.query.lang)]);
  if (!r.length) return res.json({ generated: false });
  res.json({ generated: true, generated_at: r[0].generated_at, ...(typeof r[0].data === "string" ? safe(r[0].data) : r[0].data) });
}));

router.post("/employee/:agent/notes", wrap(async (req, res) => {
  if (!ds.hasKey()) return res.status(400).json({ error: "لا يوجد مفتاح DeepSeek" });
  const { since, until, lang } = req.body || {};
  const agent = req.params.agent;
  const rows = await employeeRows(agent, since, until);
  if (!rows.length) return res.status(400).json({ error: "لا توجد محادثات محلّلة لهذا الموظف في الفترة المحدّدة." });

  const compact = rows.slice(0, 150).map((r) => {
    const ev = typeof r.agent_eval === "string" ? safe(r.agent_eval) : (r.agent_eval || {});
    return {
      score: r.agent_score, conv: r.conv_score, intent: r.lead_intent, wrong: !!r.wrong_persuasion,
      follow_up_min: r.follow_up_min, status: r.lead_status,
      improvements: ev.improvements || [], mistakes: ev.wrong_persuasion_examples || [],
    };
  });

  const en = lang === "en";
  const system = en
    ? `${businessContext("en")}
You are a sales manager and quality coach here. You are writing a performance review for one sales employee based on aggregated AI evaluations of their WhatsApp conversations. Be professional, specific, fair, and constructive. Reply in English, JSON only.`
    : `${businessContext("ar")}
أنت مدير مبيعات ومدرّب جودة لدى هذه الشركة. تكتب مراجعة أداء لموظف مبيعات واحد بناءً على تقييمات آلية مجمّعة لمحادثاته على واتساب. كن مهنياً ومحدّداً وعادلاً وبنّاءً. أجب بالعربية وبصيغة JSON فقط.`;
  const user = (en
    ? `Employee: ${agent}\nPeriod: ${since || "start"} → ${until || "today"}\nAnalyzed conversations: ${rows.length}\n\nProduce JSON exactly like:\n`
    : `الموظف: ${agent}\nالفترة: ${since || "البداية"} → ${until || "اليوم"}\nعدد المحادثات المحلّلة: ${rows.length}\n\nأنتج JSON بهذا الشكل بالضبط:\n`) + `
{
 "summary": ${en ? '"overall assessment of the employee\'s performance in 2-4 sentences"' : '"تقييم عام لأداء الموظف في 2-4 جمل"'},
 "problems": [${en ? '"the concrete problems that must be addressed"' : '"المشاكل الملموسة التي يجب معالجتها"'}],
 "improvements": [${en ? '"specific, actionable improvement steps"' : '"خطوات تحسين محدّدة قابلة للتنفيذ"'}],
 "commitments": [${en ? '"clear work-discipline/commitment guidance for the employee"' : '"توجيهات واضحة للالتزام بالعمل والانضباط"'}],
 "positives": [${en ? '"strengths to keep reinforcing"' : '"نقاط قوة يجب تعزيزها"'}]
}
${en ? "Data:" : "البيانات:"}
${JSON.stringify(compact).slice(0, 45000)}`;

  const out = await ds.chatJSON(system, user, `emp:${agent}`);
  const data = { ...out, period: { since: since || null, until: until || null }, conversations: rows.length };
  await query(
    `insert into ads_ai_insights (k, data) values (?, ?) as new on duplicate key update data=new.data, generated_at=now()`,
    [empKey(agent, lang), JSON.stringify(data)]
  );
  res.json({ generated: true, generated_at: new Date(), ...data });
}));

// ---- conversation coaching: opening/dropout pattern comparison ----
// Groups an employee's already-analyzed conversations by the fixed
// opening/dropout pattern_key (see the profile’s sales_patterns), keeping the
// actual affected customers (not just a count) so a manager can look up
// exactly who got a given weak reply. `measured` counts rows that carry the
// new schema fields at all, distinct from "measured and found nothing wrong"
// — older conversations analyzed before this feature shipped simply lack
// these keys until re-analyzed, and conflating "not yet measured" with
// "clean" would understate real issues for agents with un-backfilled history.
export function patternGroups(rows, field, excerptField) {
  const groups = {};
  let measured = 0;
  for (const r of rows) {
    const ev = typeof r.agent_eval === "string" ? safe(r.agent_eval) : (r.agent_eval || {});
    if (ev.opening_quality !== undefined || ev.dropout_detected !== undefined) measured++;
    const key = ev[field];
    if (!key) continue; // "adequate"/"strong" opening, or dropout_detected=false -> no pattern
    const g = (groups[key] ||= { pattern_key: key, count: 0, customers: [], smart_reply_examples: [] });
    g.count++;
    g.customers.push({
      wa_id: r.wa_id, full_name: r.full_name, phone: r.phone, date: r.last_message_at,
      excerpt: ev[excerptField] || null,
    });
    if (ev.smart_reply_example && g.smart_reply_examples.length < 3) {
      g.smart_reply_examples.push(ev.smart_reply_example);
    }
  }
  return { measured, groups: Object.values(groups).sort((a, b) => b.count - a.count) };
}

router.get("/employee/:agent/coaching", wrap(async (req, res) => {
  const rows = await employeeRows(req.params.agent, req.query.since, req.query.until);
  const lang = req.query.lang === "en" ? "en" : "ar";
  const opening = patternGroups(rows, "opening_pattern_key", "opening_excerpt");
  const dropout = patternGroups(rows, "dropout_pattern_key", "dropout_point_excerpt");
  const label = (g) => ({ ...g, pattern_label: patternLabel(g.pattern_key, lang) });
  res.json({
    agent: req.params.agent,
    total_conversations: rows.length,
    measured_conversations: Math.max(opening.measured, dropout.measured),
    opening_patterns: opening.groups.map(label),
    dropout_patterns: dropout.groups.map(label),
  });
}));

const coachKey = (agent, patternKey, lang) =>
  ("coach:" + agent + ":" + patternKey).slice(0, 58) + ":" + (lang === "en" ? "en" : "ar");

router.get("/employee/:agent/coaching-script", wrap(async (req, res) => {
  const key = coachKey(req.params.agent, req.query.pattern_key, req.query.lang);
  const r = await query("select data, generated_at from ads_ai_insights where k = ?", [key]);
  if (!r.length) return res.json({ generated: false });
  res.json({ generated: true, generated_at: r[0].generated_at, ...(typeof r[0].data === "string" ? safe(r[0].data) : r[0].data) });
}));

router.post("/employee/:agent/coaching-script", wrap(async (req, res) => {
  if (!ds.hasKey()) return res.status(400).json({ error: "لا يوجد مفتاح DeepSeek" });
  const { since, until, pattern_key, lang } = req.body || {};
  const agent = req.params.agent;
  const rows = await employeeRows(agent, since, until);

  // A pattern_key can occur on the opening side, the dropout side, or both — check both.
  const both = [...patternGroups(rows, "opening_pattern_key", "opening_excerpt").groups,
                ...patternGroups(rows, "dropout_pattern_key", "dropout_point_excerpt").groups];
  const group = both.find((g) => g.pattern_key === pattern_key);
  if (!group || !group.customers.length) {
    return res.status(400).json({ error: "لا توجد محادثات مرصودة لهذا النمط في الفترة المحدّدة." });
  }

  const en = lang === "en";
  const label = patternLabel(pattern_key, en ? "en" : "ar");
  const excerpts = group.customers.map((c) => c.excerpt).filter(Boolean).slice(0, 8);
  const system = en
    ? `${businessContext("en")}
You are a sales manager and quality coach here, writing ONE focused coaching example for a single detected weak pattern in a sales employee's conversations. Be constructive, specific, never blaming. Reply in English, JSON only.\n${businessRules(getProfile(), "en")}`
    : `${businessContext("ar")}
أنت مدير مبيعات ومدرّب جودة لدى هذه الشركة، تكتب مثالاً تدريبياً واحداً مركّزاً لنمط ضعف محدَّد رُصد في محادثات موظف مبيعات. كن بنّاءً ومحدَّداً وغير لوّام. أجب بالعربية وبصيغة JSON فقط.\n${businessRules(getProfile(), "ar")}`;
  const user = (en
    ? `Employee: ${agent}\nDetected pattern: ${label} (${pattern_key})\nOccurred ${group.count} time(s) in this period.\nReal excerpts from this employee's conversations showing this pattern:\n`
    : `الموظف: ${agent}\nالنمط المرصود: ${label} (${pattern_key})\nحدث ${group.count} مرة خلال هذه الفترة.\nاقتباسات حقيقية من محادثات هذا الموظف تُظهر هذا النمط:\n`)
    + JSON.stringify(excerpts) + (en
    ? `\n\nProduce JSON exactly like:\n{\n "diagnosis": "2-3 sentences on why this pattern hurts conversion, referencing the excerpts",\n "smart_script": "one full rewritten example reply following the business rules above",\n "discovery_questions": ["2-4 follow-up questions the agent should ask to uncover the customer's real intent"]\n}`
    : `\n\nأنتج JSON بهذا الشكل بالضبط:\n{\n "diagnosis": "جملتان-ثلاث عن سبب ضرر هذا النمط بالتحويل، بالإشارة إلى الاقتباسات",\n "smart_script": "رد بديل واحد كامل مُعاد كتابته وفق قواعد العمل أعلاه",\n "discovery_questions": ["2-4 أسئلة متابعة يجب أن يسألها الموظف لكشف نيّة العميل الحقيقية"]\n}`);

  const out = await ds.chatJSON(system, user, `coach:${agent}:${pattern_key}`);
  const data = { pattern_key, pattern_label: label, affected_count: group.count, ...out };
  await query(
    `insert into ads_ai_insights (k, data) values (?, ?) as new on duplicate key update data=new.data, generated_at=now()`,
    [coachKey(agent, pattern_key, lang), JSON.stringify(data)]
  );
  res.json({ generated: true, generated_at: new Date(), ...data });
}));

// Professional PDF export: reuses the exact same rows/KPIs/themes/coaching
// patterns already computed for the JSON report + coaching sections, plus
// any cached AI notes, so the PDF can never show numbers that disagree with
// what the employee page displays on screen.
router.get("/employee/:agent/pdf", wrap(async (req, res) => {
  const agent = req.params.agent;
  const { since, until } = req.query;
  const lang = req.query.lang === "en" ? "en" : "ar";
  const rows = await employeeRows(agent, since, until);
  const { kpis, themes } = computeKpisAndThemes(rows);
  const opening = patternGroups(rows, "opening_pattern_key", "opening_excerpt");
  const dropout = patternGroups(rows, "dropout_pattern_key", "dropout_point_excerpt");
  const label = (g) => ({ ...g, pattern_label: patternLabel(g.pattern_key, lang) });

  const notesRow = await query("select data, generated_at from ads_ai_insights where k = ?", [empKey(agent, lang)]);
  const notes = notesRow.length ? (typeof notesRow[0].data === "string" ? safe(notesRow[0].data) : notesRow[0].data) : null;

  const html = buildReportHtml({
    agent, lang, period: { since: since || null, until: until || null }, generatedAt: new Date(),
    kpis, themes,
    opening_patterns: opening.groups.map(label), dropout_patterns: dropout.groups.map(label),
    measured_conversations: Math.max(opening.measured, dropout.measured), total_conversations: rows.length,
    notes,
    conversations: rows.map((r) => ({
      full_name: r.full_name, phone: r.phone, date: r.last_message_at, agent_score: r.agent_score,
      conv_score: r.conv_score, lead_intent: r.lead_intent, lead_status: r.lead_status, follow_up_min: r.follow_up_min,
    })),
  });

  const pdf = await htmlToPdf(html);
  const filename = `employee-report-${agent}-${new Date().toISOString().slice(0, 10)}.pdf`.replace(/[^\w.-]+/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(pdf);
}));

// The exact conversation snapshot an analysis was built from (BUG-018 fix) —
// no live Wati call, so this is always available even if Wati is
// slow/unreachable, and always shows precisely what produced the stored
// analysis rather than whatever Wati's API happens to return live today.
router.get("/conversation/:waId/transcript", wrap(async (req, res) => {
  const r = await query("select thread_snapshot, analyzed_at from ads_conversation_analysis where wa_id = ?", [req.params.waId]);
  if (!r.length) return res.json({ available: false });
  const snapshot = typeof r[0].thread_snapshot === "string" ? safe(r[0].thread_snapshot) : r[0].thread_snapshot;
  if (!snapshot) return res.json({ available: false }); // analyzed before this feature shipped
  res.json({ available: true, analyzed_at: r[0].analyzed_at, messages: snapshot });
}));

// ---- AI themes (objections, lost reasons, mistakes, recommendations) ----
router.get("/insights", wrap(async (req, res) => {
  const r = await query("select data, generated_at from ads_ai_insights where k='themes'");
  if (!r.length) return res.json({ generated: false });
  res.json({ generated: true, generated_at: r[0].generated_at, ...(typeof r[0].data === "string" ? safe(r[0].data) : r[0].data) });
}));

router.post("/insights", wrap(async (req, res) => {
  if (!ds.hasKey()) return res.status(400).json({ error: "لا يوجد مفتاح DeepSeek" });
  const rows = await query(
    `select lead_status, summary, customer_details, flags, agent_name, agent_score, wrong_persuasion, agent_eval
     from ads_conversation_analysis order by analyzed_at desc limit 200`);
  if (!rows.length) return res.status(400).json({ error: "لا توجد محادثات محلّلة بعد" });
  const compact = rows.map((r) => {
    const cd = typeof r.customer_details === "string" ? safe(r.customer_details) : (r.customer_details || {});
    const ev = typeof r.agent_eval === "string" ? safe(r.agent_eval) : (r.agent_eval || {});
    return {
      status: r.lead_status, objection: cd.objections, needs: cd.needs,
      flags: (typeof r.flags === "string" ? safe(r.flags) : r.flags) || [],
      agent: r.agent_name, agent_score: r.agent_score, wrong: !!r.wrong_persuasion,
      improvements: ev.improvements || [],
    };
  });
  // The report language follows the UI language at generation time.
  const en = (req.body?.lang) === "en";
  const system = en
    ? `${businessContext("en")}
You are a sales and quality manager here. You have aggregated data from analyzed WhatsApp conversations. Produce practical management insights in English, JSON only.`
    : `${businessContext("ar")}
أنت مدير مبيعات وجودة لهذه الشركة. لديك بيانات مجمّعة من تحليل محادثات.
أنتج رؤى إدارية عملية بالعربية بصيغة JSON فقط.`;
  const user = (en
    ? `Analyze these records (${compact.length} analyzed conversations) and produce JSON shaped like:`
    : `حلّل هذه السجلات (${compact.length} محادثة محلّلة) وأنتج JSON بالشكل:`) + `
{
 "top_objections": [{"objection":"...", "approx_count": ${en ? "number" : "رقم"}, "suggested_response":"${en ? "suggested reply" : "رد مقترح"}"}],
 "lost_reasons": [${en ? '"top reasons customers did not convert"' : '"أهم أسباب عدم تحويل العملاء"'}],
 "agent_common_mistakes": [${en ? '"common agent mistakes"' : '"الأخطاء الشائعة للموظفين"'}],
 "best_practices": [${en ? '"what works and should be generalized"' : '"ما ينجح ويجب تعميمه"'}],
 "ad_messaging_ideas": [${en ? '"ideas to improve ad messaging based on customer objections"' : '"أفكار لتحسين رسائل الإعلانات بناءً على اعتراضات العملاء"'}],
 "management_recommendations": [${en ? '"prioritized management recommendations"' : '"توصيات إدارية ذات أولوية"'}]
}
${en ? "Data:" : "البيانات:"}
${JSON.stringify(compact).slice(0, 50000)}`;
  const out = await ds.chatJSON(system, user);
  await query(
    `insert into ads_ai_insights (k, data) values ('themes', ?) as new on duplicate key update data=new.data, generated_at=now()`,
    [JSON.stringify(out)]
  );
  res.json({ generated: true, generated_at: new Date(), ...out });
}));

function safe(s) { try { return JSON.parse(s); } catch { return {}; } }

export default router;
