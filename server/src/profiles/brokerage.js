// A forex/CFD brokerage profile — the industry this product was originally
// written for, extracted verbatim from the constants that used to be compiled
// into compliancePolicy.js and businessKnowledge.js.
//
// It has three jobs:
//   1. It is the migration path for an existing brokerage installation —
//      importing it reproduces the previous behaviour exactly.
//   2. It is the worked example. A generic seed cannot show an operator what a
//      well-specified profile looks like; this can.
//   3. It is the proof that the refactor was behaviour-preserving: the existing
//      test suite runs against it and its assertions did not change.
//
// Note what is NOT here: this is a business profile, not a company identity.
// The real company's legal name, licence number and address are deliberately
// left blank — they are facts about one installation, and shipping them in
// source is exactly what this whole exercise was about removing. An operator
// migrating a real brokerage fills in `identity.facts` from their own licence.
import { GENERIC_PROFILE } from "./generic.js";

export const BROKERAGE_PROFILE = {
  ...GENERIC_PROFILE,
  language: "ar",

  identity: {
    company_name: "",
    what_we_sell: "شركة وساطة مالية تقدّم التداول في العملات وعقود الفروقات، وتتلقّى استفسارات العملاء عبر واتساب من الحملات الإعلانية.",
    industry_key: "forex_brokerage",
    audience: "أفراد مهتمون بالتداول في الخليج وشمال أفريقيا",
    restricted_markets: [],
    // Left empty on purpose — see the header. Fill these from your own licence.
    facts: [],
    facts_rules_ar: "", facts_rules_en: "",
  },

  rules: {
    business_rules_ar: `قواعد عمل ثابتة يجب مراعاتها عند تقييم الموظف وعند كتابة أي رد "ذكي" بديل:
1. الدورات التعليمية على المنصّة موجودة فعلاً، لكنها لا تُفتح إلا بعد فتح حساب
   (تجريبي Demo أو حقيقي Real، أي نوع). قفز الموظف مباشرة لطلب "سجّل" دون
   تفسير قيمة التداول ودون ذكر أن الدروس تصبح متاحة بعد فتح الحساب = خطأ شائع
   يجب رصده.
2. يجب دائماً ذكر المخاطر وأنواع التداول المتاحة بوضوح، بدون وعد أو ضمان
   أرباح أو تقليل من حجم الخطر.
3. الرد "الذكي" النموذجي: تحية دافئة تناسب نيّة العميل الحقيقية (تعلّم/تداول/
   فتح حساب/غير ذلك) ← تفسير قيمة التداول ببساطة ← ذكر أن الدورات متاحة بعد
   فتح حساب (تجريبي أو حقيقي) ← ذكر المخاطر وأنواع التداول دون وعد بربح ←
   سؤال متابعة يكشف هدف العميل ويُبقي الحوار مستمراً.`,
    business_rules_en: `Fixed business rules to apply when evaluating the agent and when writing any
alternative "smart" reply:
1. The platform's educational courses genuinely exist, but only unlock after
   opening an account (Demo or Real, any type). Jumping straight to "please
   register" without explaining the value of trading and without mentioning
   that lessons become available after opening an account is a common mistake
   to flag.
2. Always disclose risk and the available trading types clearly, without ever
   promising or guaranteeing profit or downplaying risk.
3. The model "smart" reply: a warm greeting matching the customer's real intent
   -> a simple explanation of trading's value -> mentioning courses unlock
   after opening an account -> mentioning risk with no profit promise -> one
   follow-up question that reveals the customer's goal.`,
    discovery_playbook_ar: [
      "ابدأ بتحية دافئة تسأل عن هدف العميل الحقيقي، لا برسالة تسجيل جاهزة.",
      "اسأل: هل تبحث عن تعلّم التداول، أم البدء بالتداول مباشرة، أم فتح حساب فقط؟",
      "اسأل عن خبرته السابقة بالتداول (مبتدئ/له تجربة) لتخصيص الشرح.",
      "اشرح أن الدروس والمواد التعليمية متاحة داخل المنصة بعد فتح حساب (تجريبي أو حقيقي).",
      "اذكر المخاطر وأنواع التداول المتاحة بوضوح، بدون أي وعد أو ضمان أرباح.",
      "اختم بسؤال متابعة يبني الحوار (مثال: أي الأسواق يهمّك أكثر؟) لا برابط تسجيل فقط.",
    ],
    discovery_playbook_en: [
      "Open with a warm greeting asking about the customer's real goal, not a canned registration message.",
      "Ask: are they looking to learn trading, start trading right away, or just open an account?",
      "Ask about their prior trading experience to tailor the explanation.",
      "Explain that lessons are available inside the platform after opening an account.",
      "Clearly mention risk and the available trading types, with no promise of profit.",
      "Close with a follow-up question that keeps the conversation going.",
    ],
    compliance_intro_ar: `تنبيه جوهري: وجود كلمة ما ليس مخالفة بحد ذاته. «الأرباح غير مضمونة» ليست
وعداً بربح رغم أنها تحتوي الكلمتين نفسيهما، و«قد يرتفع الذهب وقد ينخفض» ليست
يقيناً زائفاً. سجّل المخالفة فقط عند وجود اقتباس حرفي من رسالة الموظف يثبتها.`,
    compliance_intro_en: `Important: the presence of a word is not a violation. "Profits are not
guaranteed" is not a promise of profit even though it contains the same words,
and "gold may rise or fall" is not false certainty. Record a finding only when
you can quote the agent's own message as evidence.`,
  },

  // The 18 types verbatim, with their original default severities.
  issue_types: [
    { key: "risk_disclosure_missing", default_severity: "major", ar: "لم يُذكر خطر التداول في سياق يستوجبه", en: "Risk not disclosed where required" },
    { key: "guaranteed_profit", default_severity: "critical", ar: "وعد بربح مضمون", en: "Guaranteed-profit promise" },
    { key: "no_risk_claim", default_severity: "critical", ar: "ادّعاء أن التداول بلا مخاطر", en: "Claim that trading carries no risk" },
    { key: "false_certainty", default_severity: "major", ar: "يقين زائف باتجاه السوق", en: "False certainty about market direction" },
    { key: "misleading_urgency", default_severity: "moderate", ar: "استعجال أو ضغط مُصطنع", en: "Misleading urgency or pressure" },
    { key: "harmful_funding_advice", default_severity: "critical", ar: "تشجيع على تمويل ضار (قرض/مال أساسي)", en: "Encouraging harmful funding" },
    { key: "regulatory_misrepresentation", default_severity: "critical", ar: "معلومة غير صحيحة عن الترخيص أو التنظيم", en: "Incorrect licensing or regulatory claim" },
    { key: "unauthorized_advice", default_severity: "major", ar: "نصيحة مالية شخصية غير مصرّح بها", en: "Unauthorized personal financial advice" },
    { key: "incorrect_fees", default_severity: "major", ar: "معلومة خاطئة عن الرسوم أو شروط التداول", en: "Incorrect fee or trading-condition information" },
    { key: "misleading_leverage", default_severity: "major", ar: "شرح مضلّل للرفع المالي", en: "Misleading leverage explanation" },
    { key: "misused_testimonials", default_severity: "moderate", ar: "استخدام نتائج سابقة كضمان للمستقبل", en: "Past results presented as guaranteed future results" },
    { key: "ignored_objection", default_severity: "moderate", ar: "تجاهل اعتراضاً جوهرياً للعميل", en: "Ignored a material customer objection" },
    { key: "unanswered_question", default_severity: "moderate", ar: "أُغلقت المحادثة وسؤال العميل بلا جواب", en: "Conversation left with an unanswered question" },
    { key: "wrong_classification", default_severity: "moderate", ar: "تصنيف خاطئ لحالة العميل", en: "Incorrect customer classification" },
    { key: "premature_link", default_severity: "minor", ar: "أرسل رابط التسجيل قبل فهم حاجة العميل", en: "Sent the registration link before understanding the need" },
    { key: "generic_reply", default_severity: "minor", ar: "رد قالبي مع توفّر سياق كافٍ", en: "Generic reply despite available context" },
    { key: "repeated_question", default_severity: "minor", ar: "أعاد سؤالاً أجاب عنه العميل", en: "Repeated a question the customer already answered" },
    { key: "unclear_wording", default_severity: "informational", ar: "صياغة غير واضحة", en: "Unclear wording" },
  ],

  customer_risk_flags: [
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
  ],

  sales_patterns: [
    { key: "premature_registration_push", ar: "قفز لطلب التسجيل دون شرح القيمة", en: "Jumped to registration without explaining value" },
    { key: "ignored_customer_question", ar: "تجاهل سؤال صريح من العميل", en: "Ignored an explicit customer question" },
    { key: "no_risk_or_education_framing", ar: "لم يُذكر المخاطر أو أن الدروس تُفتح بعد الحساب", en: "Did not mention risk or that lessons unlock after account opening" },
    { key: "slow_follow_up", ar: "تأخّر واضح بعد إشارة اهتمام", en: "Slow follow-up after a clear interest signal" },
    { key: "generic_unpersonalized_reply", ar: "رد عام قالبي متجاهل لنيّة العميل", en: "Generic templated reply ignoring the customer's stated intent" },
    { key: "no_discovery_questions", ar: "لم يُسأل عن هدف العميل الحقيقي", en: "Never asked what the customer actually wants" },
    { key: "other", ar: "أخرى", en: "Other" },
  ],

  // The 17 milestones verbatim. real_progress is the inversion of the old
  // SHALLOW_STEPS set, stated positively.
  next_steps: [
    { key: "info_requested", ar: "طلب معلومات", en: "Information requested", real_progress: false },
    { key: "callback_requested", ar: "طلب معاودة الاتصال", en: "Callback requested", real_progress: true },
    { key: "callback_scheduled", ar: "حُدِّد موعد للاتصال", en: "Callback scheduled", real_progress: true },
    { key: "demo_requested", ar: "طلب حساباً تجريبياً", en: "Demo requested", real_progress: true },
    { key: "demo_opened", ar: "فتح حساباً تجريبياً", en: "Demo opened", real_progress: true },
    { key: "registration_started", ar: "بدأ التسجيل", en: "Registration started", real_progress: true },
    { key: "registration_completed", ar: "أكمل التسجيل", en: "Registration completed", real_progress: true, counts_as_registration: true },
    { key: "verification_started", ar: "بدأ التحقّق", en: "Verification started", real_progress: true },
    { key: "verification_completed", ar: "أكمل التحقّق", en: "Verification completed", real_progress: true },
    { key: "live_account_requested", ar: "طلب حساباً حقيقياً", en: "Live account requested", real_progress: true },
    { key: "deposit_question", ar: "سأل عن الإيداع", en: "Asked about depositing", real_progress: true },
    { key: "deposit_intent", ar: "أبدى نيّة الإيداع", en: "Deposit intent", real_progress: true },
    { key: "deposit_completed", ar: "أتمّ الإيداع", en: "Deposit completed", real_progress: true, counts_as_conversion: true },
    { key: "follow_up_scheduled", ar: "متابعة مجدولة", en: "Follow-up scheduled", real_progress: true },
    { key: "transferred", ar: "حُوِّل لقسم آخر", en: "Transferred", real_progress: true },
    { key: "closed_not_interested", ar: "أُغلق — غير مهتم", en: "Closed — not interested", real_progress: false },
    { key: "closed_not_qualified", ar: "أُغلق — غير مؤهّل", en: "Closed — not qualified", real_progress: false },
  ],

  lifecycle: {
    // STAGE_MAP's aliases and STAGE_WEIGHT's numbers, verbatim. The "deal won"
    // alias is load-bearing: score.js documents it as a real production bug.
    stages: [
      { key: "new", ar: "جديد", en: "New", weight: 5, aliases: ["new lead", "new"] },
      { key: "engaged", ar: "متفاعل", en: "Engaged", weight: 15, aliases: ["engaged", "deal lost", "contacted"] },
      { key: "interested", ar: "مهتم", en: "Interested", weight: 30, aliases: ["interested", "proposal sent"] },
      { key: "demo", ar: "تجريبي", en: "Demo", weight: 25, aliases: ["demo", "demo account"], counts_as_qualified: true },
      { key: "qualified", ar: "مؤهّل", en: "Qualified", weight: 35, aliases: ["qualified"], counts_as_qualified: true },
      { key: "deposit", ar: "مُودِع", en: "Deposited", weight: 50, aliases: ["deal won", "deposit", "funded"],
        counts_as_qualified: true, counts_as_converted: true },
    ],
    conversion_noun_ar: "إيداع", conversion_noun_en: "Deposit",
    trial_noun_ar: "تجريبي", trial_noun_en: "Demo",
  },

  kb_categories: [
    { key: "deposit", ar: "الإيداع", en: "Deposit" },
    { key: "withdrawal", ar: "السحب", en: "Withdrawal" },
    { key: "account", ar: "الحساب", en: "Account" },
    { key: "risk", ar: "المخاطر", en: "Risk" },
    { key: "fees", ar: "الرسوم", en: "Fees" },
    { key: "platform", ar: "المنصّة", en: "Platform" },
    { key: "regulation", ar: "التنظيم", en: "Regulation" },
    { key: "general", ar: "عام", en: "General" },
  ],
};

export default BROKERAGE_PROFILE;
