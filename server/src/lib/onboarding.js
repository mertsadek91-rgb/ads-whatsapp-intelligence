// What is still missing from this installation.
//
// Derived from the LIVE configuration, never from what the wizard recorded.
// That distinction matters: an operator who skips Meta during setup and
// connects it a week later from the Settings page must see the item disappear
// on its own. A checklist that remembers what you skipped, rather than looking
// at what is actually configured, starts lying the moment someone fixes
// something by another route.
import config from "../config.js";
import { getMeta } from "./profileStore.js";
import { isConfigured as smtpConfigured } from "./mailer.js";

/**
 * Each item says what breaks while it is missing, because "Meta is not
 * configured" is a fact and "you have no ad spend or cost-per-lead" is a reason.
 */
export function onboardingItems() {
  const profile = getMeta();

  return [
    {
      key: "meta",
      required: false,
      done: !!(config.meta.accountId && (config.meta.token || config.meta.appId)),
      href: "/settings",
      ar: "ربط حساب إعلانات Meta",
      en: "Connect Meta Ads",
      why_ar: "بدونه لا توجد بيانات إنفاق ولا تكلفة لكل عميل — تعمل تحليلات المحادثات وحدها.",
      why_en: "Without it there is no spend or cost-per-lead — conversation analytics still work on their own.",
    },
    {
      key: "wati",
      required: false,
      done: !!(config.wati.endpoint && config.wati.token),
      href: "/settings",
      ar: "ربط واتساب عبر Wati",
      en: "Connect WhatsApp via Wati",
      why_ar: "هذا مصدر المحادثات نفسها. بدونه لا توجد بيانات عملاء لتحليلها.",
      why_en: "This is where the conversations come from. Without it there is nothing to analyse.",
    },
    {
      key: "ai",
      required: false,
      done: !!config.deepseek.apiKey,
      href: "/settings",
      ar: "مفتاح الذكاء الاصطناعي",
      en: "AI key",
      why_ar: "بدونه تُجمع المحادثات وتُعرض، لكن لا تقييم للجودة ولا رصد للمخالفات.",
      why_en: "Without it conversations are collected and shown, but nothing is scored and no compliance issues are detected.",
    },
    {
      key: "business",
      required: false,
      // 'seed' means the generic profile is in use — the app works, but it is
      // judging conversations by general rules rather than this industry's.
      done: profile.source !== "seed" && profile.version > 0,
      href: "/business-profile",
      ar: "تعريف نشاط الشركة",
      en: "Define your business",
      why_ar: "يُستخدم الآن ملف عام. التقييم سيكون أدقّ بكثير حين يعرف النظام مجالك تحديداً.",
      why_en: "A generic profile is in use. Scoring gets far more accurate once the system knows your industry.",
    },
    {
      key: "smtp",
      required: false,
      done: smtpConfigured(),
      href: "/settings",
      ar: "إعداد البريد للتقارير",
      en: "Email for reports",
      why_ar: "اختياري تماماً. بدونه تُنتَج التقارير ويمكن تنزيلها، لكنها لا تُرسَل تلقائياً.",
      why_en: "Entirely optional. Reports are still generated and downloadable, they are just not emailed.",
    },
  ];
}

export function onboardingStatus() {
  const items = onboardingItems();
  const pending = items.filter((i) => !i.done);
  return {
    items,
    pending: pending.length,
    // Nothing here blocks the app from running — that is the point of letting
    // these be skipped — so the caller can present it as a to-do, not an error.
    blocking: pending.filter((i) => i.required).length,
  };
}

export default { onboardingItems, onboardingStatus };
