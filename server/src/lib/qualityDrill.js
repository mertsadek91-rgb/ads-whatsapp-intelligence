// Drill-down behind a number on the quality board: which customers, exactly.
//
// The hard requirement is that the popup AGREES with the figure it was opened
// from. A drill-down that shows 261 rows under a card reading 265 is worse than
// no drill-down at all — so this does not re-derive the population with its own
// SQL. It calls the same gatherContactStatus() the board calls and applies the
// same predicates, then looks up names and conversation detail for exactly the
// ids that survive.
//
// This module returns customer names and phone numbers, so it is only ever
// reachable from the AUTHENTICATED route — never from the kiosk token.
import { query } from "../db.js";
import { gatherContactStatus } from "./contactStatus.js";
import { dubaiYmd } from "./weeklyReports.js";
import { policyVersion as activePolicyVersion, getProfile } from "./businessProfile.js";
import { issueLabel as issueLabelFor, isRealProgress as isRealProgressFor } from "./profileDerived.js";

const issueLabel = (k, lang) => issueLabelFor(getProfile(), k, lang);
const isRealProgress = (k) => isRealProgressFor(getProfile(), k);

const AUTOMATION_OWNER = /bot|qualifier|inquiry|counsel|[0-9a-f]{8}-[0-9a-f]{4}-/i;
const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isHuman = (o) => o && !AUTOMATION_OWNER.test(o);

/** The metrics a number on the board can be drilled into. */
export const DRILL_METRICS = {
  leads: { ar: "كل العملاء", en: "All leads" },
  contacted: { ar: "تم التواصل معهم", en: "Contacted" },
  not_contacted: { ar: "لم يُتواصل معهم", en: "Not contacted" },
  after_hours: { ar: "لم يُتواصل — خارج الدوام", en: "Not contacted — after hours" },
  negligence: { ar: "لم يُتواصل — خلال الدوام", en: "Not contacted — during hours" },
  interested: { ar: "المهتمّون", en: "Interested" },
  qualified: { ar: "المؤهّلون", en: "Qualified" },
  next_step: { ar: "وصلوا لخطوة تالية", en: "Reached a next step" },
  ghosted: { ar: "مؤهّلون لم يردّوا بعد ردّ الموظف", en: "Qualified — never replied after we did" },
  over_sla: { ar: "تجاوزوا زمن الرد المستهدف", en: "Over the response target" },
  risk: { ar: "محادثات فيها مخالفة", en: "Conversations with a finding" },
};
export const isDrillMetric = (m) => Object.prototype.hasOwnProperty.call(DRILL_METRICS, m);

/**
 * @param {object} o - { metric, agent?, days=7, limit=300, lang, now, slaMinutes }
 * @returns { metric, label, agent, total, truncated, rows[] }
 */
export async function drill({
  metric, agent = null, days = 7, limit = 300, lang = "ar",
  now = new Date(), slaMinutes = 30, policyVersion = activePolicyVersion(),
} = {}) {
  if (!isDrillMetric(metric)) throw new Error(`unknown drill metric: ${metric}`);
  const today = dubaiYmd(now);
  const since = addDays(today, -(days - 1));

  const { leads } = await gatherContactStatus(since, today, { now });

  // Same exclusions the board applies, so the denominators line up.
  let pool = leads.filter((l) => l.status !== "no_human_needed" && l.status !== "channel_unavailable");
  if (agent) pool = pool.filter((l) => squash(l.owner) === squash(agent));
  else pool = pool.filter((l) => isHuman(l.owner));

  // Evaluation-driven metrics need the eval rows keyed by wa_id.
  let evalBy = new Map();
  if (["qualified", "next_step", "risk", "ghosted"].includes(metric)) {
    const rows = await query(
      `select e.wa_id, e.qualification_score, e.next_step_reached, e.next_step_type,
              coalesce(m.replied_after_agent, 0) replied_after_agent
       from ads_conversation_eval e
       left join ads_conversation_meta m on m.wa_id = e.wa_id
       where e.policy_version = ?`, [policyVersion]);
    evalBy = new Map(rows.map((r) => [r.wa_id, r]));
  }

  let picked;
  switch (metric) {
    case "leads": picked = pool; break;
    case "contacted": picked = pool.filter((l) => l.contacted); break;
    case "not_contacted": picked = pool.filter((l) => !l.contacted); break;
    case "after_hours": picked = pool.filter((l) => !l.contacted && l.after_hours); break;
    case "negligence": picked = pool.filter((l) => !l.contacted && !l.after_hours); break;
    case "interested": picked = pool.filter((l) => l.interested); break;
    case "qualified": picked = pool.filter((l) => (evalBy.get(l.wa_id)?.qualification_score ?? 0) >= 60); break;
    // Must mirror the board exactly, including isRealProgress — without it the
    // popup counted 30 where the card read 28, because "the customer asked for
    // information" is a next_step_type but not progress toward an account.
    case "next_step": picked = pool.filter((l) => {
      const e = evalBy.get(l.wa_id);
      return e && e.next_step_reached === 1 && (e.qualification_score ?? 0) >= 60
        && isRealProgress(e.next_step_type);
    }); break;
    // The leads removed from the conversion denominator. Clicking the count is
    // the whole point of keeping it visible: these are ad-quality cases, and a
    // supervisor should be able to read the actual conversations and judge.
    case "ghosted": picked = pool.filter((l) => {
      const e = evalBy.get(l.wa_id);
      return e && (e.qualification_score ?? 0) >= 60 && e.replied_after_agent !== 1;
    }); break;
    // In working hours, answered late or not at all — the same population the
    // response score is built from.
    case "over_sla": picked = pool.filter((l) => !l.after_hours
      && (!l.contacted || l.first_human_response_min == null || l.first_human_response_min > slaMinutes)); break;
    case "risk": {
      const iss = await query(
        `select wa_id, type, severity, confidence, review_status
         from ads_conversation_issue where policy_version = ? and review_status <> 'rejected'`,
        [policyVersion]);
      const byWa = new Map();
      for (const i of iss) {
        const arr = byWa.get(i.wa_id) || [];
        arr.push(i);
        byWa.set(i.wa_id, arr);
      }
      picked = pool.filter((l) => byWa.has(l.wa_id));
      picked = picked.map((l) => ({ ...l, _issues: byWa.get(l.wa_id) }));
      break;
    }
    default: picked = [];
  }

  const total = picked.length;
  // Newest activity first — the ones worth acting on today.
  picked.sort((a, b) => new Date(b.last_activity || 0) - new Date(a.last_activity || 0));
  const page = picked.slice(0, Math.min(Math.max(parseInt(limit, 10) || 300, 1), 1000));

  const detail = page.length ? await detailFor(page.map((l) => l.wa_id)) : new Map();

  return {
    metric, label: DRILL_METRICS[metric][lang === "en" ? "en" : "ar"],
    agent: agent || null, days, window: { since, until: today },
    total, shown: page.length, truncated: total > page.length,
    rows: page.map((l) => {
      const d = detail.get(l.wa_id) || {};
      return {
        // Phone comes from the contacts row: the shaped contactStatus lead does
        // not carry it, so reading l.phone put `undefined` in every row of a
        // popup whose entire purpose is showing the numbers.
        wa_id: l.wa_id, phone: d.phone || l.phone || null, full_name: d.full_name || null,
        owner: l.owner || null, country: d.country || null, stage: l.stage,
        created_date: l.created_date, last_activity: l.last_activity,
        messages: d.num_messages ?? null, customer_msgs: d.customer_msgs ?? null,
        conv_type: d.conv_type || null, campaign: d.campaign_name || null,
        contacted: !!l.contacted, after_hours: !!l.after_hours,
        first_human_response_min: l.first_human_response_min,
        interested: !!l.interested, status: l.status,
        // Both readings travel with the row, plus whether they disagree. A lead
        // parked in Wati's "Qualified" whose transcript says they refused is a
        // pipeline that needs correcting there, and hiding that would just make
        // the number quietly wrong in a different way.
        ai_intent: l.ai_intent || null, interest_conflict: !!l.interest_conflict,
        conv_score: d.conv_score ?? null, lead_status: d.lead_status || null,
        summary: d.summary || null,
        issues: (l._issues || []).map((i) => ({
          type: i.type, type_label: issueLabel(i.type, lang),
          severity: i.severity, confidence: Number(i.confidence), review_status: i.review_status,
        })),
      };
    }),
  };
}

/** Names, campaign and conversation detail for a batch of ids, in one query. */
async function detailFor(ids) {
  const rows = await query(
    `select c.wa_id, c.full_name, c.phone, c.country, c.num_messages,
            m.customer_msgs, m.conv_type, p.campaign_name,
            a.conv_score, a.lead_status, a.summary
     from ads_wati_contacts c
     left join ads_conversation_meta m on m.wa_id = c.wa_id
     left join ads_meta_ad_perf p on p.ad_id = c.source_ad_id
     left join ads_conversation_analysis a on a.wa_id = c.wa_id
     where c.wa_id in (${ids.map(() => "?").join(",")})`, ids);
  return new Map(rows.map((r) => [r.wa_id, r]));
}

export default { drill, DRILL_METRICS, isDrillMetric };
