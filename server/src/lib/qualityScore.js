// Employee quality scoring: the five component scores and the weighted overall,
// plus the eligibility rules that decide who can be called Top Performer.
//
// Everything here is a PURE function over already-aggregated numbers. It reads
// no database and calls no AI, which is what makes the formulas testable and
// what keeps them out of the dashboard request path — the board reads snapshots
// computed from these functions, it never recomputes from raw messages.
//
// Why this exists: the current board ranks by contact rate alone, so the person
// who touched the most leads wins even if the conversations were poor or
// non-compliant. These scores add the quality axis without removing the
// productivity one.

/** Clamp to the 0..100 the whole model works in. */
const clamp100 = (n) => Math.max(0, Math.min(100, Number(n) || 0));
const round1 = (n) => Math.round(Number(n) * 10) / 10;
const pct = (num, den) => (den > 0 ? (100 * num) / den : 0);

// ------------------------------------------------------------------ config
// One object, validated to total 100, overridable from ads_settings. Kept in a
// single place so a weighting change is one edit rather than a hunt through
// every caller.
export const DEFAULT_WEIGHTS = {
  persuasion: 30,
  conversion: 25,
  compliance: 20,
  productivity: 15,
  response: 10,
};

/** Sub-weights inside the productivity score. */
export const DEFAULT_PRODUCTIVITY_WEIGHTS = {
  contactCompletion: 40,
  responseTime: 20,
  followUp: 25,
  closure: 15,
};

/** Sub-weights inside the persuasion score — the AI's per-dimension marks. */
export const DEFAULT_PERSUASION_WEIGHTS = {
  intentUnderstanding: 20,
  answerRelevance: 20,
  objectionHandling: 20,
  continuity: 15,
  professionalism: 15,
  nextStep: 10,
};

export const DEFAULT_THRESHOLDS = {
  slaMinutes: 30,             // first human reply target, inside work hours
  minSample: 15,              // analyzed qualified conversations before ranking
  minCompliance: 90,
  minPersuasion: 75,
  minConfidence: "medium",
  criticalScoreCap: 60,       // ceiling while a confirmed critical issue stands
  issueConfidenceFloor: 0.70, // below this an issue never costs points
  reviewConfidence: 0.85,     // 0.70..0.85 => warn only, above => provisional
};

/**
 * Deduction bands per severity. A band, not a fixed number, because two
 * "moderate" issues are not equally bad — the AI's own confidence scales the
 * deduction inside the band.
 */
export const SEVERITY_DEDUCTION = {
  informational: [0, 2],
  minor: [2, 5],
  moderate: [5, 10],
  major: [10, 20],
  critical: [20, 35],
};

export const SEVERITY_ORDER = ["informational", "minor", "moderate", "major", "critical"];

/**
 * Validate and normalize a weight set. Throws rather than silently scoring
 * against weights that don't total 100 — a board showing scores nobody can
 * reproduce is worse than a boot failure.
 */
export function resolveWeights(override = {}) {
  const w = { ...DEFAULT_WEIGHTS };
  for (const k of Object.keys(DEFAULT_WEIGHTS)) {
    if (override[k] != null) {
      const n = Number(override[k]);
      if (!Number.isFinite(n) || n < 0) throw new Error(`quality weight "${k}" must be a non-negative number`);
      w[k] = n;
    }
  }
  const total = Object.values(w).reduce((s, n) => s + n, 0);
  if (Math.round(total * 100) / 100 !== 100) {
    throw new Error(`quality weights must total 100, got ${total}`);
  }
  return w;
}

/**
 * Sanitize a thresholds override: every field falls back to its default, and
 * each is range-checked. Calibration means the owner changes these numbers
 * repeatedly, so a typo must degrade to the default rather than produce a board
 * that silently ranks on nonsense.
 */
export function resolveThresholds(override = {}) {
  const t = { ...DEFAULT_THRESHOLDS };
  const num = (k, min, max) => {
    const v = Number(override[k]);
    if (Number.isFinite(v) && v >= min && v <= max) t[k] = v;
  };
  num("slaMinutes", 1, 24 * 60);
  num("minSample", 1, 1000);
  num("minCompliance", 0, 100);
  num("minPersuasion", 0, 100);
  num("criticalScoreCap", 0, 100);
  num("issueConfidenceFloor", 0, 1);
  num("reviewConfidence", 0, 1);
  if (["low", "medium", "high"].includes(override.minConfidence)) t.minConfidence = override.minConfidence;
  // A review threshold below the scoring floor would be meaningless.
  if (t.reviewConfidence < t.issueConfidenceFloor) t.reviewConfidence = t.issueConfidenceFloor;
  return t;
}

/** Weighted average of 0..100 parts whose weights total 100. */
function weighted(parts, weights) {
  let sum = 0, used = 0;
  for (const [k, weight] of Object.entries(weights)) {
    const v = parts[k];
    if (v == null) continue;          // a missing dimension is skipped, not zeroed
    sum += clamp100(v) * weight;
    used += weight;
  }
  return used > 0 ? round1(sum / used) : null;
}

// -------------------------------------------------------------- components

/**
 * Productivity: did the operational job get done. Deliberately does NOT reward
 * closing fast — `closureRate` counts only conversations closed *correctly*
 * (question answered, status classified, no unanswered customer message, no
 * overdue follow-up), which the caller determines.
 */
export function productivityScore(m, weights = DEFAULT_PRODUCTIVITY_WEIGHTS) {
  return weighted({
    contactCompletion: pct(m.contacted, m.leads),
    responseTime: m.responseScore != null ? m.responseScore : null,
    followUp: m.followUpsDue ? pct(m.followUpsDone, m.followUpsDue) : null,
    closure: m.closable ? pct(m.closedCorrectly, m.closable) : null,
  }, weights);
}

/** Persuasion: the average of the AI's per-dimension marks over conversations. */
export function persuasionScore(dims, weights = DEFAULT_PERSUASION_WEIGHTS) {
  return weighted(dims, weights);
}

/**
 * Compliance: start at 100 and deduct for issues.
 *
 * Three guards, because an unfair red flag on a wall-mounted screen is worse
 * than a missed one:
 *  - an issue below the confidence floor never costs points;
 *  - an issue a supervisor rejected never costs points, whatever the AI said;
 *  - the deduction scales with confidence inside the severity's band, so a
 *    borderline call costs the low end of the range.
 */
export function complianceScore(issues = [], t = DEFAULT_THRESHOLDS) {
  let score = 100;
  for (const it of issues) {
    if (it.review_status === "rejected") continue;
    const band = SEVERITY_DEDUCTION[it.severity];
    if (!band) continue;
    const confidence = it.review_status === "confirmed" ? 1 : Number(it.confidence ?? 0);
    if (confidence < t.issueConfidenceFloor) continue;
    const [lo, hi] = band;
    // map confidence [floor..1] onto [lo..hi]
    const span = Math.max(0.0001, 1 - t.issueConfidenceFloor);
    const ratio = Math.min(1, Math.max(0, (confidence - t.issueConfidenceFloor) / span));
    score -= lo + (hi - lo) * ratio;
  }
  return round1(clamp100(score));
}

/**
 * Conversion: meaningful next steps over QUALIFIED conversations.
 *
 * The denominator matters more than the formula. Dividing by everyone contacted
 * punishes whoever was handed the wrong numbers, spam and duplicates — so those
 * are excluded by the caller and `qualified` is what we divide by.
 */
export function conversionScore(m) {
  if (!m.qualified) return null;         // no denominator => no score, not zero
  const nextStep = pct(m.nextStepReached, m.qualified);
  const deeper = pct(m.registered || 0, m.qualified);
  const deposit = pct(m.depositIntent || 0, m.qualified);
  // A registration or a deposit intent is worth more than a callback booking,
  // so the deeper stages lift the score rather than being counted flat.
  return round1(clamp100(nextStep * 0.6 + deeper * 0.25 + deposit * 0.15 + 0));
}

/**
 * Response performance: share of first human replies inside the SLA, measured
 * only over leads that arrived during the employee's working hours. Bot replies
 * are already excluded upstream (`human_replied`).
 */
export function responseScore(m, t = DEFAULT_THRESHOLDS) {
  const total = m.inHoursAnswerable || 0;
  if (!total) return null;
  const within = m.withinSla || 0;
  let score = pct(within, total);
  // A breach that is barely late is not the same as one left for a day: the
  // median lateness shaves a little more off an already-imperfect score.
  if (m.medianFirstResponseMin != null && m.medianFirstResponseMin > t.slaMinutes) {
    const overBy = m.medianFirstResponseMin / t.slaMinutes;      // >1
    score -= Math.min(15, (overBy - 1) * 10);
  }
  return round1(clamp100(score));
}

// ----------------------------------------------------------------- overall

/** Confidence from sample size and coverage — what gates the ranking. */
export function scoreConfidence(m, t = DEFAULT_THRESHOLDS) {
  const n = m.sampleSize || 0;
  const coverage = m.analyzedPct == null ? 100 : m.analyzedPct;
  if (n < t.minSample || coverage < 50) return "low";
  if (n < t.minSample * 2 || coverage < 80) return "medium";
  return "high";
}

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };

/**
 * The weighted overall, plus everything a caller needs to render it honestly:
 * whether it is provisional, whether a confirmed critical capped it, and why.
 */
export function overallScore(components, m = {}, opts = {}) {
  const weights = resolveWeights(opts.weights);
  const t = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };

  const raw = weighted({
    persuasion: components.persuasion,
    conversion: components.conversion,
    compliance: components.compliance,
    productivity: components.productivity,
    response: components.response,
  }, weights);

  const confidence = scoreConfidence(m, t);
  const provisional = (m.sampleSize || 0) < t.minSample;
  const capped = !!m.confirmedCritical && raw != null && raw > t.criticalScoreCap;
  const score = raw == null ? null : (capped ? t.criticalScoreCap : raw);

  return {
    score, raw, capped, provisional, confidence,
    sample_size: m.sampleSize || 0,
    weights,
    cap_reason: capped ? "confirmed_critical_violation" : null,
  };
}

/**
 * Top-Performer eligibility. Speed and volume never buy their way past
 * compliance: every gate must pass, and the reasons are returned so the UI can
 * say *why* someone is not eligible instead of silently ranking them lower.
 */
export function topPerformerEligibility(row, opts = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) };
  const reasons = [];
  if ((row.sample_size || 0) < t.minSample) reasons.push("insufficient_data");
  if ((row.compliance ?? 0) < t.minCompliance) reasons.push("compliance_below_minimum");
  if ((row.persuasion ?? 0) < t.minPersuasion) reasons.push("persuasion_below_minimum");
  if (row.confirmedCritical) reasons.push("confirmed_critical_violation");
  if (CONFIDENCE_RANK[row.confidence] < CONFIDENCE_RANK[t.minConfidence]) reasons.push("confidence_too_low");
  return { eligible: reasons.length === 0, reasons };
}

/**
 * Rank by overall score, with compliance and quality — never speed — breaking
 * ties. Ineligible employees keep their score and their row but are sorted
 * after everyone eligible, so the top of a wall screen is always someone the
 * company can hold up as an example.
 */
export function rankEmployees(rows, opts = {}) {
  const scored = rows.map((r) => ({ ...r, ...topPerformerEligibility(r, opts) }));
  scored.sort((a, b) =>
    Number(b.eligible) - Number(a.eligible)
    || (b.overall ?? -1) - (a.overall ?? -1)
    || (b.compliance ?? -1) - (a.compliance ?? -1)
    || (b.persuasion ?? -1) - (a.persuasion ?? -1)
    || (b.conversion ?? -1) - (a.conversion ?? -1)
    || (b.qualified ?? 0) - (a.qualified ?? 0)
    || (b.response ?? -1) - (a.response ?? -1));
  return scored.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ------------------------------------------------------------------ bands

/** Score band for the status colour + label. Never colour alone — the UI shows both. */
export function scoreBand(score) {
  if (score == null) return { key: "none", ar: "لا بيانات", en: "No data" };
  if (score >= 90) return { key: "excellent", ar: "ممتاز", en: "Excellent" };
  if (score >= 80) return { key: "strong", ar: "قوي", en: "Strong" };
  if (score >= 70) return { key: "good", ar: "جيد", en: "Good" };
  if (score >= 60) return { key: "needs_improvement", ar: "يحتاج تحسيناً", en: "Needs improvement" };
  return { key: "review", ar: "يحتاج مراجعة", en: "Requires review" };
}

/** Compliance uses a stricter ladder — 85 is not "strong" for compliance. */
export function complianceBand(score) {
  if (score == null) return { key: "none", ar: "لا بيانات", en: "No data" };
  if (score >= 98) return { key: "excellent", ar: "ممتاز", en: "Excellent" };
  if (score >= 95) return { key: "strong", ar: "جيد جداً", en: "Strong" };
  if (score >= 90) return { key: "good", ar: "مقبول", en: "Acceptable" };
  if (score >= 80) return { key: "needs_improvement", ar: "يحتاج تحسيناً", en: "Needs improvement" };
  return { key: "review", ar: "مراجعة عاجلة", en: "Urgent review" };
}

export default {
  DEFAULT_WEIGHTS, DEFAULT_PRODUCTIVITY_WEIGHTS, DEFAULT_PERSUASION_WEIGHTS,
  DEFAULT_THRESHOLDS, SEVERITY_DEDUCTION, SEVERITY_ORDER,
  resolveWeights, resolveThresholds, productivityScore, persuasionScore, complianceScore,
  conversionScore, responseScore, scoreConfidence, overallScore,
  topPerformerEligibility, rankEmployees, scoreBand, complianceBand,
};
