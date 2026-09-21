// Sales-floor leaderboard data: per-employee, over a rolling window, how many
// leads they received, how many they actually contacted (human reply), the
// contact rate, interested customers, and wrong-persuasion cases — ranked by
// contact rate to motivate the team to leave no lead untouched. Also team
// totals, a week-over-week delta per employee, and the top performer.
import { query } from "../db.js";
import { gatherContactStatus, rollup as contactRollup } from "./contactStatus.js";
import { dubaiYmd } from "./weeklyReports.js";

// Wati owner names that are automations, not human employees.
const AUTOMATION_OWNER = /bot|qualifier|inquiry|counsel|[0-9a-f]{8}-[0-9a-f]{4}-/i;
const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export const CONTACT_TARGET_PCT = 90; // the green line the team aims to beat

/** Wrong-persuasion counts per agent over a window, keyed by squashed name. */
async function wrongPersuasionByAgent(since, until) {
  const rows = await query(
    `select coalesce(nullif(agent_name,''),'') agent, sum(case when wrong_persuasion=1 then 1 else 0 end) w
     from ads_conversation_analysis
     where analyzed_at >= ? and analyzed_at < (date_add(?, interval 1 day))
     group by agent`, [since, until]);
  const map = new Map();
  for (const r of rows) { const k = squash(r.agent); if (k) map.set(k, Number(r.w) || 0); }
  return map;
}

function rateOf(row) { return row.leads ? Math.round((1000 * row.contacted) / row.leads) / 10 : 0; }

// Business status bands (independent of the display target): excellent ≥75%,
// average ≥40%, poor below, inactive when the employee got no leads.
function statusOf(rate, leads) {
  if (!leads) return "inactive";
  if (rate >= 75) return "excellent";
  if (rate >= 40) return "average";
  return "poor";
}

const AR_WEEKDAY = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** Average first-human-response minutes per rollup key (contacted leads only). */
function avgResponseByKey(leads, keyOf) {
  const acc = {};
  for (const l of leads) {
    if (!l.contacted || l.first_human_response_min == null) continue;
    const k = keyOf(l); if (k == null) continue;
    (acc[k] ||= { sum: 0, n: 0 }); acc[k].sum += l.first_human_response_min; acc[k].n++;
  }
  const out = {};
  for (const [k, v] of Object.entries(acc)) out[k] = v.n ? Math.round((v.sum / v.n) * 10) / 10 : null;
  return out;
}

/** Contact rate per calendar day across the window (by lead arrival day). */
function dailySeries(leads, since, days) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(since, i);
    const dayLeads = leads.filter((l) => l.created_date === date);
    const contacted = dayLeads.filter((l) => l.contacted).length;
    const rate = dayLeads.length ? Math.round((1000 * contacted) / dayLeads.length) / 10 : 0;
    out.push({ date, label: AR_WEEKDAY[new Date(date + "T00:00:00Z").getUTCDay()], leads: dayLeads.length, contacted, rate });
  }
  return out;
}

/**
 * @param {object} opts - { now, days=7 }
 * @returns { window, prevWindow, target, rows[], totals, top, generatedAt }
 */
export async function gatherSalesboard({ now = new Date(), days = 7 } = {}) {
  const today = dubaiYmd(now);
  const cur = { since: addDays(today, -(days - 1)), until: today };
  const prev = { since: addDays(cur.since, -days), until: addDays(cur.since, -1) };

  const [{ leads: curLeads }, { leads: prevLeads }, wrong, wrongPrev] = await Promise.all([
    gatherContactStatus(cur.since, cur.until, { now }),
    gatherContactStatus(prev.since, prev.until, { now }),
    wrongPersuasionByAgent(cur.since, cur.until),
    wrongPersuasionByAgent(prev.since, prev.until),
  ]);

  // Every lead counts (owner's rule). Human agents get their own rows; leads
  // owned by the bot or nobody go into an "Unassigned / Bot" bucket so the
  // total reconciles and the coverage gap is visible. contactRollup itself
  // drops only no_customer (no one to contact) and channel_unavailable (a
  // second-number data gap) — bot-only chats DO count as not-contacted.
  const KEY_UNASSIGNED = "__unassigned__";
  const keyOf = (l) => (l.owner && !AUTOMATION_OWNER.test(l.owner)) ? squash(l.owner) : KEY_UNASSIGNED;
  const curRoll = contactRollup(curLeads, keyOf);
  const prevRoll = contactRollup(prevLeads, keyOf);
  const prevRate = new Map(prevRoll.map((r) => [r.key, rateOf(r)]));
  const resp = avgResponseByKey(curLeads, keyOf);

  const shape = (r) => {
    const rate = rateOf(r);
    const pr = prevRate.has(r.key) ? prevRate.get(r.key) : null;
    return {
      name: r.key, leads: r.leads, contacted: r.contacted, not_contacted: r.not_contacted,
      contact_rate_pct: rate, interested: r.interested,
      wrong_persuasion: r.key === KEY_UNASSIGNED ? 0 : (wrong.get(r.key) || 0),
      after_hours: r.after_hours, negligence: r.negligence,
      avg_response_min: resp[r.key] ?? null, status: statusOf(rate, r.leads),
      prev_contact_rate_pct: pr, delta_pct: pr == null ? null : Math.round((rate - pr) * 10) / 10,
      hit_target: rate >= CONTACT_TARGET_PCT,
    };
  };

  const allRows = curRoll.map(shape);
  const unassignedRow = allRows.find((r) => r.name === KEY_UNASSIGNED) || null;
  let rows = allRows.filter((r) => r.name !== KEY_UNASSIGNED);
  rows.sort((a, b) => b.contact_rate_pct - a.contact_rate_pct || b.contacted - a.contacted || b.leads - a.leads);
  rows = rows.map((r, i) => ({ ...r, rank: i + 1 }));

  // Team totals span everyone (human rows + the unassigned/bot bucket).
  const forTotals = [...rows, ...(unassignedRow ? [unassignedRow] : [])];
  const sum = (k) => forTotals.reduce((s, r) => s + (r[k] || 0), 0);
  const tLeads = sum("leads"), tContacted = sum("contacted"), tInterested = sum("interested");

  // Assessable = customer engaged + a channel we can read (excludes no_customer
  // ghosts + second-number). Drives the response-time + daily metrics.
  const assessable = curLeads.filter((l) => l.status !== "no_human_needed" && l.status !== "channel_unavailable");
  const within2h = assessable.filter((l) => l.contacted && l.first_human_response_min != null && l.first_human_response_min <= 120).length;
  const respAll = assessable.filter((l) => l.contacted && l.first_human_response_min != null).map((l) => l.first_human_response_min);
  const teamAvgResp = respAll.length ? Math.round((respAll.reduce((s, n) => s + n, 0) / respAll.length) * 10) / 10 : null;
  const prevAssessable = prevLeads.filter((l) => l.status !== "no_human_needed" && l.status !== "channel_unavailable").length;
  const unavailableCount = curLeads.filter((l) => l.status === "channel_unavailable").length;
  const noCustomerCount = curLeads.filter((l) => l.status === "no_human_needed").length;
  const wrongPrevTotal = [...wrongPrev.values()].reduce((s, n) => s + n, 0);
  const wrongCurTotal = sum("wrong_persuasion");

  const totals = {
    employees: rows.length,
    leads: tLeads, contacted: tContacted, not_contacted: sum("not_contacted"),
    interested: tInterested, wrong_persuasion: wrongCurTotal,
    contact_rate_pct: tLeads ? Math.round((1000 * tContacted) / tLeads) / 10 : 0,
    within_2h: within2h, avg_response_min: teamAvgResp,
    interested_rate_pct: tContacted ? Math.round((1000 * tInterested) / tContacted) / 10 : 0,
    leads_prev: prevAssessable,
    leads_delta_pct: prevAssessable ? Math.round(((tLeads - prevAssessable) / prevAssessable) * 1000) / 10 : null,
    wrong_prev: wrongPrevTotal, wrong_delta: wrongCurTotal - wrongPrevTotal,
    unavailable: unavailableCount, no_customer: noCustomerCount,
  };

  return {
    window: cur, prevWindow: prev, days, target: CONTACT_TARGET_PCT,
    rows, unassigned: unassignedRow, totals,
    daily: dailySeries(assessable, cur.since, days),
    top: rows.length && rows[0].leads > 0 ? rows[0] : null,
    generatedAt: now.toISOString(),
  };
}

export default { gatherSalesboard, CONTACT_TARGET_PCT };
