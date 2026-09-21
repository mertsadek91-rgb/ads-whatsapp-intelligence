// Supervisor review of AI-detected compliance issues.
//
// The whole point of this layer: the AI proposes, a human decides. A pending
// issue already costs the employee compliance points (confidence-scaled), but
// only a CONFIRMED critical one caps their overall score, and a REJECTED issue
// costs nothing at all — so the review queue is what stands between a model's
// guess and a judgement about someone's work.
//
// Every decision is stored with who made it and when, and re-analysis never
// overwrites it (see the upsert in conversationAnalysis.persistEvaluation).
import { query } from "../db.js";
import { countryOf } from "./phoneCountry.js";
import { POLICY_VERSION, issueLabel, SEVERITIES } from "./compliancePolicy.js";
import { agentLabel } from "./reportI18n.js";

export const REVIEW_ACTIONS = ["confirm", "reject", "severity"];
const STATUSES = ["pending", "confirmed", "rejected"];

/**
 * The review queue. Ordered by severity then confidence, so the findings that
 * can actually cap someone's score are triaged first.
 */
export async function listIssues({
  status = "pending", severity, agent, type, days = 30, limit = 50, offset = 0,
  policyVersion = POLICY_VERSION, lang = "ar",
} = {}) {
  const where = ["i.policy_version = ?"], params = [policyVersion];
  if (status && status !== "all") {
    if (!STATUSES.includes(status)) throw new Error(`unknown review status: ${status}`);
    where.push("i.review_status = ?"); params.push(status);
  }
  if (severity) { where.push("i.severity = ?"); params.push(severity); }
  if (type) { where.push("i.type = ?"); params.push(type); }
  if (agent) {
    where.push("trim(regexp_replace(coalesce(c.contact_owner,''), '[[:space:]]+', ' ')) = trim(regexp_replace(?, '[[:space:]]+', ' '))");
    params.push(agent);
  }
  if (days) { where.push("c.created_date >= date_sub(curdate(), interval ? day)"); params.push(Number(days)); }

  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  const clause = where.join(" and ");

  const [rows, [cnt]] = await Promise.all([
    query(
      `select i.id, i.wa_id, i.type, i.severity, i.confidence, i.evidence,
              i.context_explanation, i.recommended_alternative, i.review_status,
              i.reviewed_by, i.reviewed_at, i.reviewer_note, i.created_at,
              c.contact_owner owner, c.full_name customer, c.phone, c.created_date,
              e.confidence eval_confidence, e.persuasion_score, e.compliance_score
       from ads_conversation_issue i
       join ads_wati_contacts c on c.wa_id = i.wa_id
       left join ads_conversation_eval e on e.wa_id = i.wa_id and e.policy_version = i.policy_version
       where ${clause}
       order by field(i.severity,'critical','major','moderate','minor','informational'),
                i.confidence desc, i.created_at desc
       limit ${lim} offset ${off}`, params),
    query(
      `select count(*) total from ads_conversation_issue i
       join ads_wati_contacts c on c.wa_id = i.wa_id where ${clause}`, params),
  ]);

  return {
    total: Number(cnt?.total || 0), limit: lim, offset: off,
    rows: rows.map((r) => ({
      ...r,
      confidence: Number(r.confidence),
      type_label: issueLabel(r.type, lang),
      owner_label: agentLabel(r.owner, lang),
      // Below the floor an issue is recorded but costs nothing — say so, rather
      // than letting a supervisor assume every row is already a deduction.
      scoring: Number(r.confidence) < 0.70 ? "not_scored"
        : r.review_status === "rejected" ? "dismissed" : "scored",
    })),
  };
}

/**
 * The stored conversation around the flagged message. Reads thread_snapshot —
 * the exact thread the AI saw — so a supervisor judges what the model judged,
 * not a re-fetch that may have changed since.
 */
export async function issueContext(id, { window = 6 } = {}) {
  // The supervisor is deciding whether to hold an employee to a critical
  // finding, so the row carries who the customer actually was: the number to
  // call back, where they came from, and how the conversation was read. This is
  // the authenticated review page — the kiosk never reaches it.
  const [row] = await query(
    `select i.*, c.full_name customer, c.phone, c.contact_owner owner,
            c.wa_id, c.country_iso2, c.stage, c.created_date, c.source_ad_id,
            c.last_message_at, c.num_messages,
            p.campaign_name, p.ad_name,
            m.conv_type, m.customer_msgs, m.agent_msgs, m.bot_msgs,
            m.first_human_response_min, m.replied_after_agent,
            a.thread_snapshot, a.summary, a.lead_intent, a.lead_status, a.conv_score,
            e.qualification_score
     from ads_conversation_issue i
     join ads_wati_contacts c on c.wa_id = i.wa_id
     left join ads_meta_ad_perf p on p.ad_id = c.source_ad_id
     left join ads_conversation_meta m on m.wa_id = i.wa_id
     left join ads_conversation_analysis a on a.wa_id = i.wa_id
     left join ads_conversation_eval e on e.wa_id = i.wa_id and e.policy_version = i.policy_version
     where i.id = ?`, [id]);
  if (!row) return null;

  let thread = row.thread_snapshot;
  if (typeof thread === "string") { try { thread = JSON.parse(thread); } catch { thread = null; } }
  if (!Array.isArray(thread)) thread = [];

  // Locate the quoted message by content — the model's own message id is not
  // trustworthy (the validator clears invented ones), but the quote is.
  const needle = String(row.evidence || "").replace(/\s+/g, " ").trim().slice(0, 60).toLowerCase();
  let idx = -1;
  if (needle) {
    idx = thread.findIndex((m) => String(m?.body || "").replace(/\s+/g, " ").toLowerCase().includes(needle));
  }
  const from = idx < 0 ? Math.max(0, thread.length - window * 2) : Math.max(0, idx - window);
  const to = idx < 0 ? thread.length : Math.min(thread.length, idx + window + 1);

  return {
    id: row.id, wa_id: row.wa_id, type: row.type, severity: row.severity,
    confidence: Number(row.confidence), evidence: row.evidence,
    context_explanation: row.context_explanation,
    recommended_alternative: row.recommended_alternative,
    review_status: row.review_status, reviewed_by: row.reviewed_by, reviewer_note: row.reviewer_note,
    customer: row.customer, phone: row.phone, owner: row.owner, summary: row.summary,
    // Everything a supervisor needs to judge the finding without leaving the popup.
    contact: {
      wa_id: row.wa_id,
      country: row.country_iso2 ? countryOf(row.phone) : null,
      stage: row.stage || null,
      created_date: row.created_date,
      last_message_at: row.last_message_at,
      campaign: row.campaign_name || null,
      ad: row.ad_name || null,
      messages: row.num_messages ?? null,
      customer_msgs: row.customer_msgs ?? null,
      agent_msgs: row.agent_msgs ?? null,
      bot_msgs: row.bot_msgs ?? null,
      conv_type: row.conv_type || null,
      first_human_response_min: row.first_human_response_min == null ? null : Number(row.first_human_response_min),
      replied_after_agent: row.replied_after_agent === 1,
      lead_intent: row.lead_intent || null,
      lead_status: row.lead_status || null,
      conv_score: row.conv_score ?? null,
      qualification_score: row.qualification_score ?? null,
    },
    evidence_found: idx >= 0,
    messages: thread.slice(from, to).map((m, i) => ({
      i: from + i, ts: m.ts, dir: m.dir, sender: m.sender, body: m.body,
      flagged: idx >= 0 && from + i === idx,
    })),
    truncated: { before: from, after: Math.max(0, thread.length - to), total: thread.length },
  };
}

/**
 * Record a supervisor decision.
 *
 * `reviewer` comes from the authenticated session, never from the request body —
 * a compliance decision that anyone could attribute to anyone else is worthless
 * as an audit trail.
 */
export async function reviewIssue(id, { action, severity, note, reviewer }) {
  if (!REVIEW_ACTIONS.includes(action)) throw new Error(`unknown review action: ${action}`);
  if (!reviewer) throw new Error("reviewer is required");

  const [existing] = await query("select id, severity from ads_conversation_issue where id = ?", [id]);
  if (!existing) return null;

  let status = existing.review_status;
  let newSeverity = existing.severity;
  if (action === "confirm") status = "confirmed";
  if (action === "reject") status = "rejected";
  if (action === "severity") {
    if (!SEVERITIES.includes(severity)) throw new Error(`unknown severity: ${severity}`);
    // A supervisor changing the severity is confirming the finding exists.
    newSeverity = severity;
    status = "confirmed";
  }

  await query(
    `update ads_conversation_issue
     set review_status = ?, severity = ?, reviewed_by = ?, reviewed_at = now(), reviewer_note = ?
     where id = ?`,
    [status, newSeverity, String(reviewer).slice(0, 191), note ? String(note).slice(0, 2000) : null, id]);

  const [row] = await query("select * from ads_conversation_issue where id = ?", [id]);
  return row;
}

/** Queue counts by status and severity — the triage header. */
export async function reviewSummary({ days = 30, policyVersion = POLICY_VERSION } = {}) {
  const rows = await query(
    `select i.review_status status, i.severity, count(*) n
     from ads_conversation_issue i
     join ads_wati_contacts c on c.wa_id = i.wa_id
     where i.policy_version = ? and c.created_date >= date_sub(curdate(), interval ? day)
     group by 1,2`, [policyVersion, Number(days)]);
  const out = { pending: 0, confirmed: 0, rejected: 0, critical_pending: 0, by_severity: {} };
  for (const r of rows) {
    const n = Number(r.n);
    if (out[r.status] != null) out[r.status] += n;
    out.by_severity[r.severity] = (out.by_severity[r.severity] || 0) + n;
    if (r.status === "pending" && r.severity === "critical") out.critical_pending += n;
  }
  return out;
}

/**
 * What to coach, per employee: the issue types that keep recurring, with a
 * recommended alternative to use as the teaching example.
 *
 * Rejected issues are excluded — training built on findings a supervisor threw
 * out would teach the wrong lesson. Pending ones are included but counted
 * separately, so a manager can see what is still unverified.
 */
export async function trainingInsights({ days = 30, agent, policyVersion = POLICY_VERSION, lang = "ar", limit = 6 } = {}) {
  const where = ["i.policy_version = ?", "i.review_status <> 'rejected'",
    "c.created_date >= date_sub(curdate(), interval ? day)"];
  const params = [policyVersion, Number(days)];
  if (agent) {
    where.push("trim(regexp_replace(coalesce(c.contact_owner,''), '[[:space:]]+', ' ')) = trim(regexp_replace(?, '[[:space:]]+', ' '))");
    params.push(agent);
  }
  // Grouped by TYPE, not by (type, severity). The same weakness graded major on
  // one conversation and moderate on another is one thing to coach — listing it
  // twice ("risk_disclosure_missing x17, risk_disclosure_missing x15") reads as a
  // bug and splits the count that should drive the priority. The worst severity
  // seen is reported alongside.
  const rows = await query(
    `select trim(regexp_replace(coalesce(c.contact_owner,''), '[[:space:]]+', ' ')) owner,
            i.type,
            min(field(i.severity,'critical','major','moderate','minor','informational')) worst,
            count(*) n,
            sum(case when i.review_status = 'confirmed' then 1 else 0 end) confirmed,
            min(nullif(i.recommended_alternative,'')) example
     from ads_conversation_issue i
     join ads_wati_contacts c on c.wa_id = i.wa_id
     where ${where.join(" and ")}
     group by 1,2 order by owner, n desc`, params);

  const SEV_BY_RANK = ["", "critical", "major", "moderate", "minor", "informational"];
  const byOwner = new Map();
  for (const r of rows) {
    if (!r.owner) continue;
    const o = byOwner.get(r.owner) || { owner: r.owner, owner_label: agentLabel(r.owner, lang), total: 0, patterns: [] };
    o.total += Number(r.n);
    o.patterns.push({
      type: r.type, type_label: issueLabel(r.type, lang),
      severity: SEV_BY_RANK[Number(r.worst)] || null,
      count: Number(r.n), confirmed: Number(r.confirmed), example: r.example || null,
    });
    byOwner.set(r.owner, o);
  }
  return [...byOwner.values()].map((o) => ({
    ...o,
    patterns: o.patterns.sort((a, b) => b.count - a.count).slice(0, limit),
  })).sort((a, b) => b.total - a.total);
}

export default { listIssues, issueContext, reviewIssue, reviewSummary, trainingInsights, REVIEW_ACTIONS };
