// The vocabularies that stay hardcoded, and why.
//
// Everything else about how a conversation is judged now lives in a
// per-installation business profile. These three do not, and the distinction is
// not arbitrary:
//
//   SEVERITIES  — clampSeverity() works by ORDER: a model's proposed severity
//                 may move at most one step from the type's default. Letting an
//                 installation redefine the ladder would break that arithmetic,
//                 and "how bad is bad" is not an industry-specific question.
//
//   SOURCES     — the ai / rule / external split is the design, not a business
//                 choice. It encodes "never let the model guess something
//                 another system actually knows", which is what stops a
//                 fabricated deposit tier or appointment status from being
//                 indistinguishable from a real one.
//
//   LEAD_INTENT — hot/warm/cold is the board's own vocabulary and is rendered
//                 by name throughout the UI.
export const SEVERITIES = ["informational", "minor", "moderate", "major", "critical"];

export const SOURCES = {
  ai: {
    ar: "يُستنتج من المحادثة بالذكاء الاصطناعي",
    en: "Inferred from the conversation by AI",
    why_ar: "المعلومة موجودة في المحادثة ولا مكان آخر: ما يريده العميل، وما اعترض عليه، ولماذا انصرف.",
    why_en: "It lives in the conversation and nowhere else: what the customer wants, what they objected to, why they left.",
  },
  rule: {
    ar: "محسوب بدقّة من بياناتنا",
    en: "Computed exactly from data we hold",
    why_ar: "نعرف الإجابة بدقّة ويمكن حسابها: البلد من مفتاح الهاتف، القناة من الإعلان، «بلا رد 48 ساعة» من التوقيتات. دفع تكلفة تخمين ما نعرفه يقيناً أبطأ وأكثر خطأً.",
    why_en: "We already hold the answer and can compute it exactly: country from the dial code, channel from the ad, no-reply-for-48h from the timestamps. Paying a model to guess what we know is both slower and wrong more often.",
  },
  external: {
    ar: "مصدره نظام آخر — لا يُخمَّن",
    en: "Owned by another system — never guessed",
    why_ar: "الحقيقة في نظام آخر: حجم الدفعة، حالة التحقّق، الموعد المحجوز. لا شيء من ذلك مرئي في محادثة واتساب، وقيمة مخمَّنة ستكون غير مميَّزة عن قيمة حقيقية وستفسد كل تقرير مبني عليها.",
    why_en: "The truth lives in another system: payment size, verification state, a booked appointment. None of it is visible in a WhatsApp thread, and a guessed value would be indistinguishable from a real one and corrupt every report built on it.",
  },
  manual: { ar: "يضعه موظف يدوياً", en: "Set by a human" },
};

export const LEAD_INTENT = ["hot", "warm", "cold"];

export default { SEVERITIES, SOURCES, LEAD_INTENT };
