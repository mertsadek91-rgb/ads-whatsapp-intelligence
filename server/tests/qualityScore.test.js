// The scoring model behind the quality board. These are the rules the business
// cares about, so they are pinned here before anything is wired to a screen:
// weights must total 100, compliance can only be lost on evidence a supervisor
// hasn't rejected, conversion is measured over QUALIFIED conversations, and
// speed never outranks compliance.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS, resolveWeights, resolveThresholds,
  productivityScore, persuasionScore, complianceScore, conversionScore,
  responseScore, scoreConfidence, overallScore, topPerformerEligibility,
  rankEmployees, scoreBand, complianceBand,
} from "../src/lib/qualityScore.js";

describe("weights", () => {
  it("defaults to the agreed 30/25/20/15/10 split", () => {
    expect(DEFAULT_WEIGHTS).toEqual({ persuasion: 30, conversion: 25, compliance: 20, productivity: 15, response: 10 });
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("accepts a valid override", () => {
    expect(resolveWeights({ persuasion: 40, conversion: 15 })).toEqual(
      { persuasion: 40, conversion: 15, compliance: 20, productivity: 15, response: 10 });
  });

  it("refuses a set that does not total 100 rather than scoring against it", () => {
    expect(() => resolveWeights({ persuasion: 50 })).toThrow(/total 100/);
    expect(() => resolveWeights({ persuasion: -5, conversion: 30 })).toThrow(/non-negative/);
  });
});

describe("thresholds (calibration)", () => {
  it("keeps every default when nothing is overridden", () => {
    expect(resolveThresholds()).toEqual(DEFAULT_THRESHOLDS);
    expect(resolveThresholds({})).toEqual(DEFAULT_THRESHOLDS);
  });

  it("accepts in-range values", () => {
    const t = resolveThresholds({ minSample: 25, minCompliance: 95, minConfidence: "high", slaMinutes: 15 });
    expect(t).toMatchObject({ minSample: 25, minCompliance: 95, minConfidence: "high", slaMinutes: 15 });
  });

  it("falls back to the default on nonsense rather than ranking on it", () => {
    // calibration means the owner edits these repeatedly — a typo must not
    // produce a board that silently ranks on garbage
    const t = resolveThresholds({ minSample: -5, minCompliance: 500, issueConfidenceFloor: 9, minConfidence: "maybe" });
    expect(t.minSample).toBe(DEFAULT_THRESHOLDS.minSample);
    expect(t.minCompliance).toBe(DEFAULT_THRESHOLDS.minCompliance);
    expect(t.issueConfidenceFloor).toBe(DEFAULT_THRESHOLDS.issueConfidenceFloor);
    expect(t.minConfidence).toBe(DEFAULT_THRESHOLDS.minConfidence);
  });

  it("never lets the review threshold sit below the scoring floor", () => {
    const t = resolveThresholds({ issueConfidenceFloor: 0.9, reviewConfidence: 0.5 });
    expect(t.reviewConfidence).toBe(0.9);
  });

  it("lowering the sample bar is what makes a provisional score rankable", () => {
    const m = { sampleSize: 5, analyzedPct: 100 };
    expect(overallScore({ persuasion: 80 }, m).provisional).toBe(true);
    expect(overallScore({ persuasion: 80 }, m, { thresholds: resolveThresholds({ minSample: 5 }) }).provisional).toBe(false);
  });
});

describe("productivity", () => {
  it("weights contact completion heaviest and skips dimensions with no data", () => {
    const full = productivityScore({
      leads: 100, contacted: 90, responseScore: 80,
      followUpsDue: 10, followUpsDone: 8, closable: 20, closedCorrectly: 18,
    });
    // 90*.40 + 80*.20 + 80*.25 + 90*.15 = 85.5
    expect(full).toBe(85.5);

    // no follow-ups due and nothing closable: scored on what exists, not zeroed
    const partial = productivityScore({ leads: 10, contacted: 10, responseScore: 50 });
    expect(partial).toBe(83.3);
  });

  it("does not reward closing conversations that were not closed correctly", () => {
    const sloppy = productivityScore({ leads: 100, contacted: 100, responseScore: 100, closable: 50, closedCorrectly: 0 });
    const clean = productivityScore({ leads: 100, contacted: 100, responseScore: 100, closable: 50, closedCorrectly: 50 });
    expect(sloppy).toBeLessThan(clean);
  });
});

describe("persuasion", () => {
  it("averages the AI's dimensions by their weights", () => {
    expect(persuasionScore({
      intentUnderstanding: 80, answerRelevance: 80, objectionHandling: 80,
      continuity: 80, professionalism: 80, nextStep: 80,
    })).toBe(80);
  });

  it("lets objection handling move the score materially", () => {
    const base = { intentUnderstanding: 90, answerRelevance: 90, continuity: 90, professionalism: 90, nextStep: 90 };
    expect(persuasionScore({ ...base, objectionHandling: 30 })).toBeLessThan(persuasionScore({ ...base, objectionHandling: 90 }));
  });
});

describe("compliance", () => {
  it("is a clean 100 when nothing was found", () => {
    expect(complianceScore([])).toBe(100);
  });

  it("scales the deduction with confidence inside the severity band", () => {
    const borderline = complianceScore([{ severity: "major", confidence: 0.71 }]);
    const certain = complianceScore([{ severity: "major", confidence: 1 }]);
    expect(borderline).toBeGreaterThan(certain);
    expect(100 - certain).toBeCloseTo(20, 0);   // top of the major band
    expect(100 - borderline).toBeCloseTo(10, 0); // bottom of it
  });

  it("ignores an issue the AI is not confident about", () => {
    expect(complianceScore([{ severity: "critical", confidence: 0.5 }])).toBe(100);
    expect(complianceScore([{ severity: "critical", confidence: 0.69 }])).toBe(100);
  });

  it("ignores an issue a supervisor rejected, however sure the AI was", () => {
    expect(complianceScore([{ severity: "critical", confidence: 1, review_status: "rejected" }])).toBe(100);
  });

  it("treats a supervisor-confirmed issue as certain", () => {
    const confirmed = complianceScore([{ severity: "moderate", confidence: 0.2, review_status: "confirmed" }]);
    expect(confirmed).toBe(90);   // top of the moderate band, despite low AI confidence
  });

  it("accumulates across issues and never goes below zero", () => {
    const many = Array.from({ length: 8 }, () => ({ severity: "critical", confidence: 1 }));
    expect(complianceScore(many)).toBe(0);
  });

  it("ignores an unknown severity instead of guessing a deduction", () => {
    expect(complianceScore([{ severity: "catastrophic", confidence: 1 }])).toBe(100);
  });
});

describe("conversion", () => {
  it("has no score at all when there is no qualified denominator", () => {
    // deliberately null, not 0 — "no qualified leads" is not "failed to convert"
    expect(conversionScore({ qualified: 0, nextStepReached: 0 })).toBeNull();
  });

  it("is measured over qualified conversations, not everyone contacted", () => {
    // 10 qualified of 100 contacted, 5 next steps -> 50% on the qualified base
    const score = conversionScore({ qualified: 10, nextStepReached: 5 });
    expect(score).toBe(30);   // 50 * 0.6
    // the same employee judged against all 100 contacted would score 3
    expect(score).toBeGreaterThan(conversionScore({ qualified: 100, nextStepReached: 5 }));
  });

  it("rewards reaching the deeper stages over booking a callback", () => {
    const shallow = conversionScore({ qualified: 10, nextStepReached: 10 });
    const deep = conversionScore({ qualified: 10, nextStepReached: 10, registered: 6, depositIntent: 3 });
    expect(deep).toBeGreaterThan(shallow);
  });
});

describe("response performance", () => {
  it("is null with nothing answerable in working hours", () => {
    expect(responseScore({ inHoursAnswerable: 0 })).toBeNull();
  });

  it("is the in-SLA share, penalised further by how late the median is", () => {
    expect(responseScore({ inHoursAnswerable: 10, withinSla: 10, medianFirstResponseMin: 5 })).toBe(100);
    const late = responseScore({ inHoursAnswerable: 10, withinSla: 8, medianFirstResponseMin: 90 });
    expect(late).toBeLessThan(80);
  });

  it("caps the lateness penalty so one terrible day cannot zero the score", () => {
    const awful = responseScore({ inHoursAnswerable: 10, withinSla: 9, medianFirstResponseMin: 6000 });
    expect(awful).toBe(75);   // 90 - 15
  });
});

describe("confidence and sample size", () => {
  it("is low below the minimum sample", () => {
    expect(scoreConfidence({ sampleSize: 1 })).toBe("low");
    expect(scoreConfidence({ sampleSize: DEFAULT_THRESHOLDS.minSample - 1 })).toBe("low");
  });

  it("rises with sample size and analysis coverage", () => {
    expect(scoreConfidence({ sampleSize: 15, analyzedPct: 100 })).toBe("medium");
    expect(scoreConfidence({ sampleSize: 40, analyzedPct: 100 })).toBe("high");
    expect(scoreConfidence({ sampleSize: 40, analyzedPct: 60 })).toBe("medium");
    expect(scoreConfidence({ sampleSize: 40, analyzedPct: 20 })).toBe("low");
  });
});

describe("overall score", () => {
  const components = { persuasion: 90, conversion: 80, compliance: 100, productivity: 70, response: 60 };

  it("applies the configured weights", () => {
    const r = overallScore(components, { sampleSize: 40, analyzedPct: 100 });
    // 90*.3 + 80*.25 + 100*.2 + 70*.15 + 60*.1 = 83.5
    expect(r.score).toBe(83.5);
    expect(r.provisional).toBe(false);
    expect(r.confidence).toBe("high");
  });

  it("marks a thin sample provisional instead of hiding it", () => {
    const r = overallScore(components, { sampleSize: 3 });
    expect(r.provisional).toBe(true);
    expect(r.confidence).toBe("low");
    expect(r.score).toBe(83.5);   // still computed, just flagged
  });

  it("caps the score at 60 while a confirmed critical violation stands", () => {
    const r = overallScore(components, { sampleSize: 40, analyzedPct: 100, confirmedCritical: true });
    expect(r.score).toBe(60);
    expect(r.raw).toBe(83.5);      // the uncapped value is preserved
    expect(r.capped).toBe(true);
    expect(r.cap_reason).toBe("confirmed_critical_violation");
  });

  it("does not lift a score that was already below the cap", () => {
    const weak = { persuasion: 40, conversion: 40, compliance: 50, productivity: 40, response: 40 };
    const r = overallScore(weak, { sampleSize: 40, confirmedCritical: true });
    expect(r.capped).toBe(false);
    expect(r.score).toBeLessThan(60);
  });

  it("skips a missing component rather than scoring it as zero", () => {
    const r = overallScore({ ...components, conversion: null }, { sampleSize: 40 });
    expect(r.score).toBeGreaterThan(83.5);   // renormalized over the remaining weights
  });
});

describe("top-performer eligibility", () => {
  const ok = { sample_size: 20, compliance: 96, persuasion: 82, confidence: "high" };

  it("passes an employee who clears every gate", () => {
    expect(topPerformerEligibility(ok)).toEqual({ eligible: true, reasons: [] });
  });

  it("names each failed gate instead of just refusing", () => {
    expect(topPerformerEligibility({ ...ok, sample_size: 2 }).reasons).toContain("insufficient_data");
    expect(topPerformerEligibility({ ...ok, compliance: 85 }).reasons).toContain("compliance_below_minimum");
    expect(topPerformerEligibility({ ...ok, persuasion: 60 }).reasons).toContain("persuasion_below_minimum");
    expect(topPerformerEligibility({ ...ok, confidence: "low" }).reasons).toContain("confidence_too_low");
    expect(topPerformerEligibility({ ...ok, confirmedCritical: true }).reasons).toContain("confirmed_critical_violation");
  });

  it("lets the thresholds be reconfigured", () => {
    expect(topPerformerEligibility({ ...ok, compliance: 85 }, { thresholds: { minCompliance: 80 } }).eligible).toBe(true);
  });
});

describe("ranking", () => {
  it("ranks by overall score, not by volume or speed", () => {
    const ranked = rankEmployees([
      { name: "Volume", overall: 70, compliance: 95, persuasion: 78, confidence: "high", sample_size: 90, qualified: 90 },
      { name: "Quality", overall: 88, compliance: 97, persuasion: 90, confidence: "high", sample_size: 20, qualified: 20 },
    ]);
    expect(ranked[0].name).toBe("Quality");
    expect(ranked[0].rank).toBe(1);
  });

  it("sorts every ineligible employee after the eligible ones, score notwithstanding", () => {
    const ranked = rankEmployees([
      { name: "Flagged", overall: 95, compliance: 70, persuasion: 90, confidence: "high", sample_size: 30 },
      { name: "Solid", overall: 76, compliance: 96, persuasion: 80, confidence: "high", sample_size: 30 },
    ]);
    expect(ranked[0].name).toBe("Solid");
    expect(ranked[1].eligible).toBe(false);
    expect(ranked[1].reasons).toContain("compliance_below_minimum");
  });

  it("breaks a tie on compliance first and speed last", () => {
    const ranked = rankEmployees([
      { name: "Fast", overall: 80, compliance: 92, persuasion: 80, response: 100, confidence: "high", sample_size: 20 },
      { name: "Careful", overall: 80, compliance: 99, persuasion: 80, response: 40, confidence: "high", sample_size: 20 },
    ]);
    expect(ranked[0].name).toBe("Careful");
  });
});

describe("bands", () => {
  it("labels the score ladder", () => {
    expect(scoreBand(95).key).toBe("excellent");
    expect(scoreBand(85).key).toBe("strong");
    expect(scoreBand(75).key).toBe("good");
    expect(scoreBand(65).key).toBe("needs_improvement");
    expect(scoreBand(40).key).toBe("review");
    expect(scoreBand(null).key).toBe("none");
  });

  it("holds compliance to a stricter ladder than general performance", () => {
    expect(scoreBand(92).key).toBe("excellent");
    expect(complianceBand(92).key).toBe("good");     // same number, stricter verdict
    expect(complianceBand(85).key).toBe("needs_improvement");
  });

  it("carries a label in both languages so colour is never the only signal", () => {
    expect(scoreBand(95)).toMatchObject({ ar: "ممتاز", en: "Excellent" });
    expect(complianceBand(70)).toMatchObject({ ar: "مراجعة عاجلة", en: "Urgent review" });
  });
});
