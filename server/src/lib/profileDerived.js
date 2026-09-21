// Pure reads over a business profile. No database, no I/O, no module state
// beyond one memo.
//
// This is what replaces the module-level constants the compliance and tagging
// layers used to import. Every function takes the profile as its first
// argument, which is deliberate: the validators that consume these
// (evalValidate, validateAiTags, scoreContact) are synchronous, pure, directly
// unit-tested and documented as never throwing. Making them reach for the
// profile themselves would have made them async and stateful, and that property
// is the most valuable thing in this layer.
import { SEVERITIES } from "./profileConstants.js";

const byKey = (list, key = "key") => new Map((list || []).map((x) => [x[key], x]));

// ---- rules and prose --------------------------------------------------------
export const businessRules = (p, lang = "ar") =>
  (lang === "en" ? p.rules?.business_rules_en : p.rules?.business_rules_ar)
  || p.rules?.business_rules_ar || "";

export const complianceIntro = (p, lang = "ar") =>
  (lang === "en" ? p.rules?.compliance_intro_en : p.rules?.compliance_intro_ar)
  || p.rules?.compliance_intro_ar || "";

export const discoveryPlaybook = (p, lang = "ar") =>
  (lang === "en" ? p.rules?.discovery_playbook_en : p.rules?.discovery_playbook_ar)
  || p.rules?.discovery_playbook_ar || [];

/**
 * The company's own verifiable facts, rendered for the prompt.
 *
 * Unverified facts are labelled as such rather than dropped: the evaluator must
 * be able to tell "we know this is true" from "the owner said so", or it will
 * confidently mark a correct regulatory statement as a misrepresentation.
 */
export function factsBlock(p, lang = "ar") {
  const facts = p.identity?.facts || [];
  if (!facts.length) return "";
  const head = lang === "en"
    ? "Verified company facts — the ONLY reference for checking any claim the agent makes:"
    : "معلومات الشركة المعتمدة — هي المرجع الوحيد للتحقّق من أي ادّعاء يذكره الموظف:";
  const lines = facts.map((f) => {
    const label = (lang === "en" ? f.label_en : f.label_ar) || f.key;
    const mark = f.verified_by_human || f.source === "website" ? "" :
      (lang === "en" ? "  [UNVERIFIED — do not treat as established]" : "  [غير مؤكَّد — لا تعتبره حقيقة ثابتة]");
    return `  • ${label}: ${f.value}${mark}`;
  });
  return [head, ...lines].join("\n");
}

// ---- issue types ------------------------------------------------------------
export const issueTypes = (p) => p.issue_types || [];
export const isIssueType = (p, k) => byKey(p.issue_types).has(k);
export const issueType = (p, k) => byKey(p.issue_types).get(k) || null;

/** Falls back through the retired list so an old board row still reads. */
export function issueLabel(p, key, lang = "ar") {
  const t = byKey(p.issue_types).get(key) || (p.retired?.issue_types || []).find((x) => x.key === key);
  return t ? (lang === "en" ? t.en : t.ar) || key : key;
}

/**
 * The severity the model proposed, clamped to at most one step from the type's
 * default. A model that calls the worst violation "informational" is wrong, but
 * so is one that escalates a wording nit to "critical" — one step of movement
 * is judgement, more is noise.
 */
export function clampSeverity(p, typeKey, proposed) {
  const t = issueType(p, typeKey);
  if (!t) return null;
  const di = SEVERITIES.indexOf(t.default_severity);
  const pi = SEVERITIES.indexOf(proposed);
  if (pi < 0) return t.default_severity;
  const clamped = Math.max(di - 1, Math.min(di + 1, pi));
  return SEVERITIES[clamped];
}

// ---- customer risk flags ----------------------------------------------------
export const riskFlags = (p) => p.customer_risk_flags || [];
export const isRiskFlag = (p, k) => byKey(p.customer_risk_flags).has(k);

// ---- sales patterns ---------------------------------------------------------
export const salesPatterns = (p) => p.sales_patterns || [];

/** Off-schema values become "other" rather than breaking the counts. */
export function clampPatternKey(p, key) {
  if (key == null) return null;
  return byKey(p.sales_patterns).has(key) ? key : "other";
}
export function patternLabel(p, key, lang = "ar") {
  const list = salesPatterns(p);
  const x = byKey(list).get(key) || list[list.length - 1];
  return x ? (lang === "en" ? x.en : x.ar) : key;
}

// ---- next steps -------------------------------------------------------------
export const nextSteps = (p) => p.next_steps || [];
export const nextStepKeys = (p) => nextSteps(p).map((s) => s.key);
export const isNextStep = (p, k) => byKey(p.next_steps).has(k);
export const isRealProgress = (p, k) => !!byKey(p.next_steps).get(k)?.real_progress;
export const registrationSteps = (p) => nextSteps(p).filter((s) => s.counts_as_registration).map((s) => s.key);
export const conversionSteps = (p) => nextSteps(p).filter((s) => s.counts_as_conversion).map((s) => s.key);

// ---- lifecycle --------------------------------------------------------------
export const stages = (p) => p.lifecycle?.stages || [];
export const stageKeys = (p) => stages(p).map((s) => s.key);
export const qualifiedStageKeys = (p) => stages(p).filter((s) => s.counts_as_qualified || s.counts_as_converted).map((s) => s.key);
export const convertedStageKeys = (p) => stages(p).filter((s) => s.counts_as_converted).map((s) => s.key);
export const stageWeight = (p, key) => stages(p).find((s) => s.key === key)?.weight ?? 5;

/** Map whatever the CRM calls a stage onto ours. */
export function normalizeStageKey(p, raw) {
  const s = String(raw || "").toLowerCase().trim();
  if (!s) return null;
  for (const st of stages(p)) {
    if (st.key === s) return st.key;
    if ((st.aliases || []).includes(s)) return st.key;
  }
  return null;
}

// ---- knowledge base ---------------------------------------------------------
export const kbCategories = (p) => p.kb_categories || [];
export const kbCategoryKeys = (p) => kbCategories(p).map((c) => c.key);

// ---- tags -------------------------------------------------------------------
// tagIndex builds a Map over every tag, which is hot: sourceOf() is called once
// per tag per conversation. Memoised on the profile object identity, so a new
// profile invalidates it for free.
const tagIndexMemo = new WeakMap();

export function tagIndex(p) {
  let m = tagIndexMemo.get(p);
  if (m) return m;
  m = new Map();
  for (const c of p.tags?.categories || []) {
    for (const t of c.tags || []) {
      const [code, en, ar] = Array.isArray(t) ? t : [t.code, t.en, t.ar];
      m.set(code, { code, en, ar, category: c.key, source: c.source });
    }
  }
  tagIndexMemo.set(p, m);
  return m;
}

export const tagCount = (p) => tagIndex(p).size;
export const sourceOf = (p, code) => tagIndex(p).get(code)?.source || null;
export const aiCategories = (p) => (p.tags?.categories || []).filter((c) => c.source === "ai");
export const aiTagCodes = (p) => aiCategories(p).flatMap((c) => (c.tags || []).map((t) => (Array.isArray(t) ? t[0] : t.code)));

export function tagLabel(p, code, lang = "ar") {
  const t = tagIndex(p).get(code) || (p.retired?.tags || []).find((x) => x.code === code);
  return t ? (lang === "en" ? t.en : t.ar) || code : code;
}

/** Groups where at most one tag may be true at once. */
export const categories = (p) => p.tags?.categories || [];
export const isKnownTag = (p, code) => tagIndex(p).has(code);
export function categoryLabel(p, key, lang = "ar") {
  const c = categories(p).find((x) => x.key === key);
  return c ? (lang === "en" ? c.name_en : c.name_ar) || key : key;
}

export function exclusiveGroups(p) {
  const groups = [];
  for (const c of p.tags?.categories || []) {
    const codes = (c.tags || []).map((t) => (Array.isArray(t) ? t[0] : t.code));
    if (c.exclusive === "all") groups.push(codes);
    else if (Array.isArray(c.exclusive)) groups.push(...c.exclusive);
  }
  return groups.filter((g) => g.length > 1);
}

// ---- scoring ----------------------------------------------------------------
export const scoringWeights = (p) => p.scoring?.weights || null;
export const conversionWeights = (p) => p.scoring?.conversion_weights
  || { next_step: 0.6, registration: 0.25, conversion: 0.15 };
export const leadScoreSettings = (p) => ({
  converted_bonus: 20, human_engaged: 15, bot_only_cap: 40, hot_at: 70, warm_at: 45,
  ...(p.scoring?.lead_score || {}),
});

export default {
  businessRules, complianceIntro, discoveryPlaybook, factsBlock,
  issueTypes, isIssueType, issueType, issueLabel, clampSeverity,
  riskFlags, isRiskFlag, salesPatterns, clampPatternKey, patternLabel,
  nextSteps, nextStepKeys, isNextStep, isRealProgress, registrationSteps, conversionSteps,
  stages, stageKeys, qualifiedStageKeys, convertedStageKeys, stageWeight, normalizeStageKey,
  kbCategories, kbCategoryKeys,
  tagIndex, tagCount, sourceOf, aiCategories, aiTagCodes, tagLabel, exclusiveGroups,
  categories, isKnownTag, categoryLabel,
  scoringWeights, conversionWeights, leadScoreSettings,
};
