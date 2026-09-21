// The business profile is what makes this product work for a clinic or an
// estate agency rather than only the brokerage it was written for. Two things
// have to hold, and both are tested here:
//
//   1. The document cannot go live broken. It carries closed enums that the AI
//      is prompted with AND validated against, so a duplicate key or a missing
//      escape valve is a silent corruption of every count built on top.
//   2. Editing it must not cost money by accident. Renaming an Arabic label
//      should re-analyse nothing; changing the vocabulary should re-analyse
//      exactly the affected rows.
import { describe, it, expect } from "vitest";
import { validateProfile, CORE_ISSUE_TYPES } from "../src/lib/profileSchema.js";
import { policyFingerprint, tagFingerprint } from "../src/lib/businessProfile.js";
import * as D from "../src/lib/profileDerived.js";
import { GENERIC_PROFILE } from "../src/profiles/generic.js";

const base = () => JSON.parse(JSON.stringify(GENERIC_PROFILE));
const valid = (p) => validateProfile(p).profile;

describe("the shipped seed profile", () => {
  it("validates clean with no repairs, so a fresh install is never subtly broken", () => {
    const r = validateProfile(GENERIC_PROFILE);
    expect(r.errors).toEqual([]);
    expect(r.repairs).toEqual([]);
  });

  it("states no company facts at all", () => {
    // Inventing a regulator or licence for a business we know nothing about is
    // the single worst thing this layer could ship.
    expect(GENERIC_PROFILE.identity.facts).toEqual([]);
  });

  it("marks nothing another system owns as AI-assignable", () => {
    const p = valid(base());
    for (const c of p.tags.categories) {
      if (c.source !== "ai") continue;
      expect(/account|payment|invoice|booking/i.test(c.key), `${c.key} should not be ai-sourced`).toBe(false);
    }
  });

  it("under-tags rather than guessing", () => {
    expect(D.tagCount(valid(base()))).toBeLessThan(80);
  });
});

describe("schema validation", () => {
  it("rejects a duplicate issue type", () => {
    const p = base();
    p.issue_types.push({ ...p.issue_types[0] });
    expect(validateProfile(p).errors.join()).toMatch(/duplicate issue type/);
  });

  it("slug-repairs a key that is not a valid identifier", () => {
    const p = base();
    p.issue_types.push({ key: "Not A Key!", default_severity: "minor", ar: "x", en: "x" });
    const r = validateProfile(p);
    expect(r.errors).toEqual([]);
    expect(r.repairs.join()).toMatch(/renamed/);
    expect(r.profile.issue_types.some((t) => t.key === "not_a_key")).toBe(true);
  });

  it("clamps a severity that is off the fixed ladder", () => {
    const p = base();
    p.issue_types.push({ key: "invented_one", default_severity: "apocalyptic", ar: "x", en: "x" });
    const r = validateProfile(p);
    expect(r.profile.issue_types.find((t) => t.key === "invented_one").default_severity).toBe("moderate");
    expect(r.repairs.join()).toMatch(/severity/);
  });

  it("re-injects the universal issue types if a generated profile dropped them", () => {
    // A clinic profile that lost "unanswered_question" would silently stop
    // measuring the thing the product exists to measure.
    const p = base();
    p.issue_types = [{ key: "medical_advice_beyond_scope", default_severity: "critical", ar: "x", en: "x" }];
    const r = validateProfile(p);
    for (const core of CORE_ISSUE_TYPES) {
      expect(r.profile.issue_types.some((t) => t.key === core.key), core.key).toBe(true);
    }
    expect(r.repairs.join()).toMatch(/core issue type/);
  });

  it("re-injects the 'other' sales pattern, which is load-bearing", () => {
    // Without an escape valve the model force-fits a real case into the wrong
    // bucket, which is worse than an honest "other".
    const p = base();
    p.sales_patterns = p.sales_patterns.filter((x) => x.key !== "other");
    const r = validateProfile(p);
    expect(r.profile.sales_patterns.some((x) => x.key === "other")).toBe(true);
    expect(r.repairs.join()).toMatch(/other/);
  });

  it("downgrades a fact that claims the website but quotes nothing", () => {
    const p = base();
    p.identity.facts = [{ key: "licence", value: "ABC-123", source: "website", evidence: "" }];
    const r = validateProfile(p);
    expect(r.profile.identity.facts[0].source).toBe("unverified");
    expect(r.repairs.join()).toMatch(/quoted nothing/);
  });

  it("resolves a tag claimed by two categories, and says which one lost it", () => {
    // Dropping it from the later category is deterministic and lets the run
    // continue, so it is a repair — reporting it as an error told the reviewer
    // something was wrong without ever saying what had been done about it.
    const p = base();
    p.tags.categories[2].tags.push(["ENG_HOT", "Hot", "ساخن"]);
    const r = validateProfile(p);
    expect(r.errors).toEqual([]);
    expect(r.repairs.join()).toMatch(/kept in "engagement", removed from "intent"/);
    // ...and the tag exists exactly once afterwards.
    const all = r.profile.tags.categories.flatMap((c) => c.tags.map((x) => x[0]));
    expect(all.filter((c) => c === "ENG_HOT")).toHaveLength(1);
  });

  it("rejects an exclusive group naming a tag that does not exist", () => {
    const p = base();
    p.tags.categories[1].exclusive = [["ENG_HOT", "NO_SUCH_TAG"]];
    expect(validateProfile(p).errors.join()).toMatch(/unknown tag "NO_SUCH_TAG"/);
  });

  it("rejects scoring weights that do not total 100", () => {
    const p = base();
    p.scoring.weights.persuasion = 90;
    expect(validateProfile(p).errors.join()).toMatch(/must total 100/);
  });

  it("requires a conversion point in both the lifecycle and the next steps", () => {
    const p = base();
    p.lifecycle.stages = p.lifecycle.stages.map((s) => ({ ...s, counts_as_converted: false }));
    expect(validateProfile(p).errors.join()).toMatch(/counts_as_converted/);
    const q = base();
    q.next_steps = q.next_steps.map((s) => ({ ...s, counts_as_conversion: false }));
    expect(validateProfile(q).errors.join()).toMatch(/counts_as_conversion/);
  });
});

describe("the fingerprint decides what an edit costs", () => {
  it("does not change when only an Arabic label is renamed", () => {
    // Otherwise fixing a typo would re-analyse thirty days of conversations and
    // spend the AI budget.
    const a = valid(base());
    const b = valid(base());
    b.issue_types[0].ar = "صياغة مختلفة تماماً";
    b.lifecycle.stages[0].en = "Brand New";
    expect(policyFingerprint(b)).toBe(policyFingerprint(a));
  });

  it("does not change when an array is merely reordered", () => {
    const a = valid(base());
    const b = valid(base());
    b.issue_types.reverse();
    b.next_steps.reverse();
    expect(policyFingerprint(b)).toBe(policyFingerprint(a));
  });

  it("changes when an issue type is added", () => {
    const a = valid(base());
    const b = valid(base());
    b.issue_types.push({ key: "brand_new_issue", default_severity: "major", ar: "x", en: "x" });
    expect(policyFingerprint(b)).not.toBe(policyFingerprint(a));
  });

  it("changes when a default severity moves", () => {
    const a = valid(base());
    const b = valid(base());
    b.issue_types[0].default_severity = "critical";
    expect(policyFingerprint(b)).not.toBe(policyFingerprint(a));
  });

  it("changes when the business rules are rewritten", () => {
    const a = valid(base());
    const b = valid(base());
    b.rules.business_rules_ar += "\n5. قاعدة جديدة.";
    expect(policyFingerprint(b)).not.toBe(policyFingerprint(a));
  });

  it("does not change when a scoring weight moves", () => {
    // Weights change the arithmetic, not a single token of the prompt.
    const a = valid(base());
    const b = valid(base());
    b.scoring.weights = { persuasion: 40, conversion: 25, compliance: 20, productivity: 10, response: 5 };
    expect(policyFingerprint(b)).toBe(policyFingerprint(a));
  });

  it("versions the tag vocabulary separately from the policy", () => {
    const a = valid(base());
    const b = valid(base());
    b.tags.categories[2].tags.push(["INTENT_BRAND_NEW", "New", "جديد"]);
    expect(tagFingerprint(b)).not.toBe(tagFingerprint(a));
    expect(policyFingerprint(b)).toBe(policyFingerprint(a));   // re-tag, do not re-analyse
  });
});

describe("derived reads", () => {
  const p = valid(base());

  it("clamps a proposed severity to one step from the default", () => {
    // A model calling the worst violation "informational" is wrong; so is one
    // escalating a wording nit to "critical".
    expect(D.clampSeverity(p, "overpromising", "informational")).toBe("major");
    expect(D.clampSeverity(p, "unclear_wording", "critical")).toBe("minor");
    expect(D.clampSeverity(p, "overpromising", "critical")).toBe("critical");
    expect(D.clampSeverity(p, "not_a_real_type", "major")).toBeNull();
  });

  it("coerces an off-schema pattern key to the escape valve, and leaves null alone", () => {
    expect(D.clampPatternKey(p, "invented_by_the_model")).toBe("other");
    expect(D.clampPatternKey(p, "slow_follow_up")).toBe("slow_follow_up");
    expect(D.clampPatternKey(p, null)).toBeNull();
  });

  it("resolves a retired label instead of showing a raw key on an old row", () => {
    const q = valid(base());
    q.retired = { issue_types: [{ key: "gone_type", ar: "نوع مُلغى", en: "Retired type" }], tags: [], next_steps: [] };
    expect(D.issueLabel(q, "gone_type", "ar")).toBe("نوع مُلغى");
    expect(D.issueLabel(q, "never_existed")).toBe("never_existed");
  });

  it("splits shallow next steps from real progress", () => {
    expect(D.isRealProgress(p, "info_requested")).toBe(false);
    expect(D.isRealProgress(p, "closed_not_interested")).toBe(false);
    expect(D.isRealProgress(p, "purchase_completed")).toBe(true);
    expect(D.conversionSteps(p)).toContain("purchase_completed");
  });

  it("maps a CRM stage name onto a lifecycle stage through its aliases", () => {
    expect(D.normalizeStageKey(p, "Deal Won")).toBe("customer");
    expect(D.normalizeStageKey(p, "proposal sent")).toBe("interested");
    expect(D.normalizeStageKey(p, "something nobody configured")).toBeNull();
  });

  it("derives the qualified and converted stage sets from the profile", () => {
    expect(D.qualifiedStageKeys(p)).toEqual(expect.arrayContaining(["qualified", "trial", "customer"]));
    expect(D.convertedStageKeys(p)).toEqual(["customer"]);
  });

  it("knows which system owns each tag, and never lets AI claim an external one", () => {
    expect(D.sourceOf(p, "ENG_HOT")).toBe("rule");
    expect(D.sourceOf(p, "INTENT_BUY")).toBe("ai");
    expect(D.sourceOf(p, "ACC_PAID")).toBe("external");
    expect(D.aiTagCodes(p)).not.toContain("ACC_PAID");
  });

  it("labels an unverified fact in the prompt rather than presenting it as established", () => {
    const q = valid(base());
    q.identity.facts = [
      { key: "licence", label_ar: "الترخيص", label_en: "Licence", value: "XYZ", source: "website", evidence: "quoted" },
      { key: "award", label_ar: "جائزة", label_en: "Award", value: "Best 2026", source: "unverified", evidence: null },
    ];
    const block = D.factsBlock(q, "ar");
    expect(block).toContain("XYZ");
    expect(block).toMatch(/Best 2026.*غير مؤكَّد/s);
  });
});
