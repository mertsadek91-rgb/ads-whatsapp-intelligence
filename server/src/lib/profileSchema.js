// The business profile's own validator.
//
// The existing design's single most valuable property is that the AI is handed
// CLOSED vocabularies and its output is checked against the same constants that
// built the prompt. Free-text reasons from a model never string-match across
// calls — "لم يذكر المخاطر" and "أغفل التحذير من الخطر" are one issue worded
// twice — which silently breaks every count built on top of them.
//
// Moving those vocabularies into a per-installation, AI-generated document puts
// that property at risk, so the document itself now gets the same treatment the
// model's output already gets: validated against a fixed contract, repaired
// where repair is unambiguous, and rejected where it is not.
import { SEVERITIES, SOURCES } from "./profileConstants.js";

export const SCHEMA_VERSION = "bp-1";

/**
 * Compliance issues that are NOT industry-specific. They describe conversation
 * quality, not domain rules, and a clinic profile that dropped them would
 * silently stop measuring the thing this product exists to measure. The
 * generator may add to these; it may not remove them.
 */
export const CORE_ISSUE_TYPES = [
  { key: "unanswered_question", default_severity: "moderate",
    ar: "أُغلقت المحادثة وسؤال العميل بلا جواب", en: "Conversation left with an unanswered question" },
  { key: "ignored_objection", default_severity: "moderate",
    ar: "تجاهل اعتراضاً جوهرياً للعميل", en: "Ignored a material customer objection" },
  { key: "generic_reply", default_severity: "minor",
    ar: "رد قالبي مع توفّر سياق كافٍ", en: "Generic reply despite available context" },
  { key: "repeated_question", default_severity: "minor",
    ar: "أعاد سؤالاً أجاب عنه العميل", en: "Repeated a question the customer already answered" },
  { key: "unclear_wording", default_severity: "informational",
    ar: "صياغة غير واضحة", en: "Unclear wording" },
  { key: "misleading_urgency", default_severity: "moderate",
    ar: "استعجال أو ضغط مُصطنع", en: "Misleading urgency or pressure" },
  { key: "false_certainty", default_severity: "major",
    ar: "يقين زائف بنتيجة غير مضمونة", en: "False certainty about an unguaranteed outcome" },
  { key: "misrepresentation", default_severity: "critical",
    ar: "معلومة غير صحيحة عن الشركة أو الخدمة", en: "Incorrect claim about the company or service" },
  { key: "overpromising", default_severity: "critical",
    ar: "وعد بنتيجة لا يمكن ضمانها", en: "Promising an outcome that cannot be guaranteed" },
  { key: "unsupported_claim", default_severity: "major",
    ar: "ادّعاء بلا سند", en: "Claim with no basis" },
];

const KEY_RE = /^[a-z][a-z0-9_]{2,47}$/;
const TAG_RE = /^[A-Z][A-Z0-9_%]{1,47}$/;

const slug = (s) => String(s || "").trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);

const str = (v) => (typeof v === "string" ? v.trim() : "");
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * validateProfile(raw, { repair })
 *   -> { profile, errors, warnings, repairs }
 *
 * `repairs` is returned rather than applied silently: an operator reviewing an
 * AI-generated profile has to be able to see "the model proposed X, we changed
 * it to Y", or a systematically bad generation looks like a clean one.
 */
export function validateProfile(raw, { repair = true } = {}) {
  const errors = [];
  const warnings = [];
  const repairs = [];
  const p = raw && typeof raw === "object" ? JSON.parse(JSON.stringify(raw)) : {};

  p.schema_version = SCHEMA_VERSION;
  p.language = p.language === "en" ? "en" : "ar";

  // ---- identity ----------------------------------------------------------
  p.identity = p.identity && typeof p.identity === "object" ? p.identity : {};
  p.identity.company_name = str(p.identity.company_name);
  p.identity.what_we_sell = str(p.identity.what_we_sell);
  p.identity.industry_key = slug(p.identity.industry_key) || "general";
  p.identity.audience = str(p.identity.audience);
  p.identity.restricted_markets = arr(p.identity.restricted_markets).map(str).filter(Boolean);
  if (!p.identity.what_we_sell) errors.push("identity.what_we_sell is required");

  // A fact the model could not quote is the most dangerous thing it can emit —
  // an invented licence number would be checked against as if it were true.
  p.identity.facts = arr(p.identity.facts).map((f) => {
    const fact = {
      key: slug(f?.key) || "fact",
      label_ar: str(f?.label_ar), label_en: str(f?.label_en),
      value: str(f?.value),
      verification: str(f?.verification),
      evidence: str(f?.evidence) || null,
      source: ["website", "operator", "unverified"].includes(f?.source) ? f.source : "unverified",
      verified_by_human: f?.verified_by_human === true,
    };
    if (!fact.evidence && fact.source === "website") {
      fact.source = "unverified";
      repairs.push(`fact "${fact.key}" claimed the website as its source but quoted nothing — marked unverified`);
    }
    return fact;
  }).filter((f) => f.value);

  // ---- rules -------------------------------------------------------------
  p.rules = p.rules && typeof p.rules === "object" ? p.rules : {};
  for (const k of ["business_rules_ar", "business_rules_en", "compliance_intro_ar", "compliance_intro_en"]) {
    p.rules[k] = str(p.rules[k]);
  }
  for (const k of ["discovery_playbook_ar", "discovery_playbook_en"]) {
    p.rules[k] = arr(p.rules[k]).map(str).filter(Boolean);
  }
  if (!p.rules.business_rules_ar && !p.rules.business_rules_en) {
    errors.push("rules.business_rules_* must not both be empty");
  }

  // ---- issue types -------------------------------------------------------
  const seenIssue = new Set();
  p.issue_types = arr(p.issue_types).map((t) => {
    let key = str(t?.key);
    if (!KEY_RE.test(key)) {
      const fixed = slug(key || t?.en || t?.ar);
      if (repair && KEY_RE.test(fixed)) {
        repairs.push(`issue type key "${key}" is not a valid identifier — renamed to "${fixed}"`);
        key = fixed;
      } else { errors.push(`issue type key "${key}" is not a valid identifier`); return null; }
    }
    if (seenIssue.has(key)) { errors.push(`duplicate issue type "${key}"`); return null; }
    seenIssue.add(key);
    let sev = t?.default_severity;
    if (!SEVERITIES.includes(sev)) {
      if (repair) { repairs.push(`issue type "${key}" had severity "${sev}" — set to "moderate"`); sev = "moderate"; }
      else { errors.push(`issue type "${key}" has an unknown severity "${sev}"`); return null; }
    }
    return { key, default_severity: sev, ar: str(t.ar) || key, en: str(t.en) || key, core: t.core === true };
  }).filter(Boolean);

  // The floor. Injected rather than merely warned about, because a profile
  // missing these stops measuring conversation quality at all.
  for (const core of CORE_ISSUE_TYPES) {
    if (!seenIssue.has(core.key)) {
      p.issue_types.push({ ...core, core: true });
      seenIssue.add(core.key);
      repairs.push(`core issue type "${core.key}" was missing and has been added`);
    } else {
      const found = p.issue_types.find((t) => t.key === core.key);
      found.core = true;
    }
  }
  if (!p.issue_types.length) errors.push("issue_types must not be empty");

  // ---- customer risk flags ------------------------------------------------
  p.customer_risk_flags = dedupeKeyed(arr(p.customer_risk_flags), errors, "customer risk flag");

  // ---- sales patterns -----------------------------------------------------
  p.sales_patterns = dedupeKeyed(arr(p.sales_patterns), errors, "sales pattern");
  if (!p.sales_patterns.some((x) => x.key === "other")) {
    // Load-bearing: without an escape valve the model force-fits a real case
    // into the wrong bucket, which is worse than an honest "other".
    p.sales_patterns.push({ key: "other", ar: "أخرى", en: "Other" });
    repairs.push('sales pattern "other" was missing and has been added as the escape valve');
  }

  // ---- next steps ---------------------------------------------------------
  const seenStep = new Set();
  p.next_steps = arr(p.next_steps).map((s) => {
    const key = KEY_RE.test(str(s?.key)) ? str(s.key) : slug(s?.key);
    if (!KEY_RE.test(key) || seenStep.has(key)) return null;
    seenStep.add(key);
    return {
      key, ar: str(s.ar) || key, en: str(s.en) || key,
      real_progress: s.real_progress !== false,
      counts_as_registration: s.counts_as_registration === true,
      counts_as_conversion: s.counts_as_conversion === true,
    };
  }).filter(Boolean);
  if (!p.next_steps.length) errors.push("next_steps must not be empty");
  if (!p.next_steps.some((s) => s.counts_as_conversion)) {
    errors.push("at least one next step must be marked counts_as_conversion");
  }

  // ---- lifecycle ----------------------------------------------------------
  p.lifecycle = p.lifecycle && typeof p.lifecycle === "object" ? p.lifecycle : {};
  const seenStage = new Set();
  p.lifecycle.stages = arr(p.lifecycle.stages).map((s) => {
    const key = KEY_RE.test(str(s?.key)) ? str(s.key) : slug(s?.key);
    if (!KEY_RE.test(key) || seenStage.has(key)) return null;
    seenStage.add(key);
    return {
      key, ar: str(s.ar) || key, en: str(s.en) || key,
      weight: Number.isFinite(Number(s.weight)) ? Number(s.weight) : 5,
      aliases: arr(s.aliases).map((a) => String(a).toLowerCase().trim()).filter(Boolean),
      counts_as_qualified: s.counts_as_qualified === true,
      counts_as_converted: s.counts_as_converted === true,
    };
  }).filter(Boolean);
  if (!p.lifecycle.stages.length) errors.push("lifecycle.stages must not be empty");
  if (!p.lifecycle.stages.some((s) => s.counts_as_converted)) {
    errors.push("at least one lifecycle stage must be marked counts_as_converted");
  }
  for (const k of ["conversion_noun_ar", "conversion_noun_en", "trial_noun_ar", "trial_noun_en"]) {
    p.lifecycle[k] = str(p.lifecycle[k]);
  }

  // ---- tags ---------------------------------------------------------------
  p.tags = p.tags && typeof p.tags === "object" ? p.tags : {};
  const seenTag = new Map();
  p.tags.categories = arr(p.tags.categories).map((c) => {
    const key = KEY_RE.test(str(c?.key)) ? str(c.key) : slug(c?.key);
    if (!KEY_RE.test(key)) return null;
    const source = Object.keys(SOURCES).includes(c?.source) ? c.source : "ai";
    const tags = arr(c.tags).map((t) => {
      const code = Array.isArray(t) ? str(t[0]) : str(t?.code);
      if (!TAG_RE.test(code)) return null;
      if (seenTag.has(code)) {
        repairs.push(
          `tag "${code}" was claimed by both "${seenTag.get(code)}" and "${key}" — ` +
          `kept in "${seenTag.get(code)}", removed from "${key}"`);
        return null;
      }
      seenTag.set(code, key);
      return Array.isArray(t) ? [code, str(t[1]), str(t[2])] : [code, str(t.en), str(t.ar)];
    }).filter(Boolean);
    return {
      key, source, dept: str(c.dept) || "auto", platform: str(c.platform),
      name_ar: str(c.name_ar) || key, name_en: str(c.name_en) || key, why_ar: str(c.why_ar),
      exclusive: c.exclusive === "all" ? "all" : (Array.isArray(c.exclusive) ? c.exclusive : null),
      tags,
    };
  }).filter(Boolean);

  // An exclusive group naming a tag that does not exist would silently never fire.
  for (const c of p.tags.categories) {
    if (!Array.isArray(c.exclusive)) continue;
    for (const group of c.exclusive) {
      for (const code of arr(group)) {
        if (!seenTag.has(code)) errors.push(`category "${c.key}" has an exclusive group naming unknown tag "${code}"`);
      }
    }
  }

  // ---- kb categories ------------------------------------------------------
  p.kb_categories = dedupeKeyed(arr(p.kb_categories), errors, "knowledge-base category");
  if (!p.kb_categories.length) {
    p.kb_categories = [{ key: "general", ar: "عام", en: "General" }];
    repairs.push("knowledge-base categories were empty — added a general bucket");
  }

  // ---- scoring ------------------------------------------------------------
  p.scoring = p.scoring && typeof p.scoring === "object" ? p.scoring : {};
  const w = p.scoring.weights;
  if (w && typeof w === "object") {
    const total = Object.values(w).reduce((a, b) => a + Number(b || 0), 0);
    if (Math.round(total) !== 100) errors.push(`scoring.weights must total 100, got ${total}`);
  }
  const cw = p.scoring.conversion_weights;
  if (cw && typeof cw === "object") {
    const total = Object.values(cw).reduce((a, b) => a + Number(b || 0), 0);
    if (Math.abs(total - 1) > 0.001) errors.push(`scoring.conversion_weights must total 1, got ${total}`);
  }

  // ---- calibration + retired ---------------------------------------------
  p.calibration_cases = arr(p.calibration_cases);
  p.retired = p.retired && typeof p.retired === "object" ? p.retired : {};
  for (const k of ["issue_types", "tags", "next_steps"]) p.retired[k] = arr(p.retired[k]);

  return { profile: p, errors, warnings, repairs };
}

function dedupeKeyed(list, errors, label) {
  const seen = new Set();
  return list.map((x) => {
    const key = KEY_RE.test(str(x?.key)) ? str(x.key) : slug(x?.key);
    if (!KEY_RE.test(key)) return null;
    if (seen.has(key)) { errors.push(`duplicate ${label} "${key}"`); return null; }
    seen.add(key);
    return { key, ar: str(x.ar) || key, en: str(x.en) || key };
  }).filter(Boolean);
}

export const isValid = (result) => result.errors.length === 0;

export default { validateProfile, CORE_ISSUE_TYPES, SCHEMA_VERSION, isValid };
