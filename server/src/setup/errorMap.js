// Every way a credential check can fail, translated into something an operator
// can act on — in both languages, with the official documentation link and,
// where one exists, the exact command or button that fixes it.
//
// The point is that "ER_ACCESS_DENIED_ERROR" or "OAuthException code 200" tells
// a non-developer nothing. `action` is a machine-readable hint the wizard turns
// into a button (create the database, reconnect, top up), so the UI never has
// to parse a message string.

export const HINTS = {
  // ---- Database -----------------------------------------------------------
  DB_CONN_REFUSED: {
    ar: "لا يوجد خادم يستمع على هذا العنوان والمنفذ. تأكّد أن MySQL يعمل وأن المنفذ صحيح. إن كان التطبيق داخل Docker فاستخدم اسم الخدمة (مثل mysql) بدلاً من localhost.",
    en: "Nothing is listening on that host and port. Check MySQL is running and the port is right. Inside Docker, use the compose service name (e.g. mysql), not localhost.",
  },
  DB_DNS: {
    ar: "اسم الخادم غير قابل للترجمة. داخل Docker استخدم اسم الخدمة وليس localhost.",
    en: "That hostname does not resolve. Inside Docker use the compose service name, not localhost.",
  },
  DB_TIMEOUT: {
    ar: "انتهت مهلة الاتصال — غالباً جدار حماية يمنع المنفذ 3306.",
    en: "The connection timed out — usually a firewall or security group blocking port 3306.",
  },
  DB_ACCESS_DENIED: {
    ar: "اسم المستخدم أو كلمة المرور غير صحيحة.",
    en: "Wrong username or password.",
  },
  DB_HOST_NOT_PRIVILEGED: {
    ar: "المستخدم موجود لكنه غير مصرّح له بالاتصال من هذا الجهاز.",
    en: "The user exists but is not allowed to connect from this host.",
    fix: "CREATE USER <user>@% IDENTIFIED BY <password>; GRANT ALL ON <db>.* TO <user>@%;",
  },
  DB_NO_DATABASE: {
    ar: "قاعدة البيانات غير موجودة. يمكن للتطبيق إنشاؤها الآن.",
    en: "That database does not exist. The app can create it for you.",
    action: "create_database",
  },
  DB_NO_SCHEMA_ACCESS: {
    ar: "المستخدم يستطيع الاتصال لكن ليس لديه صلاحية على هذه القاعدة.",
    en: "The user can connect but has no rights on that schema.",
    fix: "GRANT ALL ON <db>.* TO <user>@%;",
  },
  DB_AUTH_PLUGIN: {
    ar: "طريقة مصادقة MySQL غير مدعومة من العميل.",
    en: "The MySQL authentication plugin is not supported by the client.",
    fix: "ALTER USER <user>@% IDENTIFIED WITH mysql_native_password BY <password>;",
  },
  DB_VERSION_TOO_OLD: {
    ar: "إصدار MySQL قديم. التطبيق يستخدم صيغة INSERT ... AS new التي تتطلّب 8.0.19 أو أحدث.",
    en: "MySQL is too old. The app uses INSERT ... AS new, which needs 8.0.19 or newer.",
  },
  DB_NO_CREATE_PRIVILEGE: {
    ar: "المستخدم لا يملك صلاحية إنشاء الجداول، وخطوة إنشاء الجداول ستفشل في منتصفها.",
    en: "The user cannot create tables, so the schema step would fail halfway through.",
    fix: "GRANT ALL ON <db>.* TO <user>@%;",
  },
  DB_TLS_UNTRUSTED: {
    ar: "خادم قاعدة البيانات يستخدم تشفيراً بشهادة غير موثوقة (شهادة ذاتية التوقيع) — وهذا شائع جداً على Coolify والخوادم الخاصة. اختر وضع التشفير من القائمة: إمّا «بدون تحقّق» وهو يشفّر الاتصال لكنه لا يمنع انتحال الخادم، أو «تحقّق بشهادة CA» والصق شهادة الخادم.",
    en: "The database server uses TLS with a certificate nothing trusts (self-signed) — very common on Coolify and self-hosted servers. Pick an encryption mode: either 'no verification', which encrypts the traffic but does not stop an impostor, or 'verify with a CA certificate' and paste the server's CA.",
    action: "choose_ssl_mode",
  },
  DB_TLS_REQUIRED: {
    ar: "خادم قاعدة البيانات يرفض الاتصال بدون تشفير. اختر وضع تشفير من القائمة.",
    en: "The database server refuses unencrypted connections. Pick an encryption mode.",
    action: "choose_ssl_mode",
  },
  DB_WRONG_CHARSET: {
    ar: "ترميز الخادم ليس utf8mb4 — النصوص العربية قد تُخزَّن بشكل خاطئ. تحذير وليس مانعاً.",
    en: "The server charset is not utf8mb4 — Arabic text may be stored incorrectly. A warning, not a blocker.",
  },

  // ---- Outbound TLS (shared by Meta, Wati, AI and the website reader) ------
  TLS_INTERCEPTED: {
    ar: "شيء ما يعترض الاتصال المشفّر ويعيد توقيعه — عادةً مضاد فيروسات بخاصية فحص HTTPS (كاسبرسكي، ESET، Bitdefender) أو بوّابة شبكة في الشركة. شهادته مثبّتة في نظام ويندوز فيعمل المتصفّح، لكن Node يستخدم قائمة شهادات خاصة به ويتجاهل قائمة النظام. الحل: شغّل التطبيق بأمر `npm run start:trusted` ليستخدم شهادات النظام، أو استثنِ هذا الموقع من فحص HTTPS في برنامج الحماية.",
    en: "Something is intercepting the encrypted connection and re-signing it — usually antivirus with HTTPS scanning (Kaspersky, ESET, Bitdefender) or a corporate network gateway. Its root certificate is in the Windows store, which is why the browser works, but Node ships its own certificate list and ignores the system one. Fix: run the app with `npm run start:trusted` so it uses the system certificates, or exclude this host from HTTPS scanning in your security software.",
  },

  // ---- Meta ---------------------------------------------------------------
  META_TOKEN_EXPIRED: {
    ar: "انتهت صلاحية رمز الوصول أو تم إلغاؤه. أعِد الربط لإصدار رمز جديد.",
    en: "The access token has expired or was revoked. Reconnect to issue a new one.",
    docUrl: "https://developers.facebook.com/docs/facebook-login/guides/access-tokens/",
    action: "reconnect",
  },
  META_MISSING_PERMISSION: {
    ar: "الرمز لا يحمل صلاحية ads_read. أعِد الربط مع تفعيل ads_read، و business_management للوصول إلى حسابات الأعمال.",
    en: "The token lacks ads_read. Reconnect and grant ads_read, plus business_management for Business-owned accounts.",
    docUrl: "https://developers.facebook.com/docs/marketing-api/overview/authorization",
    action: "reconnect",
  },
  META_APP_DEV_MODE: {
    ar: "التطبيق في وضع التطوير — فقط مدراء ومطوّرو التطبيق يمكنهم استخدامه. أضِف المستخدم في App Roles أو انقل التطبيق إلى Live.",
    en: "The app is in Development mode — only its admins, developers and testers can use it. Add the user under App Roles, or switch the app to Live.",
    docUrl: "https://developers.facebook.com/docs/development/release",
  },
  META_BAD_AD_ACCOUNT: {
    ar: "رقم الحساب الإعلاني غير صحيح أو غير مرئي لهذا الرمز.",
    en: "The ad account id is wrong, or not visible to this token.",
    docUrl: "https://www.facebook.com/business/help/1492627900875762",
  },
  META_DEPRECATED_VERSION: {
    ar: "إصدار Graph API المستخدم لم يعُد مدعوماً — اختر إصداراً أحدث.",
    en: "That Graph API version is no longer supported — pick a newer one.",
    docUrl: "https://developers.facebook.com/docs/graph-api/changelog",
  },
  META_RATE_LIMITED: {
    ar: "تجاوزت حدّ معدّل الطلبات لدى Meta. انتظر دقيقة ثم أعِد المحاولة.",
    en: "Meta is rate-limiting this app. Wait a minute and try again.",
  },
  META_REDIRECT_MISMATCH: {
    ar: "رابط إعادة التوجيه غير مسجَّل في التطبيق. أضِفه حرفياً في: App Dashboard ← Facebook Login ← Settings ← Valid OAuth Redirect URIs.",
    en: "The redirect URI is not registered. Add it verbatim under App Dashboard → Facebook Login → Settings → Valid OAuth Redirect URIs.",
  },

  // ---- Wati ---------------------------------------------------------------
  WATI_UNAUTHORIZED: {
    ar: "رمز Wati غير صحيح أو منتهي. احصل على رمز جديد من لوحة Wati ← API Docs / Developer ← Access Token. الصق الرمز وحده بدون كلمة Bearer.",
    en: "The Wati token is wrong or expired. Get a fresh one from the Wati dashboard → API Docs / Developer → Access Token. Paste the token alone, without the word Bearer.",
    docUrl: "https://docs.wati.io/reference/introduction",
  },
  WATI_TENANT_FIXED: {
    ar: "عنوان Wati كان ينقصه رقم المستأجر — استخرجناه من الرمز وصحّحنا العنوان.",
    en: "The Wati endpoint was missing its tenant id — we read it from the token and corrected the URL.",
  },
  WATI_DASHBOARD_URL: {
    ar: "هذا عنوان لوحة التحكم وليس عنوان الـ API. استخدم مضيف الـ API مثل live-mt-server.wati.io وليس app.wati.io.",
    en: "That is the dashboard URL, not the API host. Use the API host, e.g. live-mt-server.wati.io, not app.wati.io.",
  },
  WATI_RATE_LIMITED: {
    ar: "تجاوزت حدّ معدّل طلبات Wati. انتظر قليلاً ثم أعِد المحاولة.",
    en: "Wati is rate-limiting this token. Wait a moment and retry.",
  },
  WATI_UNREACHABLE: {
    ar: "تعذّر الوصول إلى خادم Wati — تحقّق من المضيف والمنطقة.",
    en: "Could not reach the Wati server — check the host and region.",
  },

  // ---- AI -----------------------------------------------------------------
  AI_UNAUTHORIZED: {
    ar: "مفتاح API غير صحيح. أنشئ مفتاحاً جديداً من platform.deepseek.com ← API Keys، ويُعرض مرة واحدة فقط.",
    en: "The API key is wrong. Create a new one at platform.deepseek.com → API Keys (shown only once).",
    docUrl: "https://platform.deepseek.com/api_keys",
  },
  AI_NO_BALANCE: {
    ar: "المفتاح صحيح لكن الرصيد صفر. اشحن الحساب ثم أعِد الاختبار. هذا الخطأ يُفهم غالباً خطأً على أنه مفتاح خاطئ.",
    en: "The key is valid but the account has no credit. Top up and retry. This is the failure most often misread as a bad key.",
    docUrl: "https://platform.deepseek.com/top_up",
  },
  AI_BAD_MODEL: {
    ar: "اسم النموذج غير معروف — اختر واحداً من القائمة.",
    en: "Unknown model name — pick one from the list.",
  },
  AI_RATE_LIMITED: {
    ar: "تجاوزت حدّ معدّل الطلبات. انتظر قليلاً ثم أعِد المحاولة.",
    en: "Rate limited. Wait a moment and retry.",
  },
  AI_UNREACHABLE: {
    ar: "تعذّر الوصول إلى خدمة الذكاء الاصطناعي — قد تكون هناك بوّابة شبكة أو انقطاع مؤقت.",
    en: "Could not reach the AI service — a corporate proxy, or a temporary outage.",
  },

  // ---- Business / website --------------------------------------------------
  SITE_UNREACHABLE: {
    ar: "تعذّر فتح الموقع. يمكنك المتابعة — سيُبنى ملف العمل من الوصف الذي تكتبه فقط.",
    en: "Could not open that website. You can continue — the business profile will be built from your description alone.",
  },
  SITE_BOT_BLOCKED: {
    ar: "الموقع يحجب الزيارات الآلية (Cloudflare أو ما شابه). هذا لا يعني أن موقعك معطّل.",
    en: "The site blocks automated visitors (Cloudflare or similar). This does not mean your site is down.",
  },
  SITE_PRIVATE_ADDRESS: {
    ar: "هذا عنوان داخلي أو محلي ولا يمكن جلبه لأسباب أمنية. أدخِل عنوان موقعك العام.",
    en: "That is an internal or loopback address and is refused for security reasons. Enter your public website address.",
  },

  UNKNOWN: {
    ar: "فشل غير متوقّع — راجع تفاصيل الخطأ.",
    en: "Unexpected failure — see the error detail.",
  },
};

/** Bilingual guidance for a code, always returning something usable. */
export function hintFor(code) {
  return { code, ...(HINTS[code] || HINTS.UNKNOWN) };
}

/** The uniform shape every validator returns, so the UI renders one way. */
export function fail(code, detail) {
  return { ok: false, ...hintFor(code), detail: detail ? String(detail).slice(0, 500) : null };
}

export function pass(details = {}, warnings = []) {
  return { ok: true, code: "OK", details, warnings };
}

export default { HINTS, hintFor, fail, pass };
