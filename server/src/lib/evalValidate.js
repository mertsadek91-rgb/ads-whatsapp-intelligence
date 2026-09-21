// Turns the AI's raw evaluation JSON into rows that are safe to store and safe
// to score from.
//
// The contract is deliberately one-directional: this function NEVER throws and
// NEVER returns a shape the caller has to guard. An LLM will eventually return a
// string where a number belongs, a severity that isn't in the ladder, an issue
// with no evidence, or a whole missing block — and none of that may reach a
// screen mounted on a wall. Anything unusable is dropped and recorded in
// `warnings`, so drift stays visible in the logs instead of silently becoming a
// zero (which would read as "this employee scored 0", a very different claim
// from "we could not evaluate this conversation").
import { createHash } from "crypto";
import {
  POLICY_VERSION, clampSeverity, isIssueType, isRiskFlag, isNextStep,
} from "./compliancePolicy.js";

/** Stable identity for an issue: its type plus its evidence, whitespace-folded.
 *  Re-analysis then upserts onto the same row, which is how a supervisor's
 *  confirm/reject survives being re-analysed. */
export function issueHash(type, evidence) {
  const norm = String(evidence || "").replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha1").update(`${type}::${norm}`).digest("hex");
}

const clampScore = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};
const clampUnit = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 100) / 100)) : null;
};
const str = (v, max) => (v == null || v === "" ? null : String(v).slice(0, max));
const bool = (v) => (v === true || v === 1 || v === "true" ? 1 : 0);

/** The seven per-conversation employee marks the persuasion score averages. */
const EMPLOYEE_SCORES = [
  ["persuasionQualityScore", "persuasion_score"],
  ["complianceAccuracyScore", "compliance_score"],
  ["objectionHandlingScore", "objection_score"],
  ["conversationContinuityScore", "continuity_score"],
  ["professionalismScore", "professionalism_score"],
  ["nextStepQualityScore", "next_step_score"],
  ["classificationAccuracyScore", "classification_score"],
];

/**
 * Dimensions that simply may not apply to a conversation: a customer who raised
 * no objection gives the employee nothing to handle, and a conversation with no
 * classification step has no classification accuracy.
 *
 * The prompt asks for null in those cases and the model returns 0 anyway
 * (measured on live conversations, flash). Since 0 is the worst possible mark and
 * these scores feed the persuasion average, believing it would quietly punish an
 * employee for something that never happened. An exact 0 is therefore read as
 * "not assessed" for these two only — a genuinely awful objection reply scores
 * in the teens, not exactly zero. Skipping is the fair way to be wrong here:
 * `weighted()` renormalizes over the dimensions that do have data.
 */
const OPTIONAL_DIMENSIONS = new Set(["objection_score", "classification_score"]);

const CUSTOMER_SCORES = [
  ["intentScore", "customer_intent_score"],
  ["qualificationScore", "qualification_score"],
  ["engagementScore", "engagement_score"],
];

/**
 * @param {object} raw - the parsed AI object (already JSON.parse'd by chatJSON)
 * @param {object} ctx - { waId, model, promptVersion, threadIds?: Set<string> }
 * @returns {{ evaluation: object|null, issues: object[], warnings: string[] }}
 */
export function validateEvaluation(raw, ctx = {}) {
  const warnings = [];
  const push = (w) => { if (warnings.length < 20) warnings.push(w); };

  if (!raw || typeof raw !== "object") {
    return { evaluation: null, issues: [], warnings: ["evaluation: not an object"] };
  }

  const emp = raw.employeeAnalysis && typeof raw.employeeAnalysis === "object" ? raw.employeeAnalysis : {};
  const cust = raw.customerAnalysis && typeof raw.customerAnalysis === "object" ? raw.customerAnalysis : {};
  const out = raw.conversationOutcome && typeof raw.conversationOutcome === "object" ? raw.conversationOutcome : {};
  const meta = raw.analysisMetadata && typeof raw.analysisMetadata === "object" ? raw.analysisMetadata : {};

  const evaluation = {
    wa_id: ctx.waId ?? null,
    policy_version: POLICY_VERSION,
    model: str(ctx.model, 64),
    prompt_version: str(ctx.promptVersion, 32),
  };

  let present = 0;
  for (const [from, to] of EMPLOYEE_SCORES) {
    let v = clampScore(emp[from]);
    if (v == null && emp[from] != null) push(`employeeAnalysis.${from}: not a 0-100 number`);
    if (v === 0 && OPTIONAL_DIMENSIONS.has(to)) {
      v = null;                       // see OPTIONAL_DIMENSIONS
      push(`employeeAnalysis.${from}: 0 read as not-applicable`);
    }
    if (v != null) present++;
    evaluation[to] = v;
  }
  for (const [from, to] of CUSTOMER_SCORES) {
    evaluation[to] = clampScore(cust[from]);
  }

  // A next-step type outside the journey vocabulary can't be aggregated, so it
  // is dropped rather than stored as a one-off string nobody can count.
  const nextStepType = isNextStep(out.nextStepType) ? out.nextStepType : null;
  if (out.nextStepType && !nextStepType) push(`conversationOutcome.nextStepType: unknown "${out.nextStepType}"`);

  evaluation.next_step_reached = bool(out.nextStepReached);
  evaluation.next_step_type = nextStepType;
  // "reached a next step" with no valid type is a contradiction; trust the type.
  if (evaluation.next_step_reached && !nextStepType) {
    evaluation.next_step_reached = 0;
    push("conversationOutcome: nextStepReached true with no recognised nextStepType");
  }
  evaluation.completed_correctly = bool(out.conversationCompletedCorrectly);
  evaluation.follow_up_required = bool(out.followUpRequired);

  const flags = Array.isArray(cust.customerRiskFlags) ? cust.customerRiskFlags : [];
  const keptFlags = flags.filter((f) => {
    if (isRiskFlag(f)) return true;
    push(`customerRiskFlags: unknown "${f}"`);
    return false;
  });
  evaluation.customer_risk_flags = keptFlags;

  evaluation.confidence = clampUnit(meta.confidence);
  evaluation.requires_human_review = bool(meta.requiresHumanReview);

  // No usable employee mark at all means there is nothing to score. Returning
  // null here is what lets the board show "analysis in progress" instead of a
  // fabricated zero.
  if (present === 0) {
    push("employeeAnalysis: no usable scores");
    return { evaluation: null, issues: [], warnings };
  }

  const issues = validateIssues(raw.issues, { push, waId: ctx.waId, threadIds: ctx.threadIds });

  // A critical finding always goes to a human, whatever the model said about it.
  if (issues.some((i) => i.severity === "critical")) evaluation.requires_human_review = 1;

  return { evaluation, issues, warnings };
}

function validateIssues(list, { push, waId, threadIds }) {
  if (list == null) return [];
  if (!Array.isArray(list)) { push("issues: not an array"); return []; }

  const seen = new Set();
  const issues = [];
  for (const it of list.slice(0, 25)) {
    if (!it || typeof it !== "object") { push("issues: non-object entry"); continue; }
    if (!isIssueType(it.type)) { push(`issues: unknown type "${it.type}"`); continue; }

    // Evidence is not optional. An issue with no quote can't be reviewed, can't
    // be shown to the employee, and can't be defended — so it can't cost points.
    const evidence = str(it.evidence, 2000);
    if (!evidence) { push(`issues[${it.type}]: dropped, no evidence quote`); continue; }

    const confidence = clampUnit(it.confidence);
    if (confidence == null) { push(`issues[${it.type}]: dropped, no usable confidence`); continue; }

    const severity = clampSeverity(it.type, it.severity);
    if (it.severity && severity !== it.severity) {
      push(`issues[${it.type}]: severity "${it.severity}" clamped to "${severity}"`);
    }

    // Same type quoting the same message twice is one issue, not two deductions.
    const hash = issueHash(it.type, evidence);
    if (seen.has(hash)) { push(`issues[${it.type}]: duplicate dropped`); continue; }
    seen.add(hash);

    // A message id that isn't in the thread we sent is a hallucination; keep the
    // issue (the quote is what matters) but don't store a bogus pointer.
    let messageId = str(it.employeeMessageId, 191);
    if (messageId && threadIds && !threadIds.has(messageId)) {
      push(`issues[${it.type}]: employeeMessageId not in thread, cleared`);
      messageId = null;
    }

    issues.push({
      wa_id: waId ?? null,
      policy_version: POLICY_VERSION,
      type: it.type,
      severity,
      confidence,
      evidence,
      evidence_hash: hash,
      employee_message_id: messageId,
      context_explanation: str(it.contextExplanation, 2000),
      recommended_alternative: str(it.recommendedAlternative, 2000),
      review_status: "pending",
    });
  }
  return issues;
}

/**
 * The compliance mark used for scoring. The model reports one, and the issue
 * list implies another; take the LOWER of the two. If the model says 95 while
 * listing a critical violation, the list is the evidence and the number is not.
 */
export function reconciledCompliance(evaluation, issues, complianceFromIssues) {
  const reported = evaluation?.compliance_score;
  if (reported == null) return complianceFromIssues;
  if (complianceFromIssues == null) return reported;
  return Math.min(reported, complianceFromIssues);
}

export default { validateEvaluation, reconciledCompliance, issueHash };
