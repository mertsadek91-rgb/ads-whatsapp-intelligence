// The profile a fresh installation starts with.
//
// Deliberately under-specified. It is the fallback when AI generation is
// skipped or fails, and a seed that guesses at an industry it knows nothing
// about is worse than one that admits it knows nothing: a wrong tag is
// indistinguishable from a right one once it is in the database, whereas a
// missing tag is visibly missing.
//
// So: no company facts at all, the ten universal conversation-quality issue
// types and nothing domain-specific, a generic lifecycle, and roughly seventy
// tags — almost all of them `rule` (computed exactly) rather than `ai`.
import { CORE_ISSUE_TYPES } from "../lib/profileSchema.js";

export const GENERIC_PROFILE = {
  schema_version: "bp-1",
  language: "ar",

  identity: {
    company_name: "",
    what_we_sell: "شركة تبيع منتجات أو خدمات وتتلقّى استفسارات العملاء عبر واتساب من حملات إعلانية.",
    industry_key: "general",
    audience: "",
    restricted_markets: [],
    facts: [],   // never invent a regulatory claim for a business we know nothing about
    facts_rules_ar: "",
    facts_rules_en: "",
  },

  rules: {
    business_rules_ar: `قواعد عامة يجب مراعاتها عند تقييم الموظف:
1. يجب فهم ما يريده العميل فعلاً قبل عرض الحل أو طلب خطوة تالية.
2. لا يجوز الوعد بنتيجة لا يمكن ضمانها، ولا الضغط على العميل باستعجال مصطنع.
3. أي سؤال صريح من العميل يجب أن يُجاب قبل إغلاق المحادثة.
4. الرد النموذجي: تحية تناسب نيّة العميل ← فهم حاجته بسؤال ← شرح ما يناسبه ←
   خطوة تالية واضحة ← سؤال متابعة يُبقي الحوار مفتوحاً.`,
    business_rules_en: `General rules to apply when evaluating an agent:
1. Understand what the customer actually wants before pitching or asking for a next step.
2. Never promise an outcome that cannot be guaranteed, and never manufacture urgency.
3. Any explicit customer question must be answered before the conversation is closed.
4. The model reply: a greeting matching the customer's intent -> one question that
   uncovers the need -> an explanation fitted to it -> a clear next step -> a
   follow-up question that keeps the conversation open.`,
    discovery_playbook_ar: [
      "ابدأ بتحية تسأل عن هدف العميل الحقيقي، لا برسالة عرض جاهزة.",
      "اسأل سؤالاً واحداً يكشف حاجته قبل أن تعرض أي شيء.",
      "اشرح ما يناسب حاجته تحديداً، لا كل ما لديك.",
      "اذكر الحدود بوضوح: ما تشمله الخدمة وما لا تشمله.",
      "اختم بخطوة تالية محدَّدة وسؤال متابعة.",
    ],
    discovery_playbook_en: [
      "Open by asking what the customer is actually trying to achieve, not with a canned pitch.",
      "Ask one question that uncovers the need before offering anything.",
      "Explain what fits that need specifically, not everything you offer.",
      "State the limits plainly: what the service covers and what it does not.",
      "Close with a specific next step and a follow-up question.",
    ],
    compliance_intro_ar: `تنبيه جوهري: وجود كلمة ما ليس مخالفة بحد ذاته. «لا نضمن النتيجة» ليست
وعداً بنتيجة رغم أنها تحتوي الكلمتين نفسيهما، و«كثير من عملائنا ارتاحوا» ليست
ضماناً. سجّل المخالفة فقط عند وجود اقتباس حرفي من رسالة الموظف يثبتها.`,
    compliance_intro_en: `Important: the presence of a word is not a violation. "We cannot guarantee
the outcome" is not a promise of an outcome even though it contains the same
words, and "many of our customers were happy" is not a guarantee. Record a
finding only when you can quote the agent's own message as evidence.`,
  },

  // Only the universal ten. Industry-specific types are what generation adds.
  issue_types: CORE_ISSUE_TYPES.map((t) => ({ ...t, core: true })),

  customer_risk_flags: [
    { key: "unrealistic_expectations", ar: "توقّعات غير واقعية", en: "Unrealistic expectations" },
    { key: "wants_guarantee", ar: "يطلب ضماناً قاطعاً", en: "Wants an absolute guarantee" },
    { key: "financial_distress", ar: "يذكر ضيقاً مالياً", en: "Mentions financial distress" },
    { key: "does_not_understand_offer", ar: "لا يفهم طبيعة الخدمة", en: "Does not understand what is offered" },
    { key: "impulsive", ar: "سلوك متهوّر", en: "Impulsive behaviour" },
  ],

  sales_patterns: [
    { key: "premature_pitch", ar: "عرض الحل قبل فهم الحاجة", en: "Pitched before understanding the need" },
    { key: "ignored_customer_question", ar: "تجاهل سؤالاً صريحاً من العميل", en: "Ignored an explicit customer question" },
    { key: "no_limits_stated", ar: "لم يوضّح حدود الخدمة", en: "Did not state the limits of the service" },
    { key: "slow_follow_up", ar: "تأخّر واضح بعد إشارة اهتمام", en: "Slow follow-up after a clear interest signal" },
    { key: "generic_unpersonalized_reply", ar: "رد عام قالبي متجاهل لنيّة العميل", en: "Generic templated reply ignoring stated intent" },
    { key: "no_discovery_questions", ar: "لم يُسأل عن هدف العميل الحقيقي", en: "Never asked what the customer actually wants" },
    { key: "other", ar: "أخرى", en: "Other" },
  ],

  next_steps: [
    { key: "info_requested", ar: "طلب معلومات", en: "Information requested", real_progress: false },
    { key: "callback_requested", ar: "طلب معاودة الاتصال", en: "Callback requested", real_progress: true },
    { key: "callback_scheduled", ar: "حُدِّد موعد للاتصال", en: "Callback scheduled", real_progress: true },
    { key: "trial_requested", ar: "طلب تجربة", en: "Trial requested", real_progress: true },
    { key: "quote_requested", ar: "طلب عرض سعر", en: "Quote requested", real_progress: true },
    { key: "meeting_scheduled", ar: "حُجز موعد", en: "Meeting scheduled", real_progress: true, counts_as_registration: true },
    { key: "registration_completed", ar: "أكمل التسجيل", en: "Registration completed", real_progress: true, counts_as_registration: true },
    { key: "purchase_intent", ar: "أبدى نيّة الشراء", en: "Purchase intent", real_progress: true },
    { key: "purchase_completed", ar: "أتمّ الشراء", en: "Purchase completed", real_progress: true, counts_as_conversion: true },
    { key: "follow_up_scheduled", ar: "متابعة مجدولة", en: "Follow-up scheduled", real_progress: true },
    { key: "transferred", ar: "حُوِّل لقسم آخر", en: "Transferred", real_progress: true },
    { key: "closed_not_interested", ar: "أُغلق — غير مهتم", en: "Closed — not interested", real_progress: false },
    { key: "closed_not_qualified", ar: "أُغلق — غير مؤهّل", en: "Closed — not qualified", real_progress: false },
  ],

  lifecycle: {
    // Same weights the forex build used, renamed to neutral stages so the
    // scoring behaves identically out of the box.
    stages: [
      { key: "new", ar: "جديد", en: "New", weight: 5, aliases: ["new lead", "new"] },
      { key: "engaged", ar: "متفاعل", en: "Engaged", weight: 15, aliases: ["engaged", "contacted"] },
      { key: "interested", ar: "مهتم", en: "Interested", weight: 30, aliases: ["interested", "proposal sent"] },
      { key: "qualified", ar: "مؤهّل", en: "Qualified", weight: 35, aliases: ["qualified"], counts_as_qualified: true },
      { key: "trial", ar: "تجربة", en: "Trial", weight: 25, aliases: ["trial", "demo"], counts_as_qualified: true },
      { key: "customer", ar: "عميل", en: "Customer", weight: 50, aliases: ["deal won", "won", "customer", "client"],
        counts_as_qualified: true, counts_as_converted: true },
    ],
    conversion_noun_ar: "عملية شراء", conversion_noun_en: "Purchase",
    trial_noun_ar: "تجربة", trial_noun_en: "Trial",
  },

  tags: {
    categories: [
      {
        key: "geo_country", source: "rule", dept: "auto", platform: "",
        name_ar: "الدولة", name_en: "Country", exclusive: "all",
        why_ar: "محسوبة من مفتاح الهاتف الدولي بدقّة — لا تُخمَّن.",
        tags: [], // filled from the country data at runtime by tagRules
      },
      {
        key: "engagement", source: "rule", dept: "auto", platform: "",
        name_ar: "التفاعل", name_en: "Engagement", exclusive: "all",
        why_ar: "محسوبة من عدد الرسائل وتوقيتاتها.",
        tags: [
          ["ENG_HOT", "Hot", "ساخن"],
          ["ENG_WARM", "Warm", "دافئ"],
          ["ENG_COLD", "Cold", "بارد"],
          ["ENG_NO_REPLY_48H", "No reply 48h", "بلا رد 48 ساعة"],
          ["ENG_OPTED_OUT", "Opted out", "طلب إيقاف الرسائل"],
          ["ENG_DO_NOT_WHATSAPP", "Do not WhatsApp", "ممنوع مراسلته"],
        ],
      },
      {
        key: "intent", source: "ai", dept: "sales", platform: "",
        name_ar: "نيّة العميل", name_en: "Customer intent", exclusive: "all",
        why_ar: "تظهر في المحادثة نفسها ولا مكان آخر.",
        tags: [
          ["INTENT_PRICE", "Asking about price", "يسأل عن السعر"],
          ["INTENT_BUY", "Wants to buy", "يريد الشراء"],
          ["INTENT_BOOK", "Wants to book", "يريد حجز موعد"],
          ["INTENT_LEARN", "Wants to learn", "يريد المعرفة فقط"],
          ["INTENT_SUPPORT", "Existing customer support", "عميل حالي يطلب دعماً"],
          ["INTENT_COMPARE", "Comparing options", "يقارن بين خيارات"],
          ["INTENT_UNCLEAR", "Unclear", "غير واضح"],
        ],
      },
      {
        key: "objection", source: "ai", dept: "sales", platform: "",
        name_ar: "الاعتراض", name_en: "Objection", exclusive: null,
        why_ar: "ما قاله العميل صراحةً كسبب للتردّد.",
        tags: [
          ["OBJ_PRICE", "Too expensive", "السعر مرتفع"],
          ["OBJ_TIMING", "Not the right time", "التوقيت غير مناسب"],
          ["OBJ_TRUST", "Trust concerns", "عدم ثقة"],
          ["OBJ_NEED_APPROVAL", "Needs someone else to decide", "يحتاج موافقة طرف آخر"],
          ["OBJ_COMPETITOR", "Considering a competitor", "يفاضل مع منافس"],
          ["OBJ_NO_NEED", "No real need", "لا حاجة فعلية"],
        ],
      },
      {
        key: "loss_reason", source: "ai", dept: "sales", platform: "",
        name_ar: "سبب الانصراف", name_en: "Loss reason", exclusive: "all",
        why_ar: "يُستنتج من نهاية المحادثة.",
        tags: [
          ["LOST_PRICE", "Lost on price", "انصرف بسبب السعر"],
          ["LOST_NO_REPLY", "Went quiet", "توقّف عن الرد"],
          ["LOST_COMPETITOR", "Chose a competitor", "اختار منافساً"],
          ["LOST_NOT_QUALIFIED", "Not a fit", "غير مناسب للخدمة"],
          ["LOST_SERVICE", "Poor experience", "تجربة سيّئة"],
        ],
      },
      {
        key: "experience", source: "ai", dept: "sales", platform: "",
        name_ar: "مستوى المعرفة", name_en: "Familiarity", exclusive: "all",
        why_ar: "يظهر من أسئلة العميل ومفرداته.",
        tags: [
          ["EXP_NEW", "New to this", "جديد تماماً"],
          ["EXP_SOME", "Has some experience", "لديه خبرة جزئية"],
          ["EXP_EXPERT", "Well informed", "مطّلع جيداً"],
        ],
      },
      {
        key: "account_state", source: "external", dept: "ops", platform: "Your CRM or billing system",
        name_ar: "حالة الحساب", name_en: "Account state", exclusive: "all",
        why_ar: "الحقيقة في نظام آخر (فوترة أو CRM) ولا يمكن معرفتها من محادثة واتساب.",
        tags: [
          ["ACC_NONE", "No account", "لا يوجد حساب"],
          ["ACC_REGISTERED", "Registered", "مسجَّل"],
          ["ACC_PAID", "Paying customer", "عميل دافع"],
          ["ACC_CHURNED", "Churned", "مُغادِر"],
        ],
      },
    ],
  },

  kb_categories: [
    { key: "pricing", ar: "الأسعار", en: "Pricing" },
    { key: "product", ar: "المنتج أو الخدمة", en: "Product or service" },
    { key: "process", ar: "الإجراءات", en: "Process" },
    { key: "support", ar: "الدعم", en: "Support" },
    { key: "policy", ar: "السياسات", en: "Policy" },
    { key: "general", ar: "عام", en: "General" },
  ],

  // Today's numbers exactly, so scoring behaves identically out of the box.
  scoring: {
    weights: { persuasion: 30, conversion: 25, compliance: 20, productivity: 15, response: 10 },
    conversion_weights: { next_step: 0.6, registration: 0.25, conversion: 0.15 },
    lead_score: { converted_bonus: 20, human_engaged: 15, bot_only_cap: 40, hot_at: 70, warm_at: 45 },
  },

  calibration_cases: [],
  retired: { issue_types: [], tags: [], next_steps: [] },
};

export default GENERIC_PROFILE;
