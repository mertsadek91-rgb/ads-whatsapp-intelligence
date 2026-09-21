// Editable business/compliance rules shared by every AI prompt that touches
// sales conversations (conversationAnalysis.js's per-conversation evaluation,
// report.js's coaching-script generator). Edit the *_AR/_EN string constants
// to change what the AI checks for and what it writes into "smart" reply
// suggestions — no other file should hardcode these facts. Plain JS, no
// framework, so a non-developer can safely edit the text.

// One shared taxonomy for BOTH a weak conversation-opening ("opening_pattern_key")
// and a mid-conversation dropout ("dropout_pattern_key") — the same sales
// mistake can happen at either moment. Kept short (7 buckets) and constrained:
// free-text reasons from an LLM never string-match exactly across calls
// ("قفز لطلب التسجيل" vs "انتقل مباشرة لرابط التسجيل" are the same mistake
// worded differently), which would silently break the "used N times" counts
// this feature exists to produce. "other" is a deliberate escape valve so the
// AI never has to force-fit a real case into the wrong bucket.
export const SALES_PATTERNS = [
  { key: "premature_registration_push", ar: "قفز لطلب التسجيل دون شرح القيمة", en: "Jumped to registration without explaining value" },
  { key: "ignored_customer_question", ar: "تجاهل سؤال صريح من العميل", en: "Ignored an explicit customer question" },
  { key: "no_risk_or_education_framing", ar: "لم يُذكر المخاطر أو أن الدروس تُفتح بعد الحساب", en: "Did not mention risk or that lessons unlock after account opening" },
  { key: "slow_follow_up", ar: "تأخّر واضح بعد إشارة اهتمام", en: "Slow follow-up after a clear interest signal" },
  { key: "generic_unpersonalized_reply", ar: "رد عام قالبي متجاهل لنيّة العميل", en: "Generic templated reply ignoring the customer's stated intent" },
  { key: "no_discovery_questions", ar: "لم يُسأل عن هدف العميل الحقيقي", en: "Never asked what the customer actually wants" },
  { key: "other", ar: "أخرى", en: "Other" },
];

const PATTERN_KEYS = new Set(SALES_PATTERNS.map((p) => p.key));

/**
 * Whitelist-or-"other" clamp, mirroring the existing lead_intent validation.
 * A missing key (nothing detected) stays null; any other off-schema value
 * gets coerced to "other" (with a console.warn from the caller so drift is
 * visible — a real "other" classification is indistinguishable from a
 * coerced one otherwise).
 */
export function clampPatternKey(key) {
  if (key == null) return null;
  return PATTERN_KEYS.has(key) ? key : "other";
}

export function patternLabel(key, lang = "ar") {
  const p = SALES_PATTERNS.find((x) => x.key === key) || SALES_PATTERNS[SALES_PATTERNS.length - 1];
  return lang === "en" ? p.en : p.ar;
}

export const BUSINESS_RULES_AR = `
قواعد عمل ثابتة يجب مراعاتها عند تقييم الموظف وعند كتابة أي رد "ذكي" بديل:
1. الدورات التعليمية على المنصّة موجودة فعلاً، لكنها لا تُفتح إلا بعد فتح حساب
   (تجريبي Demo أو حقيقي Real، أي نوع). قفز الموظف مباشرة لطلب "سجّل" دون
   تفسير قيمة التداول ودون ذكر أن الدروس تصبح متاحة بعد فتح الحساب = خطأ شائع
   يجب رصده.
2. يجب دائماً ذكر المخاطر وأنواع التداول المتاحة بوضوح، بدون وعد أو ضمان
   أرباح أو تقليل من حجم الخطر.
3. الرد "الذكي" النموذجي: تحية دافئة تناسب نيّة العميل الحقيقية (تعلّم/تداول/
   فتح حساب/غير ذلك) -> تفسير قيمة التداول ببساطة -> ذكر أن الدورات متاحة بعد
   فتح حساب (تجريبي أو حقيقي) -> ذكر المخاطر وأنواع التداول دون وعد بربح ->
   سؤال متابعة يكشف هدف العميل ويُبقي الحوار مستمراً.
`;

export const BUSINESS_RULES_EN = `
Fixed business rules to apply when evaluating the agent and when writing any
alternative "smart" reply:
1. The platform's educational courses genuinely exist, but only unlock after
   opening an account (Demo or Real, any type). Jumping straight to "please
   register" without explaining the value of trading and without mentioning
   that lessons become available after opening an account is a common
   mistake to flag.
2. Always disclose risk and the available trading types clearly, without
   ever promising or guaranteeing profit or downplaying risk.
3. The model "smart" reply: a warm greeting matching the customer's real
   intent (learning / trading / opening an account / other) -> a simple
   explanation of trading's value -> mentioning courses unlock after opening
   an account (demo or real) -> mentioning risk and trading types with no
   profit promise -> one follow-up question that reveals the customer's goal
   and keeps the conversation going.
`;

export const DISCOVERY_PLAYBOOK_AR = [
  "ابدأ بتحية دافئة تسأل عن هدف العميل الحقيقي، لا برسالة تسجيل جاهزة.",
  "اسأل: هل تبحث عن تعلّم التداول، أم البدء بالتداول مباشرة، أم فتح حساب فقط؟",
  "اسأل عن خبرته السابقة بالتداول (مبتدئ/له تجربة) لتخصيص الشرح.",
  "اشرح أن الدروس والمواد التعليمية متاحة داخل المنصة بعد فتح حساب (تجريبي أو حقيقي).",
  "اذكر المخاطر وأنواع التداول المتاحة بوضوح، بدون أي وعد أو ضمان أرباح.",
  "اختم بسؤال متابعة يبني الحوار (مثال: أي الأسواق يهمّك أكثر؟) لا برابط تسجيل فقط.",
];

export const DISCOVERY_PLAYBOOK_EN = [
  "Open with a warm greeting asking about the customer's real goal, not a canned registration message.",
  "Ask: are they looking to learn trading, start trading right away, or just open an account?",
  "Ask about their prior trading experience (beginner vs. experienced) to tailor the explanation.",
  "Explain that lessons and educational material are available inside the platform after opening an account (demo or real).",
  "Clearly mention risk and the available trading types, with no promise or guarantee of profit.",
  "Close with a follow-up question that keeps the conversation going (e.g. which markets interest you most?), not just a registration link.",
];

export default {
  SALES_PATTERNS, clampPatternKey, patternLabel,
  BUSINESS_RULES_AR, BUSINESS_RULES_EN, DISCOVERY_PLAYBOOK_AR, DISCOVERY_PLAYBOOK_EN,
};
