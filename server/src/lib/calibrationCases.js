// Ground-truth cases for the compliance evaluator, taken from the upgrade
// spec's own worked examples plus the company's real licence facts.
//
// These are NOT unit tests of our code — they are a measurement of the MODEL.
// Each case is a small synthetic conversation with a known correct verdict, so a
// prompt change, a model change or a policy change can be scored instead of
// guessed at. Run them with scripts/calibrate.mjs.
//
// The hardest requirement in the spec is that a keyword is not a violation, so
// the cases are deliberately paired: the same words in a compliant and a
// non-compliant sentence.
import { getProfile } from "./businessProfile.js";

// The company own facts, from the profile an operator reviewed — not from a
// constant naming one particular business.
const fact = (key, fallback) =>
  (getProfile().identity?.facts || []).find((f) => f.key === key)?.value || fallback;
const COMPANY_FACTS = {
  get regulator() { return fact("regulator", "الجهة المنظِّمة المعتمدة"); },
  get legal_entity() { return fact("legal_entity", "الشركة"); },
  get licence_number() { return fact("licence_number", "رقم الترخيص المعلن"); },
};

const msg = (dir, body, sender = null) => ({
  ts: "2026-07-20T09:00:00Z", dir, sender: dir === "in" ? "customer" : (sender || "Agent"), body,
});

/**
 * `expect.issues` — types that MUST be reported.
 * `expect.absent` — types that must NOT be reported (the false-positive guard).
 * `expect.flags`  — customer risk flags that must be reported.
 */
export const CALIBRATION_CASES = [
  {
    id: "guaranteed_profit_positive",
    why: "An explicit profit guarantee is the canonical critical violation.",
    thread: [
      msg("in", "هل أضمن ربح لو فتحت حساب؟"),
      msg("out", "نعم الربح مضمون معنا 100% ولا يمكن أن تخسر."),
    ],
    expect: { issues: ["guaranteed_profit"] },
  },
  {
    id: "guaranteed_profit_negative",
    why: "The same words, negated. Flagging this would punish correct disclosure.",
    thread: [
      msg("in", "هل أضمن ربح لو فتحت حساب؟"),
      msg("out", "لا، الأرباح في التداول غير مضمونة والتداول يحمل مخاطر خسارة رأس المال. "
        + "أنصحك بالبدء بحساب تجريبي لتتعلّم أولاً."),
    ],
    expect: { issues: [], absent: ["guaranteed_profit", "no_risk_claim", "risk_disclosure_missing"] },
  },
  {
    id: "customer_asks_guarantee",
    why: "The customer expecting a guarantee is a CUSTOMER flag, never the employee's violation.",
    thread: [
      msg("in", "أنا عايز دخل ثابت مضمون كل شهر من التداول، ممكن؟"),
      msg("out", "التداول لا يوفّر دخلاً ثابتاً ولا أرباحاً مضمونة، وفيه احتمال خسارة. "
        + "هل تبحث عن التعلّم أولاً أم فتح حساب تجريبي؟"),
    ],
    expect: { issues: [], absent: ["guaranteed_profit"], flags: ["wants_fixed_income"] },
  },
  {
    id: "no_risk_claim",
    why: "Claiming trading carries no risk is critical on its own.",
    thread: [
      msg("in", "التداول فيه خطر؟"),
      msg("out", "لا خطر إطلاقاً، التداول معنا آمن تماماً بدون أي مخاطرة."),
    ],
    expect: { issues: ["no_risk_claim"] },
  },
  {
    id: "probabilistic_analysis_allowed",
    why: "Probabilistic market commentary is allowed; only guaranteed prediction is not.",
    thread: [
      msg("in", "الذهب رايح فين؟"),
      msg("out", "قد يرتفع الذهب إذا استمر ضعف الدولار، لكن لا أحد يستطيع التأكّد من اتجاه السوق، "
        + "والحركة قد تنعكس. القرار يبقى لك مع إدارة للمخاطر."),
    ],
    expect: { issues: [], absent: ["false_certainty", "unauthorized_advice"] },
  },
  {
    id: "false_certainty",
    why: "A guaranteed market prediction.",
    thread: [
      msg("in", "الذهب رايح فين؟"),
      msg("out", "الذهب سيرتفع بالتأكيد هذا الأسبوع، ادخل الآن الصفقة لا يمكن أن تخسر."),
    ],
    expect: { issues: ["false_certainty"] },
  },
  {
    id: "harmful_funding",
    why: "Encouraging borrowed money is critical regardless of how it is phrased.",
    thread: [
      msg("in", "مامعايا فلوس حاليا"),
      msg("out", "استلف من صاحبك أو استخدم الكريدت كارد وافتح الحساب، هترجّعهم من أول أسبوع."),
    ],
    expect: { issues: ["harmful_funding_advice"] },
  },
  {
    id: "customer_borrowed_funds",
    why: "The customer mentioning borrowed money is a flag on THEM, and the employee declining is correct.",
    thread: [
      msg("in", "هستلف فلوس من أخويا وأتداول بيها، إيه رأيك؟"),
      msg("out", "لا أنصح بالتداول بأموال مقترضة إطلاقاً، لأن الخسارة محتملة. "
        + "ابدأ بحساب تجريبي مجاني بدون أي إيداع."),
    ],
    expect: { issues: [], absent: ["harmful_funding_advice"], flags: ["borrowed_funds"] },
  },
  {
    id: "wrong_regulator",
    why: `The licence is ${COMPANY_FACTS.regulator}. Naming another regulator is a misrepresentation.`,
    thread: [
      msg("in", "ما هو رقم الترخيص ومن الجهة المنظمة؟"),
      msg("out", "نحن مرخّصون من SCA الإمارات."),
    ],
    expect: { issues: ["regulatory_misrepresentation"] },
  },
  {
    id: "correct_regulator",
    why: "Stating the real licence correctly must never be a finding.",
    thread: [
      msg("in", "ما هو رقم الترخيص ومن الجهة المنظمة؟"),
      msg("out", `شركة ${COMPANY_FACTS.legal_entity} مرخّصة من ${COMPANY_FACTS.regulator} `
        + `برقم ${COMPANY_FACTS.licence_number}، ويمكنك التحقّق من السجل العام للجهة.`),
    ],
    expect: { issues: [], absent: ["regulatory_misrepresentation"] },
  },
  {
    id: "corrected_mistake",
    why: "The spec asks that a self-corrected slip be downgraded or not recorded.",
    thread: [
      msg("in", "الربح مضمون؟"),
      msg("out", "أيوه مضمون..."),
      msg("out", "أعتذر، تصحيح: الأرباح غير مضمونة إطلاقاً والتداول يحمل مخاطر خسارة. "
        + "لا يجوز أن أعدك بربح."),
    ],
    expect: { softer: ["guaranteed_profit"] },   // absent, or at most non-critical
  },
  {
    id: "unauthorized_advice",
    why: "Telling a customer what position to open is personal financial advice.",
    thread: [
      msg("in", "أفتح صفقة قد إيه؟"),
      msg("out", "حوّل كل مدخراتك على الذهب وافتح صفقة بحجم 5 لوت برفع مالي 1:500، ده هيضاعف حسابك."),
    ],
    expect: { issues: ["unauthorized_advice"] },
  },
  {
    id: "education_not_advice",
    why: "Explaining a product is not advice — the spec insists these be distinguished.",
    thread: [
      msg("in", "إيه هو اللوت؟"),
      msg("out", "اللوت هو وحدة حجم الصفقة: اللوت القياسي يساوي 100,000 وحدة من العملة الأساسية. "
        + "حجم الصفقة يؤثّر على الربح والخسارة معاً، والاختيار يعتمد على رأس مالك وإدارتك للمخاطر."),
    ],
    expect: { issues: [], absent: ["unauthorized_advice"] },
  },
  {
    id: "misleading_leverage",
    why: "Leverage described only as an upside multiplier.",
    thread: [
      msg("in", "الرفع المالي إيه فايدته؟"),
      msg("out", "الرفع المالي فلوس مجانية من الشركة تضاعف أرباحك، استخدم أقصى رفع متاح دايماً."),
    ],
    expect: { issues: ["misleading_leverage"] },
  },
  {
    id: "clean_conversation",
    why: "A textbook-correct conversation must produce NO findings at all. If this one is flagged, the evaluator is over-sensitive and every score is depressed.",
    thread: [
      msg("in", "مرحبا، عايز أتعلم التداول"),
      msg("out", "أهلاً بك. قبل ما أرشّح لك أي خطوة: هل تبحث عن تعلّم التداول أولاً، "
        + "أم البدء بالتداول مباشرة؟ وهل لديك خبرة سابقة؟"),
      msg("in", "مبتدئ تماما، عايز أتعلم"),
      msg("out", "ممتاز. المواد التعليمية متاحة داخل المنصّة بعد فتح حساب — تجريبي أو حقيقي — "
        + "وأنصحك بالتجريبي لأنه بدون أي مخاطرة مالية. "
        + "وللأمانة: التداول يحمل مخاطر خسارة رأس المال والأرباح غير مضمونة. "
        + "تحب أشرح لك خطوات فتح الحساب التجريبي؟"),
      msg("in", "ايوه من فضلك"),
      msg("out", "تمام، هأبعتلك الخطوات بالتفصيل. وأي سؤال عن الأسواق أو المنصّة أنا موجود."),
    ],
    expect: { issues: [], absent: ["risk_disclosure_missing", "guaranteed_profit", "premature_link", "generic_reply", "unauthorized_advice"] },
  },
  {
    id: "risk_needed_and_missing",
    why: "The customer asks about returns and is pushed to fund a live account with no risk mention — the context that genuinely requires disclosure.",
    thread: [
      msg("in", "لو حطيت 1000 دولار هكسب كام في الشهر؟"),
      msg("out", "على حسب، لكن الفرص كبيرة. حوّل 1000 دولار على الحساب الحقيقي وابدأ فوراً، "
        + "ده رابط التسجيل."),
    ],
    expect: { issues: ["risk_disclosure_missing"] },
  },
  {
    id: "risk_not_needed",
    why: "A pure platform-support question. Requiring a risk warning here is what drives the over-flagging we measured (33 of 53 findings on one employee).",
    thread: [
      msg("in", "نسيت كلمة السر، أعملها إزاي؟"),
      msg("out", "من صفحة الدخول اضغط «نسيت كلمة المرور» وهيوصلك رابط على بريدك المسجّل. "
        + "لو ما وصلك خلال دقيقتين تحقّق من مجلد الرسائل غير المرغوبة."),
    ],
    expect: { issues: [], absent: ["risk_disclosure_missing"] },
  },
];

export default { CALIBRATION_CASES };
