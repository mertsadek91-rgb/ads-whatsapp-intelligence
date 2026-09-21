// Aggregates the per-conversation evaluations into per-employee scores for the
// quality board, and snapshots the result.
//
// Division of labour: contactStatus.js owns "did a human reply, and was the lead
// after hours" (already correct and used by the live board), qualityScore.js owns
// the formulas, and this file is the only place that joins them to the AI
// evaluation rows. The board endpoint reads a snapshot — it never lands here on a
// request path, because aggregating thousands of conversations per page load is
// how a wall display starts timing out.
//
// Identity: employees are keyed by ads_wati_contacts.contact_owner, the same key
// the existing salesboard uses, so the two boards always name the same people.
import { query } from "../db.js";
import { gatherContactStatus, rollup as contactRollup } from "./contactStatus.js";
import { dubaiYmd } from "./weeklyReports.js";
import { policyVersion as activePolicyVersion, getProfile } from "./businessProfile.js";
import { isRealProgress as isRealProgressFor } from "./profileDerived.js";

const isRealProgress = (k) => isRealProgressFor(getProfile(), k);
import {
  DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, resolveThresholds, resolveWeights,
  productivityScore, persuasionScore, complianceScore,
  conversionScore, responseScore, overallScore, rankEmployees, scoreConfidence,
} from "./qualityScore.js";

const CALIBRATION_KEY = "quality_calibration";

/**
 * Weights + thresholds from ads_settings, falling back to the defaults.
 *
 * Calibration is an iterative business decision — the owner will move the
 * minimum-sample and minimum-compliance bars several times while comparing the
 * model against supervisor judgement. Requiring a deploy for each change would
 * mean it never happens.
 */
export async function readCalibration() {
  const r = await query("select v from ads_settings where k = ?", [CALIBRATION_KEY]).catch(() => []);
  let raw = {};
  if (r.length) { try { raw = JSON.parse(r[0].v) || {}; } catch { raw = {}; } }
  let weights;
  try { weights = resolveWeights(raw.weights || {}); }
  catch (e) {
    // A stored weight set that no longer totals 100 must not take the board down.
    console.error("[qualityBoard] stored weights rejected, using defaults:", e.message);
    weights = { ...DEFAULT_WEIGHTS };
  }
  return { weights, thresholds: resolveThresholds(raw.thresholds || {}), stored: r.length > 0 };
}

export async function saveCalibration({ weights = {}, thresholds = {} } = {}) {
  const clean = { weights: resolveWeights(weights), thresholds: resolveThresholds(thresholds) };
  await query(
    "insert into ads_settings (k, v) values (?, ?) as new on duplicate key update v=new.v, updated_at=now()",
    [CALIBRATION_KEY, JSON.stringify(clean)]);
  return clean;
}

const AUTOMATION_OWNER = /bot|qualifier|inquiry|counsel|[0-9a-f]{8}-[0-9a-f]{4}-/i;
const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const avg = (xs) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

// A conversation counts toward the conversion denominator only if the AI judged
// the customer genuinely qualified. This is the fairness lever from the design:
// dividing by everyone contacted punishes whoever was handed the wrong numbers.
const QUALIFIED_MIN = 60;

// ...and only if the customer actually came back after the employee replied.
//
// Measured, not assumed: across the live data the qualification score sits flat
// at 70-72 whether the customer sent one message or held a nine-message
// conversation, while the real next-step rate runs 4% for the one-message group
// and 47% for the nine-plus group. So the score alone does not separate a lead
// from a drive-by enquiry, and 41% of the denominator was customers who asked
// one question and vanished. An employee cannot book a next step with someone
// who never answered; counting that as their conversion failure measures lead
// quality and calls it performance.
//
// Those conversations are not deleted — they are counted as `ghosted` and shown
// beside the score, because 41% of qualified leads never replying is a real
// finding about the ads, and hiding it would trade one distortion for another.
//
// A booked next step ALWAYS counts, engagement flag or not. A customer can ask
// for a callback in their very first message, get an acknowledgement, and have
// nothing left to say — no reply after the employee, yet a real conversion. The
// live data caught this: one employee's only win of the week was exactly that
// shape, and gating on engagement alone erased it and took their rate to zero.
// The gate exists to drop leads where nothing COULD happen; if something did,
// it belongs in the denominator.
const reachedNextStep = (e) => e.next_step_reached === 1 && isRealProgress(e.next_step_type);
const isConvertible = (e) => (e.qualification_score ?? 0) >= QUALIFIED_MIN
  && (e.replied_after_agent === 1 || reachedNextStep(e));

const REGISTRATION_STEPS = new Set([
  "registration_started", "registration_completed", "verification_started",
  "verification_completed", "live_account_requested",
]);
const DEPOSIT_STEPS = new Set(["deposit_question", "deposit_intent", "deposit_completed"]);

/** Evaluations in the window, joined to the contact that owns them. */
async function evalRows(since, until, policyVersion) {
  return query(
    `select c.contact_owner owner, e.wa_id,
            e.persuasion_score, e.compliance_score, e.objection_score, e.continuity_score,
            e.professionalism_score, e.next_step_score, e.classification_score,
            e.qualification_score, e.next_step_reached, e.next_step_type,
            e.completed_correctly, e.follow_up_required, e.confidence,
            coalesce(m.replied_after_agent, 0) replied_after_agent
     from ads_conversation_eval e
     join ads_wati_contacts c on c.wa_id = e.wa_id
     left join ads_conversation_meta m on m.wa_id = e.wa_id
     where e.policy_version = ?
       and c.created_date >= ? and c.created_date <= ?`,
    [policyVersion, since, until]);
}

/** Issues in the window, joined to the owning employee. */
async function issueRows(since, until, policyVersion) {
  return query(
    `select c.contact_owner owner, i.wa_id, i.type, i.severity, i.confidence, i.review_status
     from ads_conversation_issue i
     join ads_wati_contacts c on c.wa_id = i.wa_id
     where i.policy_version = ?
       and c.created_date >= ? and c.created_date <= ?`,
    [policyVersion, since, until]);
}

/** How many conversations in the window have an evaluation at all — the coverage
 *  that drives score confidence, so a thin backfill can't masquerade as a verdict. */
async function coverage(since, until, policyVersion) {
  const [r] = await query(
    `select count(*) total,
            sum(case when e.wa_id is null then 0 else 1 end) evaluated
     from ads_wati_contacts c
     join ads_conversation_meta m on m.wa_id = c.wa_id
     left join ads_conversation_eval e on e.wa_id = c.wa_id and e.policy_version = ?
     where c.created_date >= ? and c.created_date <= ?
       and m.human_replied = 1`,
    [policyVersion, since, until]);
  const total = Number(r?.total || 0), evaluated = Number(r?.evaluated || 0);
  return { total, evaluated, pct: total ? Math.round((1000 * evaluated) / total) / 10 : null };
}

/**
 * Team score per day, for the switchable trend chart.
 *
 * Contact rate comes from the per-lead rows (available for every day); the
 * quality scores come from the nightly snapshots, so a day before snapshots
 * started has `null` — the chart must draw a gap there. Showing 0 for "we had
 * not started measuring yet" would read as a catastrophic day.
 */
async function dailySeries(leads, since, days, windowDays) {
  const snaps = await query(
    `select snapshot_date d,
            round(avg(overall),1) overall, round(avg(persuasion),1) persuasion,
            round(avg(compliance),1) compliance, round(avg(conversion),1) conversion,
            round(avg(response),1) response
     from ads_employee_score_snapshot
     where window_days = ? and snapshot_date >= ? group by 1`,
    [windowDays, since]).catch(() => []);
  const byDate = new Map(snaps.map((s) => [
    s.d instanceof Date ? s.d.toISOString().slice(0, 10) : String(s.d).slice(0, 10), s,
  ]));

  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(since, i);
    const dayLeads = leads.filter((l) => l.created_date === date);
    const contacted = dayLeads.filter((l) => l.contacted).length;
    const s = byDate.get(date) || {};
    out.push({
      date,
      label: new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
      leads: dayLeads.length,
      contact_rate: dayLeads.length ? round1((100 * contacted) / dayLeads.length) : null,
      overall: s.overall == null ? null : Number(s.overall),
      persuasion: s.persuasion == null ? null : Number(s.persuasion),
      compliance: s.compliance == null ? null : Number(s.compliance),
      conversion: s.conversion == null ? null : Number(s.conversion),
      response: s.response == null ? null : Number(s.response),
    });
  }
  return out;
}

/**
 * @param {object} opts - { now, days=7, policyVersion, thresholds }
 * @returns per-employee scored + ranked rows, team totals, and the window
 */
export async function gatherQualityBoard({
  now = new Date(), days = 7, policyVersion = activePolicyVersion(), thresholds = null, weights = null,
} = {}) {
  // An explicit override (tests, a what-if preview) wins; otherwise the stored
  // calibration; otherwise the defaults.
  const cal = (thresholds && weights) ? null : await readCalibration();
  const t = thresholds ? resolveThresholds(thresholds) : cal.thresholds;
  const w = weights || cal.weights;
  const today = dubaiYmd(now);
  const cur = { since: addDays(today, -(days - 1)), until: today };
  const prev = { since: addDays(cur.since, -days), until: addDays(cur.since, -1) };

  const [{ leads: curLeads }, evals, issues, cov, prevSnap] = await Promise.all([
    gatherContactStatus(cur.since, cur.until, { now }),
    evalRows(cur.since, cur.until, policyVersion),
    issueRows(cur.since, cur.until, policyVersion),
    coverage(cur.since, cur.until, policyVersion),
    readSnapshot(prev.until, days),
  ]);

  // Only human employees get a row; bot/unassigned leads still count in the team
  // totals via contactStatus, but nobody is scored for them.
  const isHuman = (owner) => owner && !AUTOMATION_OWNER.test(owner);
  const keyOf = (l) => (isHuman(l.owner) ? squash(l.owner) : null);
  const contact = new Map(contactRollup(curLeads, keyOf).map((r) => [r.key, r]));

  // response inputs, per employee, from the same per-lead rows the live board uses
  const respAcc = new Map();
  for (const l of curLeads) {
    const k = keyOf(l);
    if (k == null || l.after_hours) continue;      // judged on working hours only
    const a = respAcc.get(k) || { answerable: 0, within: 0, times: [] };
    a.answerable++;
    if (l.contacted && l.first_human_response_min != null) {
      a.times.push(l.first_human_response_min);
      if (l.first_human_response_min <= t.slaMinutes) a.within++;
    }
    respAcc.set(k, a);
  }

  const evalAcc = new Map();
  for (const e of evals) {
    const k = isHuman(e.owner) ? squash(e.owner) : null;
    if (k == null) continue;
    const a = evalAcc.get(k) || {
      n: 0, dims: { intentUnderstanding: [], answerRelevance: [], objectionHandling: [], continuity: [], professionalism: [], nextStep: [] },
      classification: [], reportedCompliance: [],
      qualified: 0, convertible: 0, ghosted: 0, nextStepReached: 0, registered: 0, depositIntent: 0,
      closable: 0, closedCorrectly: 0, followUpsDue: 0,
    };
    a.n++;
    // The AI's persuasion mark stands in for both intent understanding and answer
    // relevance — it is the only overall persuasion judgement we get per
    // conversation, and the sub-weights then apply as designed.
    if (e.persuasion_score != null) { a.dims.intentUnderstanding.push(e.persuasion_score); a.dims.answerRelevance.push(e.persuasion_score); }
    if (e.objection_score != null) a.dims.objectionHandling.push(e.objection_score);
    if (e.continuity_score != null) a.dims.continuity.push(e.continuity_score);
    if (e.professionalism_score != null) a.dims.professionalism.push(e.professionalism_score);
    if (e.next_step_score != null) a.dims.nextStep.push(e.next_step_score);
    if (e.classification_score != null) a.classification.push(e.classification_score);
    if (e.compliance_score != null) a.reportedCompliance.push(e.compliance_score);

    const qualified = (e.qualification_score ?? 0) >= QUALIFIED_MIN;
    if (qualified) {
      // `qualified` stays the pipeline count the board has always shown; only the
      // conversion denominator is narrowed, so the two numbers can be compared.
      a.qualified++;
      if (!isConvertible(e)) a.ghosted++;
      else {
        a.convertible++;
        if (reachedNextStep(e)) a.nextStepReached++;
        if (REGISTRATION_STEPS.has(e.next_step_type)) a.registered++;
        if (DEPOSIT_STEPS.has(e.next_step_type)) a.depositIntent++;
      }
    }
    a.closable++;
    if (e.completed_correctly) a.closedCorrectly++;
    if (e.follow_up_required) a.followUpsDue++;
    evalAcc.set(k, a);
  }

  const issueAcc = new Map();
  for (const i of issues) {
    const k = isHuman(i.owner) ? squash(i.owner) : null;
    if (k == null) continue;
    const arr = issueAcc.get(k) || [];
    arr.push({ severity: i.severity, confidence: Number(i.confidence), review_status: i.review_status, type: i.type, wa_id: i.wa_id });
    issueAcc.set(k, arr);
  }

  const names = new Set([...contact.keys(), ...evalAcc.keys()]);
  const rows = [...names].map((name) => {
    const c = contact.get(name) || { leads: 0, contacted: 0, not_contacted: 0, interested: 0, after_hours: 0, negligence: 0 };
    const e = evalAcc.get(name);
    const iss = issueAcc.get(name) || [];
    const r = respAcc.get(name) || { answerable: 0, within: 0, times: [] };

    const response = responseScore({
      inHoursAnswerable: r.answerable, withinSla: r.within,
      medianFirstResponseMin: median(r.times),
    }, t);

    const productivity = productivityScore({
      leads: c.leads, contacted: c.contacted, responseScore: response,
      followUpsDue: e?.followUpsDue || 0, followUpsDone: e?.closedCorrectly || 0,
      closable: e?.closable || 0, closedCorrectly: e?.closedCorrectly || 0,
    });

    const persuasion = e ? persuasionScore({
      intentUnderstanding: avg(e.dims.intentUnderstanding),
      answerRelevance: avg(e.dims.answerRelevance),
      objectionHandling: avg(e.dims.objectionHandling),
      continuity: avg(e.dims.continuity),
      professionalism: avg(e.dims.professionalism),
      nextStep: avg(e.dims.nextStep),
    }) : null;

    // Compliance is a RATE, not a running total. complianceScore() deducts from
    // 100 for one conversation's issues, so feeding it a whole window's issues
    // punished volume: measured live, the busiest employee accumulated 25
    // risk-disclosure findings over 49 conversations and floored at 0 while a
    // colleague with 5 conversations sat at 37 — the opposite of what the numbers
    // meant. Score each conversation, then average, so 49 conversations with one
    // problem each read the same as 5 with one problem each.
    const byConversation = new Map();
    for (const x of iss) {
      const arr = byConversation.get(x.wa_id) || [];
      arr.push(x);
      byConversation.set(x.wa_id, arr);
    }
    const evaluatedCount = e?.n || 0;
    let fromIssues = null;
    if (evaluatedCount > 0) {
      let sum = 0;
      for (const arr of byConversation.values()) sum += complianceScore(arr, t);
      // conversations with no issue at all score a clean 100
      const clean = Math.max(0, evaluatedCount - byConversation.size);
      fromIssues = round1((sum + clean * 100) / Math.max(1, byConversation.size + clean));
    } else if (iss.length) {
      fromIssues = complianceScore(iss, t);   // issues but no eval rows: best effort
    }
    // Take the lower of what the model reported and what its own issues imply:
    // a reported 95 alongside a critical finding is not credible.
    const reported = e ? avg(e.reportedCompliance) : null;
    const compliance = fromIssues == null ? (reported == null ? null : round1(reported))
      : (reported == null ? fromIssues : round1(Math.min(reported, fromIssues)));

    const conversion = e ? conversionScore({
      // conversionScore divides by `qualified`; hand it the convertible count so
      // the ghosted leads never enter the denominator.
      qualified: e.convertible, nextStepReached: e.nextStepReached,
      registered: e.registered, depositIntent: e.depositIntent,
    }) : null;

    const confirmedCritical = iss.some((x) => x.severity === "critical" && x.review_status === "confirmed");
    const sampleSize = e?.n || 0;

    // An "overall performance" score needs at least one QUALITY component to
    // mean anything. Without one, overallScore() renormalizes onto productivity
    // alone — so an employee holding a single uncontacted lead appeared on the
    // wall screen as "0.0" next to their name. That is not a performance verdict,
    // it is one missed lead, and the board shows "—" for it now.
    const hasQuality = persuasion != null || compliance != null || conversion != null;
    const o = hasQuality
      ? overallScore({ persuasion, conversion, compliance, productivity, response },
        { sampleSize, analyzedPct: cov.pct, confirmedCritical }, { thresholds: t, weights: w })
      : {
        score: null, raw: null, capped: false, provisional: true,
        confidence: scoreConfidence({ sampleSize, analyzedPct: cov.pct }, t), cap_reason: null,
      };

    const risk = { critical: 0, major: 0, moderate: 0, minor: 0, informational: 0, confirmed: 0, pending: 0 };
    for (const x of iss) {
      if (risk[x.severity] != null) risk[x.severity]++;
      if (x.review_status === "confirmed") risk.confirmed++;
      if (x.review_status === "pending") risk.pending++;
    }

    return {
      name,
      leads: c.leads, contacted: c.contacted, not_contacted: c.not_contacted,
      interested: c.interested, after_hours: c.after_hours, negligence: c.negligence,
      contact_rate_pct: c.leads ? round1((100 * c.contacted) / c.leads) : 0,
      qualified: e?.qualified || 0, next_step: e?.nextStepReached || 0,
      convertible: e?.convertible || 0, ghosted: e?.ghosted || 0,
      productivity, persuasion, compliance, conversion, response,
      overall: o.score, overall_raw: o.raw, capped: o.capped,
      provisional: o.provisional, confidence: o.confidence,
      sample_size: sampleSize, analyzed_pct: cov.pct,
      confirmedCritical, risk,
      median_response_min: round1(median(r.times)),
      avg_response_min: round1(avg(r.times)),
      within_sla: r.within, sla_answerable: r.answerable,
      prev_overall: prevSnap.get(name)?.overall ?? null,
      delta_overall: prevSnap.has(name) && o.score != null
        ? round1(o.score - Number(prevSnap.get(name).overall)) : null,
    };
  });

  const ranked = rankEmployees(rows, { thresholds: t });
  const scored = ranked.filter((r) => r.overall != null);
  const teamSum = (k) => ranked.reduce((s, r) => s + (r[k] || 0), 0);

  const totals = {
    employees: ranked.length,
    leads: teamSum("leads"), contacted: teamSum("contacted"),
    qualified: teamSum("qualified"), convertible: teamSum("convertible"),
    ghosted: teamSum("ghosted"), interested: teamSum("interested"),
    next_step: teamSum("next_step"),
    contact_rate_pct: teamSum("leads") ? round1((100 * teamSum("contacted")) / teamSum("leads")) : 0,
    // Team SLA counts: the board's "conversations over SLA" card derived these
    // from fields that were never emitted, so it displayed a confident 0 for a
    // number nobody had computed.
    within_sla: teamSum("within_sla"), sla_answerable: teamSum("sla_answerable"),
    quality_score: round1(avg(scored.map((r) => r.persuasion).filter((x) => x != null))),
    compliance_score: round1(avg(scored.map((r) => r.compliance).filter((x) => x != null))),
    conversion_score: round1(avg(scored.map((r) => r.conversion).filter((x) => x != null))),
    overall_score: round1(avg(scored.map((r) => r.overall))),
    critical_open: ranked.reduce((s, r) => s + r.risk.critical, 0),
    pending_review: ranked.reduce((s, r) => s + r.risk.pending, 0),
  };

  const eligible = ranked.filter((r) => r.eligible);
  const byMetric = (k) => {
    const c = eligible.filter((r) => r[k] != null).sort((a, b) => b[k] - a[k]);
    return c.length ? c[0] : null;
  };
  const improved = ranked.filter((r) => r.delta_overall != null && r.delta_overall > 0)
    .sort((a, b) => b.delta_overall - a.delta_overall)[0] || null;

  return {
    window: cur, prevWindow: prev, days, policy_version: policyVersion,
    thresholds: t, weights: w, calibrated: !!cal?.stored, coverage: cov,
    rows: ranked, totals,
    daily: await dailySeries(curLeads, cur.since, days, days),
    highlights: {
      top_performer: eligible[0] || null,
      best_persuasion: byMetric("persuasion"),
      best_conversion: byMetric("conversion"),
      most_improved: improved,
    },
    generatedAt: new Date(now).toISOString(),
  };
}

// ------------------------------------------------------------------ snapshots

/** Previous-period snapshot, keyed by employee, for the day-over-day deltas. */
export async function readSnapshot(date, windowDays) {
  const rows = await query(
    "select agent_name, overall, persuasion, compliance, conversion from ads_employee_score_snapshot where snapshot_date = ? and window_days = ?",
    [date, windowDays]).catch(() => []);
  return new Map(rows.map((r) => [r.agent_name, r]));
}

/** Persist today's scores. Upsert, so re-running the nightly job is harmless. */
export async function saveSnapshot(board, { date = null } = {}) {
  const snapDate = date || board.window.until;
  let saved = 0;
  for (const r of board.rows) {
    await query(
      `insert into ads_employee_score_snapshot
         (snapshot_date, agent_name, window_days, productivity, persuasion, compliance,
          conversion, response, overall, overall_raw, sample_size, analyzed_pct,
          confidence, eligible_top, ineligible_reasons, components)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       as new on duplicate key update
         productivity=new.productivity, persuasion=new.persuasion, compliance=new.compliance,
         conversion=new.conversion, response=new.response, overall=new.overall,
         overall_raw=new.overall_raw, sample_size=new.sample_size, analyzed_pct=new.analyzed_pct,
         confidence=new.confidence, eligible_top=new.eligible_top,
         ineligible_reasons=new.ineligible_reasons, components=new.components`,
      [snapDate, r.name, board.days, r.productivity, r.persuasion, r.compliance,
       r.conversion, r.response, r.overall, r.overall_raw, r.sample_size, r.analyzed_pct,
       r.confidence, r.eligible ? 1 : 0, JSON.stringify(r.reasons || []),
       JSON.stringify({
         leads: r.leads, contacted: r.contacted, qualified: r.qualified,
         next_step: r.next_step, risk: r.risk, within_sla: r.within_sla,
         sla_answerable: r.sla_answerable, median_response_min: r.median_response_min,
       })]
    );
    saved++;
  }
  return { snapshot_date: snapDate, window_days: board.days, saved };
}

/**
 * Conversations still missing an evaluation for the current policy — the work
 * list for the backfill. Restricted to a recent window on purpose: the full
 * history is 5.4k human-handled conversations, and re-evaluating all of it would
 * spend days of AI budget to score periods nobody is being reviewed on.
 */
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

/**
 * Resolve a scan window. An explicit since/until wins over `days`, so the owner
 * can point the evaluator at one specific period — "re-check last March" — rather
 * than only ever the trailing N days.
 */
export function scanWindow({ since = null, until = null, days = 30, now = new Date() } = {}) {
  const today = dubaiYmd(now);
  if (isYmd(since)) {
    const end = isYmd(until) ? until : today;
    // A backwards range would silently match nothing; swap rather than surprise.
    return since <= end ? { since, until: end } : { since: end, until: since };
  }
  const n = Math.min(Math.max(parseInt(days, 10) || 30, 1), 730);
  return { since: addDays(today, -(n - 1)), until: today };
}

export async function pendingEvaluation({
  days = 30, since = null, until = null, limit = 200,
  policyVersion = activePolicyVersion(), now = new Date(),
} = {}) {
  const w = scanWindow({ since, until, days, now });
  const rows = await query(
    `select c.wa_id
     from ads_wati_contacts c
     join ads_conversation_meta m on m.wa_id = c.wa_id
     left join ads_conversation_eval e on e.wa_id = c.wa_id and e.policy_version = ?
     where c.created_date >= ? and c.created_date <= ? and m.human_replied = 1 and e.wa_id is null
     order by c.last_message_at desc
     limit ${Math.min(Math.max(parseInt(limit, 10) || 200, 1), 2000)}`,
    [policyVersion, w.since, w.until]);
  return rows.map((r) => r.wa_id);
}

export default {
  gatherQualityBoard, saveSnapshot, readSnapshot, pendingEvaluation, scanWindow,
  QUALIFIED_MIN,
};
