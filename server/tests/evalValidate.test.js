// The gate between the AI and the wall-mounted screen. An LLM will eventually
// return a severity that isn't in the ladder, an issue with no quote, a score as
// a string, or nothing at all — and none of it may become a number an employee
// is judged by. Every case below is one the validator has to survive silently.
import { describe, it, expect } from "vitest";
import { validateEvaluation, reconciledCompliance, issueHash } from "../src/lib/evalValidate.js";
import {
  POLICY_VERSION, clampSeverity, issueLabel, isRealProgress, ISSUE_TYPES,
} from "../src/lib/compliancePolicy.js";

const good = () => ({
  employeeAnalysis: {
    persuasionQualityScore: 84, complianceAccuracyScore: 92, objectionHandlingScore: 76,
    conversationContinuityScore: 88, professionalismScore: 91, nextStepQualityScore: 80,
    classificationAccuracyScore: 90,
  },
  customerAnalysis: {
    intentScore: 78, qualificationScore: 75, engagementScore: 68,
    customerRiskFlags: ["expects_guaranteed_profit"],
  },
  conversationOutcome: {
    nextStepReached: true, nextStepType: "callback_scheduled",
    conversationCompletedCorrectly: true, followUpRequired: true,
  },
  issues: [],
  analysisMetadata: { confidence: 0.89, requiresHumanReview: false },
});

describe("happy path", () => {
  it("maps the AI block onto storable columns", () => {
    const { evaluation, issues, warnings } = validateEvaluation(good(), { waId: "w1", model: "deepseek-v4-flash", promptVersion: "eval-1" });
    expect(warnings).toEqual([]);
    expect(issues).toEqual([]);
    expect(evaluation).toMatchObject({
      wa_id: "w1", policy_version: POLICY_VERSION, model: "deepseek-v4-flash",
      persuasion_score: 84, compliance_score: 92, objection_score: 76,
      next_step_reached: 1, next_step_type: "callback_scheduled",
      completed_correctly: 1, follow_up_required: 1, confidence: 0.89,
      requires_human_review: 0,
    });
    expect(evaluation.customer_risk_flags).toEqual(["expects_guaranteed_profit"]);
  });
});

describe("malformed output never reaches the board", () => {
  it("survives a non-object", () => {
    for (const junk of [null, undefined, "text", 42, []]) {
      const r = validateEvaluation(junk);
      expect(r.evaluation).toBeNull();
      expect(r.issues).toEqual([]);
    }
  });

  it("returns null — not zeros — when no employee score is usable", () => {
    // a fabricated 0 would read as "this employee scored 0", a different claim
    // from "we could not evaluate this conversation"
    const r = validateEvaluation({ employeeAnalysis: { persuasionQualityScore: "very good" } });
    expect(r.evaluation).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/no usable scores/);
  });

  it("keeps the scores it can parse and flags the ones it cannot", () => {
    const raw = good();
    raw.employeeAnalysis.objectionHandlingScore = "n/a";
    const { evaluation, warnings } = validateEvaluation(raw);
    expect(evaluation.persuasion_score).toBe(84);
    expect(evaluation.objection_score).toBeNull();
    expect(warnings.join(" ")).toMatch(/objectionHandlingScore/);
  });

  it("reads an exact 0 on an optional dimension as not-applicable, not as a failing mark", () => {
    // measured on live conversations: the model returns 0 for "no objection was
    // raised" however clearly the prompt asks for null. Believing it would
    // punish the employee for something that never happened.
    const raw = good();
    raw.employeeAnalysis.objectionHandlingScore = 0;
    raw.employeeAnalysis.classificationAccuracyScore = 0;
    const { evaluation, warnings } = validateEvaluation(raw);
    expect(evaluation.objection_score).toBeNull();
    expect(evaluation.classification_score).toBeNull();
    expect(warnings.join(" ")).toMatch(/not-applicable/);
  });

  it("still believes a 0 on a dimension that always applies", () => {
    const raw = good();
    raw.employeeAnalysis.professionalismScore = 0;
    raw.employeeAnalysis.persuasionQualityScore = 0;
    const { evaluation } = validateEvaluation(raw);
    expect(evaluation.professionalism_score).toBe(0);
    expect(evaluation.persuasion_score).toBe(0);
  });

  it("clamps out-of-range scores into 0..100", () => {
    const raw = good();
    raw.employeeAnalysis.persuasionQualityScore = 180;
    raw.employeeAnalysis.professionalismScore = -20;
    const { evaluation } = validateEvaluation(raw);
    expect(evaluation.persuasion_score).toBe(100);
    expect(evaluation.professionalism_score).toBe(0);
  });

  it("drops an unrecognised next-step type and the contradiction it creates", () => {
    const raw = good();
    raw.conversationOutcome.nextStepType = "customer_smiled";
    const { evaluation, warnings } = validateEvaluation(raw);
    expect(evaluation.next_step_type).toBeNull();
    expect(evaluation.next_step_reached).toBe(0);   // can't have reached an unknown step
    expect(warnings.join(" ")).toMatch(/customer_smiled/);
    expect(warnings.join(" ")).toMatch(/no recognised nextStepType/);
  });

  it("drops an invented customer risk flag", () => {
    const raw = good();
    raw.customerAnalysis.customerRiskFlags = ["expects_guaranteed_profit", "seems_nice"];
    const { evaluation, warnings } = validateEvaluation(raw);
    expect(evaluation.customer_risk_flags).toEqual(["expects_guaranteed_profit"]);
    expect(warnings.join(" ")).toMatch(/seems_nice/);
  });

  it("survives `issues` arriving as something other than an array", () => {
    const raw = good();
    raw.issues = { type: "guaranteed_profit" };
    const { issues, warnings } = validateEvaluation(raw);
    expect(issues).toEqual([]);
    expect(warnings.join(" ")).toMatch(/not an array/);
  });
});

describe("issues", () => {
  const withIssue = (over = {}) => {
    const raw = good();
    raw.issues = [{
      type: "guaranteed_profit", severity: "critical", confidence: 0.93,
      evidence: "الربح مضمون معنا 100%", contextExplanation: "وعد صريح بربح مضمون",
      recommendedAlternative: "الأرباح غير مضمونة والتداول يحمل مخاطر", ...over,
    }];
    return raw;
  };

  it("stores a well-formed issue with a stable hash", () => {
    const { issues } = validateEvaluation(withIssue(), { waId: "w1" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      wa_id: "w1", type: "guaranteed_profit", severity: "critical",
      confidence: 0.93, review_status: "pending",
    });
    expect(issues[0].evidence_hash).toBe(issueHash("guaranteed_profit", "الربح مضمون معنا 100%"));
  });

  it("drops an issue with no verbatim quote — it could not be reviewed or defended", () => {
    const { issues, warnings } = validateEvaluation(withIssue({ evidence: null }));
    expect(issues).toEqual([]);
    expect(warnings.join(" ")).toMatch(/no evidence quote/);
  });

  it("drops an issue with no usable confidence", () => {
    const { issues, warnings } = validateEvaluation(withIssue({ confidence: "high" }));
    expect(issues).toEqual([]);
    expect(warnings.join(" ")).toMatch(/no usable confidence/);
  });

  it("drops an invented issue type rather than storing an uncountable one", () => {
    const { issues, warnings } = validateEvaluation(withIssue({ type: "was_a_bit_rude" }));
    expect(issues).toEqual([]);
    expect(warnings.join(" ")).toMatch(/unknown type/);
  });

  it("collapses the same issue quoted twice into one deduction", () => {
    const raw = withIssue();
    raw.issues.push({ ...raw.issues[0], evidence: "الربح   مضمون معنا 100%" }); // whitespace differs
    const { issues, warnings } = validateEvaluation(raw);
    expect(issues).toHaveLength(1);
    expect(warnings.join(" ")).toMatch(/duplicate/);
  });

  it("clears a message id the model invented but keeps the issue", () => {
    const raw = withIssue({ employeeMessageId: "not-in-thread" });
    const { issues, warnings } = validateEvaluation(raw, { threadIds: new Set(["m1", "m2"]) });
    expect(issues).toHaveLength(1);
    expect(issues[0].employee_message_id).toBeNull();
    expect(warnings.join(" ")).toMatch(/not in thread/);
  });

  it("always routes a critical finding to a human, whatever the model said", () => {
    const raw = withIssue();
    raw.analysisMetadata.requiresHumanReview = false;
    const { evaluation } = validateEvaluation(raw);
    expect(evaluation.requires_human_review).toBe(1);
  });

  it("caps a runaway issue list", () => {
    const raw = good();
    raw.issues = Array.from({ length: 60 }, (_, i) => ({
      type: "unclear_wording", severity: "informational", confidence: 0.8, evidence: `quote ${i}`,
    }));
    const { issues } = validateEvaluation(raw);
    expect(issues.length).toBeLessThanOrEqual(25);
  });
});

describe("severity clamping", () => {
  it("moves at most one step from the type's default", () => {
    // calling a guaranteed-profit promise "informational" would gut the score
    expect(clampSeverity("guaranteed_profit", "informational")).toBe("major");
    expect(clampSeverity("guaranteed_profit", "critical")).toBe("critical");
    // and calling unclear wording "critical" would put an unfair flag on a screen
    expect(clampSeverity("unclear_wording", "critical")).toBe("minor");
  });

  it("falls back to the default for a severity outside the ladder", () => {
    expect(clampSeverity("misleading_urgency", "apocalyptic")).toBe("moderate");
    expect(clampSeverity("misleading_urgency", undefined)).toBe("moderate");
  });

  it("returns null for an unknown type", () => {
    expect(clampSeverity("nope", "major")).toBeNull();
  });
});

describe("policy vocabulary", () => {
  it("labels every issue type in both languages", () => {
    for (const t of ISSUE_TYPES) {
      expect(issueLabel(t.key, "ar")).not.toBe(t.key);
      expect(issueLabel(t.key, "en")).not.toBe(t.key);
    }
  });

  it("separates real progress from merely answering a question", () => {
    expect(isRealProgress("registration_completed")).toBe(true);
    expect(isRealProgress("deposit_intent")).toBe(true);
    expect(isRealProgress("info_requested")).toBe(false);       // not progress toward an account
    expect(isRealProgress("closed_not_interested")).toBe(false);
    expect(isRealProgress("nonsense")).toBe(false);
  });
});

describe("reconciled compliance", () => {
  it("takes the lower of the model's number and what its own issue list implies", () => {
    // the model claiming 95 while listing a critical violation is not credible
    expect(reconciledCompliance({ compliance_score: 95 }, [], 65)).toBe(65);
    expect(reconciledCompliance({ compliance_score: 60 }, [], 100)).toBe(60);
  });

  it("falls back to whichever side exists", () => {
    expect(reconciledCompliance({ compliance_score: null }, [], 80)).toBe(80);
    expect(reconciledCompliance({ compliance_score: 80 }, [], null)).toBe(80);
  });
});
