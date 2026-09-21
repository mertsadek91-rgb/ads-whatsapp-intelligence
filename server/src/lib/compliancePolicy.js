// The compliance vocabulary the AI evaluates a conversation against: a closed
// set of issue types, each with a default severity and a bilingual label, plus
// the prompt text that teaches the model what does and does not count.
//
// Two design rules, both learned from the existing pattern taxonomy in
// businessKnowledge.js:
//
// 1. Issue types are a FIXED ENUM. Free-text reasons from an LLM never
//    string-match across calls ("لم يذكر المخاطر" vs "أغفل التحذير من الخطر" are
//    one issue worded twice), which silently breaks every count and score this
//    layer exists to produce.
//
// 2. Keyword presence is NOT a violation. "الربح مضمون" is one; "الأرباح غير
//    مضمونة" is correct communication containing the same words. The prompt says
//    so explicitly and the tests pin both directions.
//
// POLICY_VERSION is stored with every evaluation. Changing the rules below means
// bumping it, which makes old rows re-analysable instead of silently stale.
// v1.1 — added COMPANY_FACTS so regulatory claims are checked against the real
//        licence instead of guessed at.
export const POLICY_VERSION = "v1.1";

/**
 * The company's own regulatory facts, from
 * https://istmarkets.com/regulation-client-asset-protection/
 *
 * Without these the model had nothing to check a licensing claim against, so it
 * flagged "مرخصه من SCA" on suspicion alone — a critical finding it could not
 * justify either way. With them the check is factual: the licence is Mauritian
 * FSC, so naming a different regulator IS a misrepresentation, and naming this
 * one correctly is not a finding at all.
 *
 * Keep this in sync with the public page. If a second entity or licence exists,
 * add it here — an unlisted licence would produce false positives.
 */
export const COMPANY_FACTS = {
  legal_entity: "IST Markets Ltd",
  regulator: "Financial Services Commission (FSC), Republic of Mauritius",
  licence_number: "GB22200573 / SEC-2.1B",
  licence_category: "Investment Dealer (Full Service Dealer, Excluding Underwriting)",
  company_registration: "190266",
  registered_address:
    "The Cyberati Lounge, Ground Floor, The Catalyst, Silicon Avenue, 40 Cybercity, Ebene 72201, Mauritius",
  client_funds:
    "Client funds are intended to be held in segregated accounts separate from the company's operating funds, "
    + "in line with applicable regulatory requirements. This reduces certain risks but does not eliminate all risk, "
    + "including banking counterparty risk and extreme market events.",
  restricted_countries: ["USA", "North Korea", "China"],
  verification: "FSC Mauritius public register of licensees (by company name or licence number)",
};

const factsBlockAr = `
معلومات الشركة المعتمدة — هي المرجع الوحيد للتحقّق من أي ادّعاء تنظيمي:
  • الكيان القانوني: ${COMPANY_FACTS.legal_entity}
  • الجهة المنظِّمة: ${COMPANY_FACTS.regulator}
  • رقم الترخيص: ${COMPANY_FACTS.licence_number}
  • فئة الترخيص: ${COMPANY_FACTS.licence_category}
  • رقم السجل: ${COMPANY_FACTS.company_registration}
  • العنوان المسجّل: ${COMPANY_FACTS.registered_address}
  • أموال العملاء: ${COMPANY_FACTS.client_funds}
  • دول غير مخدومة: ${COMPANY_FACTS.restricted_countries.join("، ")} وغيرها.

كيف تُطبَّق هذه الحقائق:
  • ذكر الموظف لجهة منظِّمة **غير** المذكورة أعلاه (مثل SCA أو FCA أو CySEC) =
    regulatory_misrepresentation، لأن الشركة لا تملك ذلك الترخيص.
  • ذكر الترخيص الموريشيوسي (FSC) أو رقمه بشكل صحيح = تواصل صحيح، وليس مخالفة.
  • ادّعاء أن الجهة المنظِّمة تضمن أرباح العميل أو تضمن كل أمواله =
    regulatory_misrepresentation.
  • ادّعاء أن الشركة بنك = regulatory_misrepresentation.
  • إن لم يذكر الموظف أي معلومة تنظيمية فلا تسجّل هذا النوع إطلاقاً.
`;

/**
 * `default_severity` is where an issue lands when the model doesn't say. The
 * model may raise or lower it one step with justification; anything outside the
 * ladder is clamped back to the default.
 */
export const ISSUE_TYPES = [
  {
    key: "risk_disclosure_missing", default_severity: "major",
    ar: "لم يُذكر خطر التداول في سياق يستوجبه", en: "Risk not disclosed where required",
  },
  {
    key: "guaranteed_profit", default_severity: "critical",
    ar: "وعد بربح مضمون", en: "Guaranteed-profit promise",
  },
  {
    key: "no_risk_claim", default_severity: "critical",
    ar: "ادّعاء أن التداول بلا مخاطر", en: "Claim that trading carries no risk",
  },
  {
    key: "false_certainty", default_severity: "major",
    ar: "يقين زائف باتجاه السوق", en: "False certainty about market direction",
  },
  {
    key: "misleading_urgency", default_severity: "moderate",
    ar: "استعجال أو ضغط مُصطنع", en: "Misleading urgency or pressure",
  },
  {
    key: "harmful_funding_advice", default_severity: "critical",
    ar: "تشجيع على تمويل ضار (قرض/مال أساسي)", en: "Encouraging harmful funding (debt / essential money)",
  },
  {
    key: "regulatory_misrepresentation", default_severity: "critical",
    ar: "معلومة غير صحيحة عن الترخيص أو التنظيم", en: "Incorrect licensing or regulatory claim",
  },
  {
    key: "unauthorized_advice", default_severity: "major",
    ar: "نصيحة مالية شخصية غير مصرّح بها", en: "Unauthorized personal financial advice",
  },
  {
    key: "incorrect_fees", default_severity: "major",
    ar: "معلومة خاطئة عن الرسوم أو شروط التداول", en: "Incorrect fee or trading-condition information",
  },
  {
    key: "misleading_leverage", default_severity: "major",
    ar: "شرح مضلّل للرفع المالي", en: "Misleading leverage explanation",
  },
  {
    key: "misused_testimonials", default_severity: "moderate",
    ar: "استخدام نتائج سابقة كضمان للمستقبل", en: "Past results presented as guaranteed future results",
  },
  {
    key: "ignored_objection", default_severity: "moderate",
    ar: "تجاهل اعتراضاً جوهرياً للعميل", en: "Ignored a material customer objection",
  },
  {
    key: "unanswered_question", default_severity: "moderate",
    ar: "أُغلقت المحادثة وسؤال العميل بلا جواب", en: "Conversation left with an unanswered question",
  },
  {
    key: "wrong_classification", default_severity: "moderate",
    ar: "تصنيف خاطئ لحالة العميل", en: "Incorrect customer classification",
  },
  {
    key: "premature_link", default_severity: "minor",
    ar: "أرسل رابط التسجيل قبل فهم حاجة العميل", en: "Sent the registration link before understanding the need",
  },
  {
    key: "generic_reply", default_severity: "minor",
    ar: "رد قالبي مع توفّر سياق كافٍ", en: "Generic reply despite available context",
  },
  {
    key: "repeated_question", default_severity: "minor",
    ar: "أعاد سؤالاً أجاب عنه العميل", en: "Repeated a question the customer already answered",
  },
  {
    key: "unclear_wording", default_severity: "informational",
    ar: "صياغة غير واضحة", en: "Unclear wording",
  },
];

const BY_KEY = new Map(ISSUE_TYPES.map((t) => [t.key, t]));
export const SEVERITIES = ["informational", "minor", "moderate", "major", "critical"];

/** Customer-side risk flags. These describe the CUSTOMER, never a violation by
 *  the employee — they exist to route the conversation to the right approved
 *  response, so they must not cost the employee any points. */
export const CUSTOMER_RISK_FLAGS = [
  { key: "expects_guaranteed_profit", ar: "يتوقّع ربحاً مضموناً", en: "Expects guaranteed profit" },
  { key: "wants_fixed_income", ar: "يريد دخلاً ثابتاً", en: "Wants a fixed income" },
  { key: "recover_losses_fast", ar: "يريد تعويض خسائر سابقة سريعاً", en: "Wants to recover past losses quickly" },
  { key: "borrowed_funds", ar: "يذكر أموالاً مقترضة", en: "Mentions borrowed funds" },
  { key: "financial_distress", ar: "يذكر ضيقاً مالياً", en: "Mentions financial distress" },
  { key: "does_not_understand_risk", ar: "لا يفهم مخاطر التداول", en: "Does not understand trading risk" },
  { key: "wants_guaranteed_signals", ar: "يطلب توصيات مضمونة", en: "Requests guaranteed signals" },
  { key: "wants_agent_to_trade", ar: "يطلب أن يتداول الموظف بالنيابة عنه", en: "Asks the agent to trade on their behalf" },
  { key: "essential_money", ar: "يريد استخدام مال أساسي للمعيشة", en: "Wants to use essential living money" },
  { key: "impulsive", ar: "سلوك متهوّر", en: "Impulsive behaviour" },
];
const FLAG_KEYS = new Set(CUSTOMER_RISK_FLAGS.map((f) => f.key));

/** The customer-journey milestones that count as a real next step. */
export const NEXT_STEP_TYPES = [
  "info_requested", "callback_requested", "callback_scheduled", "demo_requested",
  "demo_opened", "registration_started", "registration_completed",
  "verification_started", "verification_completed", "live_account_requested",
  "deposit_question", "deposit_intent", "deposit_completed", "follow_up_scheduled",
  "transferred", "closed_not_interested", "closed_not_qualified",
];
const NEXT_STEP_SET = new Set(NEXT_STEP_TYPES);

// A next step that only means "the customer asked something" is not progress
// toward an account; these are the ones that count as qualified progress.
const SHALLOW_STEPS = new Set(["info_requested", "closed_not_interested", "closed_not_qualified"]);
export const isRealProgress = (t) => NEXT_STEP_SET.has(t) && !SHALLOW_STEPS.has(t);

export function issueType(key) { return BY_KEY.get(key) || null; }
export function issueLabel(key, lang = "ar") {
  const t = BY_KEY.get(key);
  return t ? (lang === "en" ? t.en : t.ar) : key;
}
export const isIssueType = (k) => BY_KEY.has(k);
export const isSeverity = (s) => SEVERITIES.includes(s);
export const isRiskFlag = (k) => FLAG_KEYS.has(k);
export const isNextStep = (k) => NEXT_STEP_SET.has(k);

/**
 * Severity the model proposed, clamped to at most one step away from the type's
 * default. A model that calls a guaranteed-profit promise "informational" is
 * wrong in a way that would quietly gut the whole compliance score, and one that
 * calls unclear wording "critical" would put an unfair red flag on a wall
 * screen. One step of movement is judgement; more is drift.
 */
export function clampSeverity(typeKey, proposed) {
  const t = BY_KEY.get(typeKey);
  if (!t) return null;
  if (!isSeverity(proposed)) return t.default_severity;
  const di = SEVERITIES.indexOf(t.default_severity);
  const pi = SEVERITIES.indexOf(proposed);
  const clamped = Math.max(di - 1, Math.min(di + 1, pi));
  return SEVERITIES[clamped];
}

// ---------------------------------------------------------------- prompt text
const typeList = ISSUE_TYPES.map((t) => `  - ${t.key}: ${t.ar} (الافتراضي: ${t.default_severity})`).join("\n");
const flagList = CUSTOMER_RISK_FLAGS.map((f) => `  - ${f.key}: ${f.ar}`).join("\n");

export const COMPLIANCE_RULES_AR = `
تقييم الالتزام والدقّة — اقرأ هذه القواعد بحذر:

القاعدة الأهم: **وجود كلمة لا يعني وجود مخالفة**. احكم على الجملة كاملة في سياقها.
  • "الربح مضمون" → مخالفة (guaranteed_profit).
  • "الأرباح في التداول غير مضمونة" → تواصل صحيح، وليست مخالفة إطلاقاً.
  • "هل الربح مضمون؟" من **العميل** → ليست مخالفة على الموظف؛ سجّلها علامة
    خطورة على العميل (expects_guaranteed_profit).
  • إن أخطأ الموظف ثم صحّح نفسه في نفس المحادثة → خفّف الخطورة أو لا تسجّلها.

ذكر المخاطر: لا تشترط جملة تحذير حرفية في كل رسالة. اشترطها فقط في سياق يستوجبها:
سؤال العميل عن حجم الربح، أو حديث الموظف عن العوائد، أو سؤال عن الضمان، أو
تشجيع على إيداع حساب حقيقي، أو شرح الرفع المالي، أو عميل واضح أنه لا يفهم الخطر.

فرّق بوضوح بين:
  • معلومة تعليمية عامة أو شرح للمنتج ← مسموح.
  • تحليل احتمالي ("قد يرتفع الذهب إذا…") ← مسموح.
  • تنبؤ مضمون ("الذهب سيرتفع بالتأكيد") ← false_certainty.
  • نصيحة مالية شخصية ("ضع كل مالك في الذهب"، "افتح صفقة بهذا الحجم") ← unauthorized_advice.

${factsBlockAr}
أنواع المخالفات المسموح استخدامها فقط:
${typeList}

علامات خطورة العميل (تصف العميل، ولا تُحسَب مخالفة على الموظف):
${flagList}

لكل مخالفة أعِد: النوع، الخطورة، الثقة (0..1)، اقتباساً حرفياً من رسالة الموظف
كدليل، سبب التصنيف، وبديلاً مقترحاً متوافقاً. إن لم تجد اقتباساً حرفياً من رسالة
الموظف فلا تسجّل المخالفة.
`;

export const COMPLIANCE_RULES_EN = `
Compliance and accuracy evaluation — read these rules carefully.

The most important rule: **a keyword is not a violation.** Judge the whole
sentence in context.
  • "Profit is guaranteed" -> a violation (guaranteed_profit).
  • "Trading profits are not guaranteed" -> correct communication, not a violation.
  • "Is profit guaranteed?" from the CUSTOMER -> not a violation by the employee;
    record it as a customer risk flag (expects_guaranteed_profit) instead.
  • If the employee misspoke and corrected it later in the same conversation,
    lower the severity or do not record it.

Risk disclosure: do not require a literal warning in every message. Require it
only where context demands it: the customer asks how much they will earn, the
employee discusses returns, the customer asks whether profit is guaranteed, the
employee encourages funding a live account, leverage is explained, or the
customer clearly does not understand risk.

Distinguish clearly between:
  • general education or product explanation -> allowed;
  • probabilistic analysis ("gold may rise if…") -> allowed;
  • a guaranteed prediction ("gold will definitely rise") -> false_certainty;
  • personal financial advice ("put all your money in gold", "open this lot
    size") -> unauthorized_advice.

Only these issue types may be used:
${ISSUE_TYPES.map((t) => `  - ${t.key}: ${t.en} (default: ${t.default_severity})`).join("\n")}

Customer risk flags (they describe the CUSTOMER and never count against the
employee):
${CUSTOMER_RISK_FLAGS.map((f) => `  - ${f.key}: ${f.en}`).join("\n")}

For every issue return: type, severity, confidence (0..1), a VERBATIM quote from
an employee message as evidence, why it was classified that way, and a compliant
alternative. If you cannot quote the employee verbatim, do not record the issue.
`;

export default {
  POLICY_VERSION, COMPANY_FACTS, ISSUE_TYPES, SEVERITIES, CUSTOMER_RISK_FLAGS, NEXT_STEP_TYPES,
  issueType, issueLabel, isIssueType, isSeverity, isRiskFlag, isNextStep,
  clampSeverity, isRealProgress, COMPLIANCE_RULES_AR, COMPLIANCE_RULES_EN,
};
