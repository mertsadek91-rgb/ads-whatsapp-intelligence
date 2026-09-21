// The IST Markets Wati tag taxonomy — 35 categories, 294 tags, transcribed from
// the owner's cheat sheet so this file is the one place the vocabulary lives.
//
// The important thing here is NOT the list, it is the `source` on every
// category. A tag is only as good as the system that knows the answer:
//
//   external — the truth lives in the trading platform, the compliance system
//              or the partner CRM. Deposit size, KYC state, lot volume, a
//              signed contract: none of it is visible in a WhatsApp thread. The
//              AI must never assign these. A guessed DEP_USD_25K_50K on a
//              customer who deposited nothing would corrupt every report built
//              on top of it, and would be indistinguishable from a real one.
//   rule     — we already hold the answer and can compute it exactly: country
//              from the phone dial code, channel from the ad the lead came
//              from, "no reply for 48h" from the message timestamps. Paying an
//              AI to guess what we can derive would be both slower and wrong
//              more often.
//   ai       — genuinely lives in the conversation and nowhere else: what the
//              customer wants, what they trade, how experienced they sound,
//              what they objected to, why they walked away.
//
// That split is why the AI is given ~110 tags out of 294 and not the whole
// sheet. Coverage is not the goal; being right is.
//
// Tag codes are verbatim from the sheet (including the odd `%PCT` suffix) so a
// tag written back to Wati one day matches the tag Wati already expects.

/** Who owns the truth for a category. */
export const SOURCES = {
  ai: { ar: "يُستنتج من المحادثة بالذكاء الاصطناعي", en: "Inferred from the conversation by AI" },
  rule: { ar: "محسوب بدقّة من بياناتنا", en: "Computed exactly from data we hold" },
  external: { ar: "مصدره نظام آخر — لا يُخمَّن", en: "Owned by another system — never guessed" },
};

export const DEPARTMENTS = {
  auto: { ar: "آلي", en: "Automated" },
  mkt: { ar: "تسويق", en: "Marketing" },
  sales: { ar: "مبيعات", en: "Sales" },
  comp: { ar: "التزام", en: "Compliance" },
  ops: { ar: "تشغيل / شراكات", en: "Ops / Partners" },
};

// Each category: key, bilingual name, department, the platform that sets it in
// Wati, who owns the truth here, and `exclusive` — groups of tags where at most
// one can be true at a time, which is what stops the AI stacking EXP_BEGINNER
// and EXP_PRO on the same customer.
export const CATEGORIES = [
  {
    key: "stage_lifecycle", dept: "auto", platform: "Trading Platform", source: "external",
    name_ar: "مرحلة العميل — دورة الحياة", name_en: "Lead Stage — Lifecycle",
    why_ar: "حالة الحساب على منصّة التداول، لا يمكن معرفتها من محادثة واتساب.",
    exclusive: "all",
    tags: [
      ["STG_NEW", "New Lead", "ليد جديد"],
      ["STG_DEMO_OPENED", "Demo Opened", "فتح حساباً تجريبياً"],
      ["STG_LIVE_ACCOUNT_OPENED", "Live Account Opened", "فتح حساباً حقيقياً"],
      ["STG_KYC_PENDING", "KYC Pending", "التحقّق من الهوية معلّق"],
      ["STG_KYC_SUBMITTED", "KYC Submitted", "قدّم مستندات التحقّق"],
      ["STG_KYC_VERIFIED", "KYC Verified ✅", "تم التحقّق من هويته ✅"],
      ["STG_KYC_REJECTED", "KYC Rejected ❌", "رُفض التحقّق من هويته ❌"],
      ["STG_DEPOSIT_PENDING", "Deposit Pending", "إيداع معلّق"],
      ["STG_FUNDED", "Funded 💰", "مُموَّل 💰"],
      ["STG_FIRST_TRADE_DONE", "First Trade Done", "نفّذ أول صفقة"],
      ["STG_ACTIVE_TRADER", "Active Trader", "متداول نشط"],
      ["STG_DORMANT", "Dormant", "خامل"],
      ["STG_CHURNED", "Churned", "مُغادِر"],
    ],
  },
  {
    key: "trading_activity", dept: "auto", platform: "Trading Platform", source: "external",
    name_ar: "نشاط التداول", name_en: "Trading Activity",
    why_ar: "سلوك تداول فعلي يُزامَن يومياً من المنصّة.",
    tags: [
      ["TRD_ACTIVE_7D", "Active (7 Days)", "نشط خلال 7 أيام"],
      ["TRD_ACTIVE_30D", "Active (30 Days)", "نشط خلال 30 يوماً"],
      ["TRD_INACTIVE_30D", "Inactive (30 Days)", "غير نشط 30 يوماً"],
      ["TRD_INACTIVE_90D", "Inactive (90 Days)", "غير نشط 90 يوماً"],
      ["TRD_HIGH_VOLUME", "High Volume", "حجم تداول مرتفع"],
      ["TRD_LOW_VOLUME", "Low Volume", "حجم تداول منخفض"],
      ["TRD_PROFITABLE_30D", "Profitable (30 Days)", "رابح خلال 30 يوماً"],
      ["TRD_LOSS_MAKING_30D", "Loss-Making (30 Days)", "خاسر خلال 30 يوماً"],
    ],
  },
  {
    key: "account_type", dept: "auto", platform: "Trading Platform", source: "external",
    name_ar: "نوع الحساب", name_en: "Account Type",
    why_ar: "نوع الحساب المفتوح فعلاً على المنصّة (ما يطلبه العميل في المحادثة يُسجَّل كنيّة لا كحساب).",
    tags: [
      ["ACC_DEMO", "Demo Account", "حساب تجريبي"],
      ["ACC_LIVE_STANDARD", "Live Standard", "حقيقي ستاندرد"],
      ["ACC_LIVE_ECN", "Live ECN", "حقيقي ECN"],
      ["ACC_LIVE_CENT", "Live Cent", "حقيقي سنت"],
      ["ACC_LIVE_ZERO_SPREAD", "Live Zero Spread", "حقيقي بفارق صفري"],
      ["ACC_ISLAMIC_SWAP_FREE", "Islamic / Swap-Free", "إسلامي بلا فوائد"],
      ["ACC_COPY_TRADING", "Copy Trading", "نسخ صفقات"],
      ["ACC_MANAGED_ACCOUNT", "Managed Account", "حساب مُدار"],
      ["ACC_VIP", "VIP Account", "حساب VIP"],
    ],
  },
  {
    key: "deposit_tier", dept: "auto", platform: "Trading Platform", source: "external",
    name_ar: "شريحة الإيداع", name_en: "Deposit Tier",
    why_ar: "مبلغ إيداع حقيقي. ما يَذكره العميل في المحادثة نيّة إيداع لا إيداعاً.",
    exclusive: "all",
    tags: [
      ["DEP_USD_LT_250", "< $250", "أقل من 250$"],
      ["DEP_USD_250_500", "$250–500", "250$ – 500$"],
      ["DEP_USD_500_1K", "$500–1K", "500$ – 1000$"],
      ["DEP_USD_1K_2K", "$1K–2K", "1000$ – 2000$"],
      ["DEP_USD_2K_5K", "$2K–5K", "2000$ – 5000$"],
      ["DEP_USD_5K_10K", "$5K–10K", "5000$ – 10 آلاف$"],
      ["DEP_USD_10K_25K", "$10K–25K", "10 – 25 ألف$"],
      ["DEP_USD_25K_50K", "$25K–50K", "25 – 50 ألف$"],
      ["DEP_USD_50K_100K", "$50K–100K", "50 – 100 ألف$"],
      ["DEP_USD_GT_100K", "> $100K", "أكثر من 100 ألف$"],
    ],
  },
  {
    key: "engagement_time", dept: "auto", platform: "Wati Automation", source: "rule",
    name_ar: "التفاعل — تسلسل زمني", name_en: "Engagement — Time-Based",
    why_ar: "نحسبها من أوقات الرسائل المحفوظة لدينا؛ لا حاجة لذكاء اصطناعي.",
    // OPTED_OUT / SPAM come from what the customer SAID, so the AI owns those two.
    ai_only: ["ENG_OPTED_OUT", "ENG_SPAM"],
    tags: [
      ["ENG_NO_REPLY_24H", "No Reply — 24h", "لا ردّ منذ 24 ساعة"],
      ["ENG_NO_REPLY_48H", "No Reply — 48h", "لا ردّ منذ 48 ساعة"],
      ["ENG_NO_REPLY_7D", "No Reply — 7 Days", "لا ردّ منذ 7 أيام"],
      ["ENG_OPTED_OUT", "Opted Out", "طلب إيقاف التواصل"],
      ["ENG_INVALID_NUMBER", "Invalid Number", "رقم غير صالح"],
      ["ENG_SPAM", "Spam", "رسائل مزعجة"],
    ],
  },
  {
    key: "geo_country", dept: "auto", platform: "Registration Form", source: "rule",
    name_ar: "الدولة", name_en: "GEO — Country",
    why_ar: "مشتقّة من مقدّمة رقم الهاتف — دقيقة ومجانية.",
    exclusive: "all",
    tags: [
      ["GEO_UAE", "UAE", "الإمارات"], ["GEO_KSA", "Saudi Arabia", "السعودية"],
      ["GEO_KUW", "Kuwait", "الكويت"], ["GEO_QAT", "Qatar", "قطر"],
      ["GEO_OM", "Oman", "عُمان"], ["GEO_BAH", "Bahrain", "البحرين"],
      ["GEO_JOR", "Jordan", "الأردن"], ["GEO_EG", "Egypt", "مصر"],
      ["GEO_MOR", "Morocco", "المغرب"], ["GEO_TUR", "Turkey", "تركيا"],
      ["GEO_IND", "India", "الهند"], ["GEO_PAK", "Pakistan", "باكستان"],
      ["GEO_BGD", "Bangladesh", "بنغلاديش"], ["GEO_LKA", "Sri Lanka", "سريلانكا"],
      ["GEO_NGR", "Nigeria", "نيجيريا"], ["GEO_GHN", "Ghana", "غانا"],
      ["GEO_KEN", "Kenya", "كينيا"], ["GEO_RSA", "South Africa", "جنوب أفريقيا"],
      ["GEO_RUS", "Russia", "روسيا"], ["GEO_UK", "UK", "بريطانيا"],
      ["GEO_USA", "USA", "الولايات المتحدة"], ["GEO_CAN", "Canada", "كندا"],
      ["GEO_AUS", "Australia", "أستراليا"], ["GEO_NZL", "New Zealand", "نيوزيلندا"],
      // --- ADDED BEYOND THE OWNER'S SHEET ---
      // The sheet defines 24 countries; our leads come from more. Algeria alone
      // is 780 contacts, Iraq 664, Yemen 365 — between them more leads than most
      // of the countries the sheet DOES cover. Every country the phone map can
      // identify now has a tag, so no lead is left with a region and no country.
      // These codes do not exist in Wati yet: creating them there is the owner's
      // call, and `addedBeyondSheet` marks them so that stays visible.
      ["GEO_DZA", "Algeria", "الجزائر"], ["GEO_IRQ", "Iraq", "العراق"],
      ["GEO_YEM", "Yemen", "اليمن"], ["GEO_SDN", "Sudan", "السودان"],
      ["GEO_TUN", "Tunisia", "تونس"], ["GEO_LBY", "Libya", "ليبيا"],
      ["GEO_LBN", "Lebanon", "لبنان"], ["GEO_SYR", "Syria", "سوريا"],
      ["GEO_PSE", "Palestine", "فلسطين"], ["GEO_MRT", "Mauritania", "موريتانيا"],
      ["GEO_SOM", "Somalia", "الصومال"], ["GEO_DJI", "Djibouti", "جيبوتي"],
      ["GEO_COM", "Comoros", "جزر القمر"], ["GEO_IRN", "Iran", "إيران"],
      ["GEO_AFG", "Afghanistan", "أفغانستان"], ["GEO_MYS", "Malaysia", "ماليزيا"],
      ["GEO_IDN", "Indonesia", "إندونيسيا"], ["GEO_PHL", "Philippines", "الفلبين"],
      ["GEO_CHN", "China", "الصين"], ["GEO_FRA", "France", "فرنسا"],
      ["GEO_DEU", "Germany", "ألمانيا"], ["GEO_ITA", "Italy", "إيطاليا"],
      ["GEO_ESP", "Spain", "إسبانيا"],
    ],
    // Tags this app added on top of the cheat sheet, so the reference and the
    // page can say so plainly rather than implying Wati already knows them.
    addedBeyondSheet: [
      "GEO_DZA", "GEO_IRQ", "GEO_YEM", "GEO_SDN", "GEO_TUN", "GEO_LBY", "GEO_LBN",
      "GEO_SYR", "GEO_PSE", "GEO_MRT", "GEO_SOM", "GEO_DJI", "GEO_COM", "GEO_IRN",
      "GEO_AFG", "GEO_MYS", "GEO_IDN", "GEO_PHL", "GEO_CHN", "GEO_FRA", "GEO_DEU",
      "GEO_ITA", "GEO_ESP",
    ],
  },
  {
    key: "geo_region", dept: "auto", platform: "Registration Form", source: "rule",
    name_ar: "المنطقة", name_en: "GEO — Regions",
    why_ar: "مشتقّة من الدولة بقاعدة ثابتة.",
    exclusive: "all",
    tags: [
      ["GEO_R_GCC", "GCC", "دول الخليج"], ["GEO_R_MENA", "MENA", "الشرق الأوسط وشمال أفريقيا"],
      ["GEO_R_EU", "Europe", "أوروبا"], ["GEO_R_SOUTH_ASIA", "South Asia", "جنوب آسيا"],
      ["GEO_R_EAST_ASIA", "East Asia", "شرق آسيا"], ["GEO_R_SOUTHEAST_ASIA", "Southeast Asia", "جنوب شرق آسيا"],
      ["GEO_R_SUB_SAHARAN_AFRICA", "Sub-Saharan Africa", "أفريقيا جنوب الصحراء"],
      ["GEO_R_NORTH_AMERICA", "North America", "أمريكا الشمالية"],
      ["GEO_R_LATAM", "LATAM", "أمريكا اللاتينية"], ["GEO_R_UK_IE", "UK & Ireland", "بريطانيا وأيرلندا"],
      ["GEO_R_CIS", "CIS", "دول الكومنولث المستقلّة"],
    ],
  },
  {
    key: "language", dept: "auto", platform: "Registration Form", source: "rule",
    name_ar: "اللغة", name_en: "Language",
    why_ar: "نكشفها من حروف رسائل العميل نفسها — عربية أم لاتينية أم سيريلية…",
    exclusive: "all",
    tags: [
      ["LANG_AR", "Arabic", "العربية"], ["LANG_EN", "English", "الإنجليزية"],
      ["LANG_FR", "French", "الفرنسية"], ["LANG_HI", "Hindi", "الهندية"],
      ["LANG_UR", "Urdu", "الأردية"], ["LANG_RU", "Russian", "الروسية"],
      ["LANG_TR", "Turkish", "التركية"], ["LANG_ZH", "Chinese", "الصينية"],
    ],
  },
  {
    key: "mkt_channel", dept: "mkt", platform: "Marketing / UTM", source: "rule",
    name_ar: "قناة التسويق", name_en: "Marketing Channel",
    why_ar: "نعرفها من الإعلان الذي جاء منه العميل (source_ad_id) ومن منصّة النشر.",
    tags: [
      ["CH_FACEBOOK", "Facebook", "فيسبوك"], ["CH_INSTAGRAM", "Instagram", "إنستغرام"],
      ["CH_META", "Meta (FB+IG)", "ميتا (فيسبوك+إنستغرام)"], ["CH_GOOGLE", "Google", "جوجل"],
      ["CH_TIKTOK", "TikTok", "تيك توك"], ["CH_SNAPCHAT", "Snapchat", "سناب شات"],
      ["CH_YOUTUBE", "YouTube", "يوتيوب"], ["CH_X", "X (Twitter)", "إكس (تويتر)"],
      ["CH_LINKEDIN", "LinkedIn", "لينكد إن"], ["CH_TELEGRAM", "Telegram", "تيليجرام"],
      ["CH_WHATSAPP_INBOUND", "WhatsApp Inbound", "واتساب مباشر"], ["CH_WEBSITE", "Website", "الموقع"],
      ["CH_EMAIL", "Email", "بريد إلكتروني"], ["CH_REFERRAL", "Referral", "توصية"],
      ["CH_AFFILIATE_NETWORK", "Affiliate Network", "شبكة تسويق بالعمولة"],
    ],
  },
  {
    key: "mkt_campaign", dept: "mkt", platform: "Marketing / UTM", source: "rule",
    name_ar: "الحملة التسويقية", name_en: "Marketing Campaign",
    why_ar: "من اسم حملة ميتا المرتبطة بالإعلان.",
    tags: [
      ["CAMP_TRADER_ACQ", "Trader Acquisition", "استقطاب متداولين"],
      ["CAMP_TRADER_REACTIVATION", "Trader Reactivation", "إعادة تنشيط متداولين"],
      ["CAMP_TRADER_UPSELL", "Trader Upsell", "ترقية متداولين"],
      ["CAMP_IB_ACQ", "IB Acquisition", "استقطاب وسطاء معرّفين"],
      ["CAMP_IB_ONBOARDING", "IB Onboarding", "تهيئة وسطاء معرّفين"],
      ["CAMP_AFFILIATE_ACQ", "Affiliate Acquisition", "استقطاب مسوّقين بالعمولة"],
      ["CAMP_AFFILIATE_ONBOARDING", "Affiliate Onboarding", "تهيئة مسوّقين بالعمولة"],
    ],
  },
  {
    key: "audience_type", dept: "mkt", platform: "Marketing / UTM", source: "ai",
    name_ar: "نوع الجمهور", name_en: "Audience Type",
    why_ar: "يتّضح من المحادثة: هل يريد التداول لنفسه أم يريد شراكة/عمولة؟",
    exclusive: "all",
    tags: [
      ["AUD_TRADER", "Trader", "متداول"],
      ["AUD_IB", "Introducing Broker (IB)", "وسيط معرّف (IB)"],
      ["AUD_AFFILIATE", "Affiliate", "مسوّق بالعمولة"],
      ["AUD_INTRODUCER", "Introducer", "مُعرِّف"],
      ["AUD_MONEY_MANAGER", "Money Manager", "مدير أموال"],
      ["AUD_LEAD_GEN_AGENCY", "Lead Gen Agency", "وكالة توليد عملاء"],
    ],
  },
  {
    key: "stage_pipeline", dept: "sales", platform: "Sales Agent", source: "rule",
    name_ar: "مرحلة العميل — مسار المبيعات", name_en: "Lead Stage — Sales Pipeline",
    why_ar: "«تم التواصل» نعرفه من ردّ الموظف، و«مؤهّل» من درجة التأهيل التي يحسبها التقييم.",
    // Blacklisting is a human decision with consequences; the AI may not make it.
    manual_only: ["STG_BLACKLISTED"],
    tags: [
      ["STG_CONTACTED", "Contacted", "تم التواصل"],
      ["STG_QUALIFIED", "Qualified", "مؤهّل"],
      ["STG_REACTIVATION", "Reactivation Target", "هدف إعادة تنشيط"],
      ["STG_BLACKLISTED", "⛔ Blacklisted", "⛔ محظور"],
    ],
  },
  {
    key: "engagement_rating", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "تصنيف الحرارة", name_en: "Engagement Rating",
    why_ar: "حرارة العميل تُقرأ من لهجته واستعداده؛ وطلب عدم التواصل يُقال صراحةً.",
    exclusive: [["ENG_HOT", "ENG_WARM", "ENG_COLD"]],
    rule_only: ["ENG_CONTACTED", "ENG_RESPONDED"],
    tags: [
      ["ENG_HOT", "🔥 Hot", "🔥 ساخن"], ["ENG_WARM", "🌤 Warm", "🌤 فاتر"],
      ["ENG_COLD", "🧊 Cold", "🧊 بارد"], ["ENG_CONTACTED", "Contacted", "تم التواصل"],
      ["ENG_RESPONDED", "Responded", "ردّ"],
      ["ENG_DO_NOT_CALL", "Do Not Call", "لا تتّصل"],
      ["ENG_DO_NOT_EMAIL", "Do Not Email", "لا تُرسل بريداً"],
      ["ENG_DO_NOT_WHATSAPP", "Do Not WhatsApp", "لا تُرسل واتساب"],
    ],
  },
  {
    key: "intent", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "نيّة العميل", name_en: "Intent",
    why_ar: "هذا جوهر ما تكشفه المحادثة: ماذا يريد العميل بالضبط.",
    tags: [
      ["INTENT_OPEN_DEMO", "Open Demo Account", "فتح حساب تجريبي"],
      ["INTENT_OPEN_LIVE", "Open Live Account", "فتح حساب حقيقي"],
      ["INTENT_DEPOSIT", "Deposit / Fund", "إيداع وتمويل"],
      ["INTENT_ACCOUNT_UPGRADE", "Account Upgrade", "ترقية الحساب"],
      ["INTENT_COPY_TRADING", "Copy Trading", "نسخ الصفقات"],
      ["INTENT_BECOME_IB", "Become Introducing Broker", "أن يصبح وسيطاً معرّفاً"],
      ["INTENT_AFFILIATE", "Become Affiliate", "أن يصبح مسوّقاً بالعمولة"],
      ["INTENT_MONEY_MANAGER", "Become Money Manager", "أن يصبح مدير أموال"],
      ["INTENT_SIGNAL_SERVICE", "Signal Service", "خدمة التوصيات"],
      ["INTENT_SOCIAL_TRADING", "Social Trading", "التداول الاجتماعي"],
      ["INTENT_EDUCATION", "Education / Webinar", "تعليم ودورات"],
      ["INTENT_PLATFORM_HELP", "Platform Help", "مساعدة في المنصّة"],
      ["INTENT_SUPPORT", "General Support", "دعم عام"],
      ["INTENT_VIP_SERVICES", "VIP Services", "خدمات VIP"],
      ["INTENT_WITHDRAW", "Withdrawal", "سحب أموال"],
      ["INTENT_UNDECIDED", "Undecided", "غير محدّد"],
    ],
  },
  {
    key: "experience", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "خبرة التداول", name_en: "Trading Experience",
    why_ar: "تُقاس من مفرداته: من يسأل «ما هو الفوركس» مبتدئ، ومن يسأل عن السبريد والتنفيذ خبير.",
    exclusive: "all",
    tags: [
      ["EXP_BEGINNER", "Beginner", "مبتدئ"],
      ["EXP_INTERMEDIATE", "Intermediate", "متوسّط"],
      ["EXP_PRO", "Professional / Expert", "محترف / خبير"],
    ],
  },
  {
    key: "asset_class", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "الأصول المفضّلة", name_en: "Preferred Asset Class",
    why_ar: "يُذكر صراحةً عادةً: «أريد الذهب»، «مهتم بالعملات الرقمية».",
    tags: [
      ["ASSET_FX", "Forex (FX)", "العملات (فوركس)"], ["ASSET_GOLD", "Gold", "الذهب"],
      ["ASSET_SILVER", "Silver", "الفضة"], ["ASSET_METALS", "Metals", "المعادن"],
      ["ASSET_OIL", "Oil", "النفط"], ["ASSET_COMMODITIES", "Commodities", "السلع"],
      ["ASSET_CRYPTO", "Crypto", "العملات الرقمية"], ["ASSET_INDICES", "Indices", "المؤشرات"],
      ["ASSET_SHARES", "Shares / Stocks", "الأسهم"], ["ASSET_ETF", "ETFs", "صناديق المؤشرات"],
    ],
  },
  {
    key: "instruments", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "الأدوات المفضّلة", name_en: "Preferred Instruments",
    why_ar: "أدوات بعينها يسمّيها العميل في المحادثة.",
    tags: [
      ["INSTR_EURUSD", "EUR/USD", "يورو/دولار"], ["INSTR_GBPUSD", "GBP/USD", "إسترليني/دولار"],
      ["INSTR_USDJPY", "USD/JPY", "دولار/ين"], ["INSTR_XAUUSD", "XAU/USD (Gold)", "الذهب/دولار"],
      ["INSTR_XAGUSD", "XAG/USD (Silver)", "الفضة/دولار"], ["INSTR_BTCUSD", "BTC/USD", "بيتكوين/دولار"],
      ["INSTR_ETHUSD", "ETH/USD", "إيثريوم/دولار"], ["INSTR_NAS100", "NASDAQ 100", "ناسداك 100"],
      ["INSTR_US30", "Dow Jones (US30)", "داو جونز"], ["INSTR_SPX500", "S&P 500", "إس&بي 500"],
      ["INSTR_BRENT", "Brent Crude", "خام برنت"], ["INSTR_WTI", "WTI Crude Oil", "خام غرب تكساس"],
    ],
  },
  {
    key: "leverage", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "الرفع المالي المطلوب", name_en: "Leverage Preference",
    why_ar: "يُطلب رقماً صريحاً في المحادثة.",
    exclusive: "all",
    tags: [
      ["LEV_1_10", "1:10", "1:10"], ["LEV_1_20", "1:20", "1:20"],
      ["LEV_1_50", "1:50", "1:50"], ["LEV_1_100", "1:100", "1:100"],
      ["LEV_1_200", "1:200", "1:200"], ["LEV_1_300", "1:300", "1:300"],
      ["LEV_1_400", "1:400", "1:400"], ["LEV_1_500", "1:500", "1:500"],
    ],
  },
  {
    key: "risk_profile", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "شهيّة المخاطرة", name_en: "Risk Profile",
    why_ar: "تُستنتج من هدفه ومن رفعه المالي المطلوب ومن ردّه على تنبيه المخاطر.",
    exclusive: "all",
    tags: [
      ["RISK_LOW", "Low Risk", "مخاطرة منخفضة"], ["RISK_MEDIUM", "Medium Risk", "مخاطرة متوسّطة"],
      ["RISK_HIGH", "High Risk", "مخاطرة عالية"], ["RISK_VERY_HIGH", "Very High Risk", "مخاطرة عالية جداً"],
    ],
  },
  {
    key: "trader_segment", dept: "sales", platform: "Sales Agent", source: "rule",
    name_ar: "تصنيف الشريحة", name_en: "Trader Segment",
    why_ar: "تركيب آلي: نوع الجمهور + مستوى الخبرة. لا يُسأل عنه العميل.",
    exclusive: "all",
    tags: [
      ["SEG_TRADER_BEGINNER", "Trader — Beginner", "متداول — مبتدئ"],
      ["SEG_TRADER_INTERMEDIATE", "Trader — Intermediate", "متداول — متوسّط"],
      ["SEG_TRADER_PRO", "Trader — Pro", "متداول — محترف"],
      ["SEG_IB_BEGINNER", "IB — Beginner", "وسيط معرّف — مبتدئ"],
      ["SEG_IB_INTERMEDIATE", "IB — Intermediate", "وسيط معرّف — متوسّط"],
      ["SEG_IB_PRO", "IB — Pro", "وسيط معرّف — محترف"],
    ],
  },
  {
    key: "comm_prefs", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "تفضيلات التواصل", name_en: "Communication Preferences",
    why_ar: "«اتصل بي بعد المغرب» جملة تُقال في المحادثة.",
    exclusive: [["PREF_TIME_MORNING", "PREF_TIME_AFTERNOON", "PREF_TIME_EVENING"]],
    tags: [
      ["PREF_COMM_WHATSAPP", "Prefers WhatsApp", "يفضّل واتساب"],
      ["PREF_COMM_CALL", "Prefers Phone Call", "يفضّل الاتصال"],
      ["PREF_COMM_EMAIL", "Prefers Email", "يفضّل البريد"],
      ["PREF_TIME_MORNING", "Best: Morning", "الأفضل: صباحاً"],
      ["PREF_TIME_AFTERNOON", "Best: Afternoon", "الأفضل: بعد الظهر"],
      ["PREF_TIME_EVENING", "Best: Evening", "الأفضل: مساءً"],
    ],
  },
  {
    key: "service_interest", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "خط الخدمة المطلوب", name_en: "Service / Product Interest",
    why_ar: "أي خطوط IST Markets يسأل عنه.",
    tags: [
      ["SRV_RETAIL_TRADING", "Retail Trading", "تداول الأفراد"],
      ["SRV_IB_PARTNERS", "IB Partners", "شراكات الوسطاء"],
      ["SRV_AFFILIATES", "Affiliates", "التسويق بالعمولة"],
      ["SRV_MONEY_MANAGEMENT", "Money Management", "إدارة الأموال"],
      ["SRV_SUPPORT", "Support", "الدعم"],
    ],
  },
  {
    key: "platform_pref", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "المنصّة المفضّلة", name_en: "Platform Preference",
    why_ar: "يُسمّيها العميل: MT5، تطبيق الجوال، منصّة الويب…",
    tags: [
      ["PLAT_MT5", "MetaTrader 5 (MT5)", "ميتاتريدر 5"],
      ["PLAT_WEBTRADER", "Web Trader", "منصّة الويب"],
      ["PLAT_MOBILE_APP", "Mobile App", "تطبيق الجوال"],
      ["PLAT_COPY_TRADING_APP", "Copy Trading App", "تطبيق نسخ الصفقات"],
      ["PLAT_CRM_PORTAL", "Client Portal / CRM", "بوابة العميل"],
    ],
  },
  {
    key: "payment_method", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "طريقة الدفع", name_en: "Payment Method",
    why_ar: "يُسأل عنها ويُجاب عليها في المحادثة قبل الإيداع.",
    // Pre-approval is a payments/compliance decision, not something the chat proves.
    external_only: ["PAY_NEEDS_PREAPPROVAL", "PAY_PREAPPROVED"],
    tags: [
      ["PAY_BANK_TRANSFER", "Bank Transfer", "حوالة بنكية"],
      ["PAY_CARD", "Credit/Debit Card", "بطاقة"],
      ["PAY_CRYPTO", "Crypto", "عملات رقمية"],
      ["PAY_EWALLET", "E-Wallet", "محفظة إلكترونية"],
      ["PAY_APPLE_PAY", "Apple Pay", "أبل باي"],
      ["PAY_GOOGLE_PAY", "Google Pay", "جوجل باي"],
      ["PAY_NEEDS_PREAPPROVAL", "Needs Pre-Approval", "يحتاج موافقة مسبقة"],
      ["PAY_PREAPPROVED", "Pre-Approved", "موافَق عليه مسبقاً"],
    ],
  },
  {
    key: "bonus", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "البونص المعروض", name_en: "Bonus Offered",
    why_ar: "نرصد ما عرضه الموظف فعلاً في رسائله — وهذا مفيد للالتزام أيضاً.",
    exclusive: "all",
    tags: [
      ["BONUS_10%PCT", "10% Bonus", "بونص 10%"],
      ["BONUS_20%PCT", "20% Bonus", "بونص 20%"],
      ["BONUS_30%PCT", "30% Bonus", "بونص 30%"],
      ["BONUS_50%PCT", "50% Bonus", "بونص 50%"],
    ],
  },
  {
    key: "loss_reason", dept: "sales", platform: "Sales Agent", source: "ai",
    name_ar: "سبب الخسارة أو المغادرة", name_en: "Loss / Churn Reason",
    why_ar: "أثمن ما في المحادثات: لماذا انصرف العميل، بكلماته هو.",
    tags: [
      ["LOST_NOT_INTERESTED", "Not Interested", "غير مهتم"],
      ["LOST_NO_RESPONSE", "No Response", "لم يردّ"],
      ["LOST_COMPETITOR", "Went to Competitor", "ذهب إلى منافس"],
      ["LOST_SPREADS_FEES", "Spreads Too High", "الفروقات/العمولات مرتفعة"],
      ["LOST_PLATFORM", "Platform Issues", "مشاكل في المنصّة"],
      ["LOST_TRUST", "Trust / Credibility", "مسألة ثقة"],
      ["LOST_DEPOSIT_AMOUNT", "Min Deposit Too High", "أدنى إيداع مرتفع"],
      ["LOST_PAYMENT_METHOD", "Payment Method", "طريقة الدفع"],
      ["LOST_COUNTRY_RESTRICTION", "Country Restriction", "قيود الدولة"],
      ["LOST_KYC_FAILED", "KYC Failed", "فشل التحقّق من الهوية"],
      ["LOST_RISK_CONCERNS", "Risk Concerns", "قلق من المخاطر"],
      ["LOST_SUPPORT_EXPERIENCE", "Bad Support", "تجربة دعم سيّئة"],
      ["LOST_BAD_TIMING", "Bad Timing", "توقيت غير مناسب"],
    ],
  },
  {
    key: "compliance_kyc", dept: "comp", platform: "Compliance System", source: "external",
    name_ar: "حالة الالتزام والتحقّق", name_en: "Compliance / KYC Status",
    why_ar: "قرار قسم الالتزام. لا يُستنتج من محادثة، وخطؤه له ثمن تنظيمي.",
    tags: [
      ["COMP_KYC_REQUIRED", "KYC Required", "التحقّق مطلوب"],
      ["COMP_KYC_VERIFIED", "KYC Verified ✅", "تم التحقّق ✅"],
      ["COMP_AML_SCREENED", "AML Screened", "فُحص لغسل الأموال"],
      ["COMP_SANCTIONS_SCREENED", "Sanctions Screened", "فُحص في قوائم العقوبات"],
      ["COMP_COUNTRY_RESTRICTED", "Country Restricted 🚫", "دولة محظورة 🚫"],
      ["COMP_UNDER_REVIEW", "Under Review", "تحت المراجعة"],
    ],
  },
  {
    key: "document_status", dept: "comp", platform: "Compliance System", source: "external",
    name_ar: "حالة المستندات", name_en: "Document Status",
    why_ar: "«استُلم» تعني استُلم وقُبل في نظام الالتزام، لا أن العميل أرسل صورة في الدردشة.",
    tags: [
      ["DOC_PASSPORT_PENDING", "Passport — Pending", "جواز السفر — معلّق"],
      ["DOC_PASSPORT_RECEIVED", "Passport — Received ✅", "جواز السفر — مُستلَم ✅"],
      ["DOC_NATIONAL_ID_PENDING", "National ID — Pending", "الهوية — معلّقة"],
      ["DOC_NATIONAL_ID_RECEIVED", "National ID — Received ✅", "الهوية — مُستلَمة ✅"],
      ["DOC_SELFIE_PENDING", "Selfie — Pending", "صورة شخصية — معلّقة"],
      ["DOC_SELFIE_RECEIVED", "Selfie — Received ✅", "صورة شخصية — مُستلَمة ✅"],
      ["DOC_PROOF_ADDRESS_PENDING", "Proof of Address — Pending", "إثبات العنوان — معلّق"],
      ["DOC_PROOF_ADDRESS_RECEIVED", "Proof of Address — Received ✅", "إثبات العنوان — مُستلَم ✅"],
      ["DOC_BANK_STATEMENT_PENDING", "Bank Statement — Pending", "كشف الحساب — معلّق"],
      ["DOC_BANK_STATEMENT_RECEIVED", "Bank Statement — Received ✅", "كشف الحساب — مُستلَم ✅"],
      ["DOC_SOURCE_OF_FUNDS_PENDING", "Source of Funds — Pending", "مصدر الأموال — معلّق"],
      ["DOC_SOURCE_OF_FUNDS_RECEIVED", "Source of Funds — Received ✅", "مصدر الأموال — مُستلَم ✅"],
      ["DOC_PREAPPROVAL_PENDING", "Pre-Approval — Pending", "الموافقة المسبقة — معلّقة"],
      ["DOC_PREAPPROVAL_RECEIVED", "Pre-Approval — Received ✅", "الموافقة المسبقة — مُستلَمة ✅"],
    ],
  },
  {
    key: "cp_status", dept: "ops", platform: "Ops / CRM", source: "external",
    name_ar: "حالة الشريك", name_en: "Channel Partner Status",
    why_ar: "علاقة تعاقدية يديرها التشغيل، لا محادثة.",
    exclusive: "all",
    tags: [
      ["CP_STATUS_PROSPECT", "Prospect", "مرشّح"], ["CP_STATUS_CONTACTED", "Contacted", "تم التواصل"],
      ["CP_STATUS_NEGOTIATION", "In Negotiation", "تحت التفاوض"], ["CP_STATUS_ONBOARDING", "Onboarding", "قيد التهيئة"],
      ["CP_STATUS_ACTIVE", "✅ Active", "✅ نشط"], ["CP_STATUS_DORMANT", "Dormant", "خامل"],
      ["CP_STATUS_PAUSED", "Paused", "موقوف مؤقتاً"], ["CP_STATUS_BLACKLISTED", "⛔ Blacklisted", "⛔ محظور"],
      ["CP_STATUS_TERMINATED", "Terminated", "مُنتهٍ"],
    ],
  },
  {
    key: "cp_type", dept: "ops", platform: "Ops / CRM", source: "external",
    name_ar: "نوع الشريك", name_en: "Channel Partner Type",
    why_ar: "يُثبَّت في العقد.",
    exclusive: "all",
    tags: [
      ["CP_TYPE_INTRODUCER_BROKER", "Introducing Broker (IB)", "وسيط معرّف"],
      ["CP_TYPE_AFFILIATE_MARKETER", "Affiliate Marketer", "مسوّق بالعمولة"],
      ["CP_TYPE_LEAD_GEN_AGENCY", "Lead Gen Agency", "وكالة توليد عملاء"],
      ["CP_TYPE_MEDIA_BUYER", "Media Buyer", "مشتري وسائط"],
      ["CP_TYPE_OTHER", "Other", "أخرى"],
    ],
  },
  {
    key: "cp_tier", dept: "ops", platform: "Ops / CRM", source: "external",
    name_ar: "درجة الشريك", name_en: "Channel Partner Tier",
    why_ar: "تُراجع شهرياً بناءً على أداء فعلي.",
    exclusive: "all",
    tags: [
      ["CP_TIER_A", "Tier A (Top)", "الدرجة أ (الأعلى)"], ["CP_TIER_B", "Tier B", "الدرجة ب"],
      ["CP_TIER_C", "Tier C", "الدرجة ج"], ["CP_TIER_TEST", "Test / Evaluation", "تجريبي / تحت التقييم"],
    ],
  },
  {
    key: "cp_model", dept: "ops", platform: "Ops / CRM", source: "external",
    name_ar: "نموذج عمولة الشريك", name_en: "Partner Commission Model",
    why_ar: "بند تعاقدي موقَّع.",
    tags: [
      ["CP_MODEL_CPA", "CPA (Cost Per Acquisition)", "تكلفة لكل عميل"],
      ["CP_MODEL_CPL", "CPL (Cost Per Lead)", "تكلفة لكل ليد"],
      ["CP_MODEL_CPS", "CPS (Cost Per Sale)", "تكلفة لكل بيع"],
      ["CP_MODEL_REVSHARE", "Revenue Share", "مشاركة الإيراد"],
      ["CP_MODEL_FIXED_FEE", "Fixed Fee", "أجر ثابت"],
      ["CP_MODEL_REFERRAL_FEE", "Referral Fee", "أجر إحالة"],
    ],
  },
  {
    key: "cp_kyc", dept: "ops", platform: "Ops / CRM", source: "external",
    name_ar: "قائمة تحقّق الشريك", name_en: "Partner KYC Checklist",
    why_ar: "مستندات موقَّعة ومحقّقة، لا كلام في دردشة.",
    tags: [
      ["CP_COMPL_ID_KYC_DONE", "ID / KYC Done", "التحقّق من الهوية مُنجَز"],
      ["CP_COMPL_CONTRACT_SIGNED", "Contract Signed", "العقد موقَّع"],
      ["CP_COMPL_NDA_SIGNED", "NDA Signed", "اتفاقية السرّية موقَّعة"],
      ["CP_COMPL_MOU_SIGNED", "MOU Signed", "مذكّرة التفاهم موقَّعة"],
      ["CP_COMPL_BANK_DETAILS_VERIFIED", "Bank Details Verified", "البيانات البنكية محقَّقة"],
      ["CP_COMPL_LICENSE_VERIFIED", "License Verified", "الترخيص محقَّق"],
      ["CP_COMPL_SANCTIONS_SCREENED", "Sanctions Screened", "فُحص في قوائم العقوبات"],
      ["CP_COMPL_MARKETING_OPT_IN_CONFIRMED", "Marketing Opt-In Confirmed", "موافقة التسويق مؤكَّدة"],
    ],
  },
  {
    key: "cp_channel", dept: "ops", platform: "Ops / CRM", source: "external",
    name_ar: "قناة استقطاب الشريك", name_en: "Partner Acquisition Channel",
    why_ar: "يُسجَّل عند التعاقد.",
    exclusive: "all",
    tags: [
      ["CP_CH_META", "Meta (Facebook/Instagram)", "ميتا"], ["CP_CH_GOOGLE", "Google Ads", "إعلانات جوجل"],
      ["CP_CH_LINKEDIN", "LinkedIn", "لينكد إن"], ["CP_CH_REFERRAL", "Referral", "توصية"],
      ["CP_CH_EVENT_EXPO", "Event / Expo", "معرض أو حدث"], ["CP_CH_COLD_CALL", "Cold Call", "اتصال بارد"],
      ["CP_CH_EMAIL_OUTREACH", "Email Outreach", "تواصل بالبريد"],
      ["CP_CH_WATI_INBOUND", "Wati Inbound", "واتساب مباشر"],
      ["CP_CH_WEBSITE_INBOUND", "Website Inbound", "الموقع مباشرة"],
    ],
  },
  {
    key: "rebate", dept: "ops", platform: "Ops / CRM", source: "external",
    name_ar: "هيكل الرِّيبت", name_en: "Rebate Structure",
    why_ar: "نسبة متعاقد عليها.",
    exclusive: "all",
    tags: [
      ["REBATE_1%PCT", "1% Rebate", "ريبت 1%"], ["REBATE_2%PCT", "2% Rebate", "ريبت 2%"],
      ["REBATE_3%PCT", "3% Rebate", "ريبت 3%"], ["REBATE_5%PCT", "5% Rebate", "ريبت 5%"],
    ],
  },
];

/** code -> { code, en, ar, category, dept, source } for every tag in the sheet. */
export const TAG_INDEX = (() => {
  const ix = new Map();
  for (const c of CATEGORIES) {
    for (const [code, en, ar] of c.tags) {
      // A tag can override its category's source — ENG_OPTED_OUT is AI even
      // though its category is rule-driven.
      const source = c.ai_only?.includes(code) ? "ai"
        : c.rule_only?.includes(code) ? "rule"
        : c.external_only?.includes(code) ? "external"
        : c.manual_only?.includes(code) ? "manual"
        : c.source;
      ix.set(code, {
        code, en, ar, category: c.key, dept: c.dept, source,
        added: !!c.addedBeyondSheet?.includes(code),
      });
    }
  }
  return ix;
})();

export const isKnownTag = (code) => TAG_INDEX.has(String(code || "").trim());
export const categoryOf = (code) => TAG_INDEX.get(code)?.category || null;
export const sourceOf = (code) => TAG_INDEX.get(code)?.source || null;

export function tagLabel(code, lang = "ar") {
  const t = TAG_INDEX.get(code);
  if (!t) return code;
  return lang === "en" ? t.en : t.ar;
}

export function categoryLabel(key, lang = "ar") {
  const c = CATEGORIES.find((x) => x.key === key);
  if (!c) return key;
  return lang === "en" ? c.name_en : c.name_ar;
}

/** The vocabulary the AI is allowed to use — nothing else is accepted from it. */
export function aiTags() {
  return [...TAG_INDEX.values()].filter((t) => t.source === "ai").map((t) => t.code);
}

/** Categories the AI works on, with their tags — used to build the prompt. */
export function aiCategories() {
  return CATEGORIES
    .map((c) => ({ ...c, tags: c.tags.filter(([code]) => sourceOf(code) === "ai") }))
    .filter((c) => c.tags.length > 0);
}

/**
 * Mutually-exclusive groups as a flat list, so a validator can keep the
 * highest-confidence tag and drop the rest. `exclusive: "all"` means the whole
 * category is one group (a customer has one country, one experience level);
 * an explicit array marks a subset (Hot/Warm/Cold are exclusive, Do-Not-Call
 * is not).
 */
export function exclusiveGroups() {
  const groups = [];
  for (const c of CATEGORIES) {
    if (c.exclusive === "all") groups.push(c.tags.map(([code]) => code));
    else if (Array.isArray(c.exclusive)) for (const g of c.exclusive) groups.push([...g]);
  }
  return groups;
}

export const TAG_COUNT = TAG_INDEX.size;

export default {
  CATEGORIES, TAG_INDEX, SOURCES, DEPARTMENTS, TAG_COUNT,
  isKnownTag, categoryOf, sourceOf, tagLabel, categoryLabel,
  aiTags, aiCategories, exclusiveGroups,
};
