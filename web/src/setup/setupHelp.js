// Where every credential actually comes from.
//
// This is the difference between a form and an installer. "Meta App Secret" is
// not a helpful label to someone who has never opened the Meta App Dashboard,
// so each field carries numbered steps in the operator's own language, the
// official documentation link, and — where the value has a recognisable shape —
// an example so they can tell whether they pasted the right thing.
//
// Written as data, not JSX, so the same content can be shown in the wizard and
// in the post-install Settings page without duplicating it.

export const HELP = {
  // ---- Database -----------------------------------------------------------
  "db.host": {
    ar: {
      label: "عنوان خادم قاعدة البيانات",
      why: "أين يعمل خادم MySQL.",
      steps: [
        "إن كانت قاعدة البيانات على نفس الجهاز: اكتب 127.0.0.1",
        "إن كنت تشغّل التطبيق عبر Docker Compose: اكتب اسم الخدمة كما في ملف compose (مثل mysql) وليس localhost — داخل الحاوية يشير localhost إلى الحاوية نفسها.",
        "إن كانت القاعدة على خادم آخر أو خدمة سحابية: انسخ المضيف (Host) من لوحة تحكم المزوّد.",
      ],
      example: "127.0.0.1  أو  mysql  أو  db.example.com",
    },
    en: {
      label: "Database host",
      why: "Where the MySQL server runs.",
      steps: [
        "Same machine: use 127.0.0.1",
        "Docker Compose: use the compose service name (e.g. mysql), not localhost — inside a container localhost means the container itself.",
        "Managed/cloud database: copy the Host value from your provider's console.",
      ],
      example: "127.0.0.1, mysql, or db.example.com",
    },
  },
  "db.database": {
    ar: {
      label: "اسم قاعدة البيانات",
      why: "القاعدة التي ستُنشأ فيها جداول التطبيق.",
      steps: [
        "اختر اسماً واضحاً بأحرف إنجليزية وأرقام وشرطة سفلية فقط.",
        "لا حاجة لإنشائها مسبقاً — إن لم تكن موجودة سيعرض التطبيق زر «أنشئها لي».",
      ],
      example: "ads_whatsapp",
    },
    en: {
      label: "Database name",
      why: "The schema the app's tables will be created in.",
      steps: [
        "Pick a clear name using only letters, digits and underscores.",
        "It does not have to exist yet — if it doesn't, the app offers a Create it for me button.",
      ],
      example: "ads_whatsapp",
    },
  },
  "db.user": {
    ar: {
      label: "اسم المستخدم",
      why: "حساب MySQL الذي سيستخدمه التطبيق.",
      steps: [
        "يحتاج صلاحيات كاملة على هذه القاعدة وحدها — وليس على الخادم كله.",
        "إن لم يكن لديك حساب بعد، شغّل على خادم MySQL:",
        "CREATE DATABASE ads_whatsapp CHARACTER SET utf8mb4;",
        "CREATE USER app@% IDENTIFIED BY 'كلمة-مرور-قوية';",
        "GRANT ALL ON ads_whatsapp.* TO app@%;",
      ],
    },
    en: {
      label: "Username",
      why: "The MySQL account the app will use.",
      steps: [
        "It needs full rights on this one database — not on the whole server.",
        "If you don't have an account yet, run on the MySQL server:",
        "CREATE DATABASE ads_whatsapp CHARACTER SET utf8mb4;",
        "CREATE USER app@% IDENTIFIED BY 'a-strong-password';",
        "GRANT ALL ON ads_whatsapp.* TO app@%;",
      ],
    },
  },

  // ---- Meta ---------------------------------------------------------------
  "meta.appId": {
    ar: {
      label: "معرّف تطبيق Meta (App ID)",
      why: "يسمح للتطبيق بتجديد رمز الوصول تلقائياً بدل أن ينتهي كل شهرين.",
      steps: [
        "افتح developers.facebook.com ثم My Apps ← Create App.",
        "اختر نوع Business، وأدخِل اسم التطبيق وبريد التواصل.",
        "من القائمة الجانبية: App settings ← Basic.",
        "انسخ القيمة الظاهرة في حقل App ID (رقم طويل).",
        "في نفس الصفحة أضِف منتج Marketing API من Add Product.",
      ],
      docUrl: "https://developers.facebook.com/apps/",
      example: "1234567890123456",
    },
    en: {
      label: "Meta App ID",
      why: "Lets the app refresh its access token automatically instead of it expiring every two months.",
      steps: [
        "Go to developers.facebook.com → My Apps → Create App.",
        "Choose the Business type, then give it a name and a contact email.",
        "In the sidebar: App settings → Basic.",
        "Copy the App ID (a long number).",
        "On the same page, add the Marketing API product under Add Product.",
      ],
      docUrl: "https://developers.facebook.com/apps/",
      example: "1234567890123456",
    },
  },
  "meta.appSecret": {
    ar: {
      label: "المفتاح السرّي للتطبيق (App Secret)",
      why: "يُستخدم لتحويل الرمز المؤقّت إلى رمز طويل الأمد وتجديده.",
      steps: [
        "في نفس الصفحة: App settings ← Basic.",
        "بجانب App Secret اضغط Show وأدخِل كلمة مرور حسابك.",
        "انسخ القيمة كاملة.",
        "تُخزَّن لدينا مشفّرة، ولا تظهر مرة أخرى بعد الحفظ.",
      ],
      docUrl: "https://developers.facebook.com/docs/facebook-login/security/",
      secret: true,
    },
    en: {
      label: "Meta App Secret",
      why: "Used to exchange a short-lived token for a long-lived one, and to refresh it.",
      steps: [
        "Same page: App settings → Basic.",
        "Next to App Secret click Show and enter your account password.",
        "Copy the whole value.",
        "We store it encrypted, and never display it again after saving.",
      ],
      docUrl: "https://developers.facebook.com/docs/facebook-login/security/",
      secret: true,
    },
  },
  "meta.token": {
    ar: {
      label: "رمز الوصول (Access Token)",
      why: "يمنح التطبيق صلاحية قراءة بيانات حملاتك الإعلانية. قراءة فقط — لا يستطيع تعديل أو إيقاف أي حملة.",
      steps: [
        "افتح developers.facebook.com/tools/explorer",
        "اختر تطبيقك من قائمة Meta App في الأعلى.",
        "من Permissions أضِف: ads_read و business_management.",
        "اضغط Generate Access Token ووافق على الأذونات.",
        "انسخ الرمز الظاهر والصقه هنا — سنحوّله تلقائياً إلى رمز طويل الأمد.",
      ],
      docUrl: "https://developers.facebook.com/tools/explorer",
      secret: true,
    },
    en: {
      label: "Access token",
      why: "Lets the app read your ad campaign data. Read-only — it cannot edit or pause anything.",
      steps: [
        "Open developers.facebook.com/tools/explorer",
        "Pick your app from the Meta App dropdown at the top.",
        "Under Permissions add: ads_read and business_management.",
        "Click Generate Access Token and approve the permissions.",
        "Copy the token and paste it here — we upgrade it to a long-lived one automatically.",
      ],
      docUrl: "https://developers.facebook.com/tools/explorer",
      secret: true,
    },
  },
  "meta.accountId": {
    ar: {
      label: "الحساب الإعلاني",
      why: "الحساب الذي ستُقرأ منه بيانات الإنفاق والنتائج.",
      steps: [
        "اضغط «اختبار الاتصال» أولاً — سنعرض لك كل الحسابات المتاحة لهذا الرمز لتختار منها.",
        "يمكنك أيضاً إيجاده يدوياً: افتح adsmanager.facebook.com، والرقم يظهر في أعلى الصفحة بجانب اسم الحساب وفي رابط الصفحة بعد act_",
        "أدخِل الرقم فقط بدون البادئة act_",
      ],
      docUrl: "https://adsmanager.facebook.com/",
      example: "123456789012345",
    },
    en: {
      label: "Ad account",
      why: "The account spend and results are read from.",
      steps: [
        "Press Test connection first — we list every account this token can see, so you can pick one.",
        "To find it manually: open adsmanager.facebook.com; the number is at the top next to the account name, and in the page URL after act_",
        "Enter the number only, without the act_ prefix.",
      ],
      docUrl: "https://adsmanager.facebook.com/",
      example: "123456789012345",
    },
  },

  // ---- Wati ---------------------------------------------------------------
  "wati.endpoint": {
    ar: {
      label: "عنوان واجهة Wati",
      why: "الخادم الذي تُقرأ منه محادثات واتساب. يختلف حسب المنطقة.",
      steps: [
        "سجّل الدخول إلى لوحة Wati.",
        "من القائمة: API Docs (أو Developers / Integrations حسب نسختك).",
        "انسخ قيمة API Endpoint كما هي.",
        "انتبه: هذا ليس عنوان لوحة التحكم app.wati.io — بل مضيف الواجهة مثل live-mt-server.wati.io",
        "إن نسيت رقم المستأجر في نهاية العنوان فسنستخرجه من الرمز ونصحّحه لك.",
      ],
      docUrl: "https://docs.wati.io/reference/introduction",
      example: "https://live-mt-server.wati.io/1051066",
    },
    en: {
      label: "Wati API endpoint",
      why: "The server your WhatsApp conversations are read from. It differs by region.",
      steps: [
        "Sign in to your Wati dashboard.",
        "Open API Docs (or Developers / Integrations, depending on your version).",
        "Copy the API Endpoint value exactly.",
        "Note: this is NOT the dashboard URL app.wati.io — it is the API host, e.g. live-mt-server.wati.io",
        "If you leave off the tenant id at the end, we read it from your token and correct it for you.",
      ],
      docUrl: "https://docs.wati.io/reference/introduction",
      example: "https://live-mt-server.wati.io/1051066",
    },
  },
  "wati.token": {
    ar: {
      label: "رمز Wati",
      why: "يمنح صلاحية قراءة جهات الاتصال والمحادثات، وإسناد المحادثات للموظفين.",
      steps: [
        "في نفس صفحة API Docs، ابحث عن Access Token.",
        "اضغط Generate أو انسخ الرمز الموجود.",
        "الصق الرمز وحده — إن نسخت معه كلمة Bearer فسنزيلها تلقائياً.",
        "الرمز طويل جداً (يبدأ عادة بـ eyJ) — تأكّد من نسخه كاملاً.",
      ],
      docUrl: "https://docs.wati.io/reference/introduction",
      secret: true,
    },
    en: {
      label: "Wati access token",
      why: "Grants read access to contacts and conversations, and lets the app reassign chats to agents.",
      steps: [
        "On the same API Docs page, find Access Token.",
        "Click Generate, or copy the existing one.",
        "Paste the token alone — if you copy the word Bearer with it, we strip that for you.",
        "The token is very long (it usually starts with eyJ) — make sure you copied all of it.",
      ],
      docUrl: "https://docs.wati.io/reference/introduction",
      secret: true,
    },
  },

  // ---- AI -----------------------------------------------------------------
  "ai.apiKey": {
    ar: {
      label: "مفتاح DeepSeek",
      why: "يُستخدم لتحليل المحادثات وتقييم أداء الموظفين وتوليد ملف عملك.",
      steps: [
        "افتح platform.deepseek.com وسجّل حساباً.",
        "من القائمة الجانبية: API Keys ← Create new API key.",
        "انسخ المفتاح فوراً — يُعرض مرة واحدة فقط ولا يمكن استرجاعه.",
        "اشحن رصيداً من صفحة Top up. مفتاح بلا رصيد يبدو صالحاً لكنه يفشل عند أول استخدام.",
        "التكلفة زهيدة: تحليل آلاف المحادثات يكلّف دولارات قليلة، وهناك سقف يومي تضبطه بنفسك.",
      ],
      docUrl: "https://platform.deepseek.com/api_keys",
      secret: true,
    },
    en: {
      label: "DeepSeek API key",
      why: "Used to analyse conversations, score agent performance, and generate your business profile.",
      steps: [
        "Go to platform.deepseek.com and create an account.",
        "In the sidebar: API Keys → Create new API key.",
        "Copy it immediately — it is shown once and cannot be retrieved later.",
        "Add credit under Top up. A key with no balance looks valid but fails on first use.",
        "Cost is small: analysing thousands of conversations runs to a few dollars, and you set a daily ceiling.",
      ],
      docUrl: "https://platform.deepseek.com/api_keys",
      secret: true,
    },
  },
  "ai.dailyBudgetUsd": {
    ar: {
      label: "السقف اليومي (دولار)",
      why: "حدّ صارم للإنفاق. عند بلوغه يتوقّف التحليل بدل أن يستمر الإنفاق.",
      steps: ["10 دولارات يومياً تكفي لمعظم الحسابات. يمكنك تغييرها لاحقاً في أي وقت."],
    },
    en: {
      label: "Daily budget (USD)",
      why: "A hard spending ceiling. Analysis stops when it is reached rather than spending on.",
      steps: ["$10/day is enough for most accounts. You can change it at any time later."],
    },
  },

  // ---- Business -----------------------------------------------------------
  "business.websiteUrl": {
    ar: {
      label: "الموقع الرسمي للشركة",
      why: "يقرأ الذكاء الاصطناعي موقعك ليفهم ما تبيعه ولمن، فيقيّم المحادثات بمعايير مجالك أنت لا بمعايير عامة.",
      steps: [
        "أدخِل عنوان الصفحة الرئيسية.",
        "سنقرأ تلقائياً صفحات: من نحن، الخدمات، الأسعار، والشروط إن وُجدت.",
        "إن كان موقعك محمياً بحاجز حماية أو مبنياً بالكامل بجافاسكربت فقد لا نتمكّن من قراءته — وهذا لا يمنع إكمال التنصيب.",
        "لن يُكتب أي شيء على موقعك — القراءة فقط.",
      ],
      example: "https://example.com",
    },
    en: {
      label: "Company website",
      why: "The AI reads your site to learn what you sell and to whom, so it judges conversations by your industry's standards rather than generic ones.",
      steps: [
        "Enter your homepage address.",
        "We also read your about, services, pricing and terms pages when they exist.",
        "If your site is behind a bot filter or rendered entirely in JavaScript we may not be able to read it — that does not block the install.",
        "Nothing is ever written to your site. Read only.",
      ],
      example: "https://example.com",
    },
  },
  "business.description": {
    ar: {
      label: "وصف النشاط",
      why: "أهم حقل في التنصيب كله. منه يتعلّم الذكاء الاصطناعي ما هو «العميل المؤهّل» وما هي «المخالفة» في مجالك.",
      steps: [
        "اكتب بلغتك الطبيعية: ماذا تبيع؟ لمن؟ ما الخطوة التي تريد أن يصل إليها العميل (حجز موعد، زيارة معرض، شراء، طلب عرض سعر)؟",
        "اذكر ما يُمنع على موظفيك قوله (وعود، ضمانات، نصائح خارج اختصاصكم).",
        "اذكر أي التزامات نظامية أو تراخيص تخصّ مجالك.",
        "كلما كان الوصف أدقّ كان تقييم المحادثات أدقّ. 3-5 أسطر كافية.",
      ],
    },
    en: {
      label: "Business description",
      why: "The most important field in the whole install. It is how the AI learns what a qualified lead is, and what counts as a violation, in your industry.",
      steps: [
        "Write in plain language: what do you sell, to whom, and what step do you want a customer to reach (book an appointment, visit a showroom, buy, request a quote)?",
        "Say what your staff must never claim (promises, guarantees, advice outside your expertise).",
        "Mention any regulatory obligations or licences that apply to your field.",
        "The more specific this is, the more accurate the conversation scoring. Three to five lines is enough.",
      ],
    },
  },

  // ---- Finish -------------------------------------------------------------
  "admin.email": {
    ar: {
      label: "بريد المدير",
      why: "الحساب الأول، وله كل الصلاحيات. يمكنك إضافة بقية الفريق بعد الدخول.",
      steps: ["استخدم بريداً حقيقياً تصل إليه — ستُرسل إليه تقارير النظام."],
    },
    en: {
      label: "Administrator email",
      why: "The first account, with full permissions. You can add the rest of your team after signing in.",
      steps: ["Use a real address you can receive mail at — system reports are sent there."],
    },
  },
  "admin.password": {
    ar: {
      label: "كلمة المرور",
      why: "تحمي كل بيانات عملائك ومحادثاتهم.",
      steps: ["10 أحرف على الأقل.", "لا تُخزَّن كما هي — يُحفظ منها بصمة مشفّرة فقط."],
      secret: true,
    },
    en: {
      label: "Password",
      why: "It protects all of your customer and conversation data.",
      steps: ["At least 10 characters.", "Never stored as typed — only a bcrypt hash is kept."],
      secret: true,
    },
  },
};

export function helpFor(key, lang = "ar") {
  const h = HELP[key];
  if (!h) return null;
  return h[lang === "en" ? "en" : "ar"] || h.ar;
}

export default { HELP, helpFor };
