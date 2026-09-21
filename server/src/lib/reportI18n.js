// One place for every label the SERVER emits into a report, an export, or an
// email — column headers, enum values, and the handful of sentinel strings that
// live in the database as Arabic literals.
//
// Why this exists: the web app has its own dictionary (web/src/i18n.jsx) and it
// covers the UI chrome, but a CSV downloaded from the server carried raw
// snake_case DB column names, and a PDF printed `hot` / `awaiting_human`
// verbatim. Those are report *cells*, so they have to follow the report's
// language just like its headings do. Anything rendered server-side resolves
// its text here.
//
// Keys are the DB column / enum values, so a route can hand a column list
// straight to `headers()` without maintaining a parallel list.

export const LANGS = ["ar", "en"];
export const asLang = (v) => (v === "en" ? "en" : "ar");

/** Report language for a request: explicit ?lang wins, then Accept-Language. */
export function langOf(req) {
  const q = req?.query?.lang ?? req?.body?.lang;
  if (q === "en" || q === "ar") return q;
  const header = String(req?.headers?.["accept-language"] || "");
  return /^\s*en\b/i.test(header) ? "en" : "ar";
}

// ---------------------------------------------------------------- field labels
const FIELDS = {
  // identity
  wa_id: ["معرّف واتساب", "WhatsApp ID"],
  full_name: ["الاسم", "Name"],
  name: ["الاسم", "Name"],
  phone: ["الهاتف", "Phone"],
  country: ["الدولة", "Country"],
  country_iso2: ["الدولة", "Country"],
  contact_owner: ["المسؤول", "Owner"],
  // lifecycle
  stage: ["المرحلة", "Stage"],
  lead_score: ["درجة العميل", "Lead score"],
  score_band: ["التصنيف", "Band"],
  account_type: ["نوع الحساب", "Account type"],
  deposit_count: ["عدد الإيداعات", "Deposits"],
  deposit_total_aed: ["إجمالي الإيداعات", "Deposit total"],
  review_status: ["حالة المراجعة", "Review status"],
  notes: ["ملاحظات", "Notes"],
  created_date: ["تاريخ الإنشاء", "Created"],
  last_message_at: ["آخر رسالة", "Last message"],
  last_activity: ["آخر نشاط", "Last activity"],
  num_messages: ["عدد الرسائل", "Messages"],
  customer_msgs: ["رسائل العميل", "Customer messages"],
  // attribution
  ad_name: ["الإعلان", "Ad"],
  campaign_name: ["الحملة", "Campaign"],
  post_url: ["رابط البوست", "Post URL"],
  // analysis
  date: ["التاريخ", "Date"],
  agent_score: ["درجة الموظف", "Agent score"],
  conv_score: ["جودة المحادثة", "Conversation quality"],
  conv_type: ["تصنيف المحادثة", "Conversation type"],
  lead_intent: ["النيّة", "Intent"],
  lead_status: ["النتيجة", "Result"],
  wrong_persuasion: ["إقناع خاطئ", "Wrong persuasion"],
  follow_up_min: ["زمن المتابعة (د)", "Follow-up (min)"],
  message_count: ["عدد الرسائل", "Messages"],
  summary: ["الملخّص", "Summary"],
};

/** Localized header for one DB column; falls back to the raw key if unmapped. */
export function fieldLabel(col, lang) {
  const e = FIELDS[col];
  return e ? e[asLang(lang) === "en" ? 1 : 0] : col;
}

/** Localized header row for a column list — what the CSV writer wants. */
export function headers(cols, lang) {
  return cols.map((c) => fieldLabel(c, lang));
}

// ----------------------------------------------------------------- enum labels
const ENUMS = {
  lead_intent: {
    hot: ["ساخن", "Hot"], warm: ["دافئ", "Warm"], cold: ["بارد", "Cold"],
  },
  score_band: {
    hot: ["ساخن", "Hot"], warm: ["دافئ", "Warm"], cold: ["بارد", "Cold"],
  },
  // The full vocabulary as it actually occurs in the database, not just the
  // values the UI filters on — `new` and `engaged` are the two biggest buckets
  // and used to print raw in both languages.
  stage: {
    new: ["جديد", "New"], engaged: ["متفاعل", "Engaged"],
    qualified: ["مؤهّل", "Qualified"], interested: ["مهتم", "Interested"],
    demo: ["تجريبي", "Demo"], deposit: ["إيداع", "Deposit"],
  },
  conv_type: {
    bot_only: ["بوت فقط", "Bot only"], human_handled: ["تعامل بشري", "Human handled"],
    awaiting_human: ["ينتظر موظفاً", "Awaiting human"], abandoned: ["مهجورة", "Abandoned"],
    no_customer: ["لا رسائل من العميل", "No customer messages"],
    not_synced: ["لم تُزامن", "Not synced"],
  },
  account_type: {
    demo: ["تجريبي", "Demo"], real: ["حقيقي", "Real"], unknown: ["غير معروف", "Unknown"],
  },
  deposit_intent: {
    yes: ["نعم", "Yes"], no: ["لا", "No"], unknown: ["غير معروف", "Unknown"],
  },
  review_status: {
    new: ["جديد", "New"], pending: ["قيد المراجعة", "Pending"],
    approved: ["مقبول", "Approved"], rejected: ["مرفوض", "Rejected"],
  },
  opening_quality: {
    weak: ["ضعيف", "Weak"], adequate: ["مقبول", "Adequate"], strong: ["قوي", "Strong"],
  },
  bool: { 1: ["نعم", "Yes"], 0: ["لا", "No"], true: ["نعم", "Yes"], false: ["لا", "No"] },
};

/**
 * Localized label for an enum value. Unknown values pass through unchanged —
 * an unmapped value should stay visible in the report, not become a blank.
 */
export function enumLabel(group, value, lang) {
  if (value == null || value === "") return "";
  const e = ENUMS[group]?.[String(value)];
  return e ? e[asLang(lang) === "en" ? 1 : 0] : String(value);
}

/** Column -> enum group, for exports that want values translated automatically. */
const COL_ENUM = {
  lead_intent: "lead_intent", score_band: "score_band", stage: "stage",
  conv_type: "conv_type", account_type: "account_type", review_status: "review_status",
  wrong_persuasion: "bool",
};

const DATE_COLS = new Set(["date", "created_date", "last_message_at", "last_activity", "analyzed_at", "sent_at"]);

/**
 * mysql2 hands back JS Date objects, and letting one stringify itself put
 * "Tue Jun 16 2026 04:00:00 GMT+0400 (Gulf Standard Time)" in the cell — long,
 * locale-dependent, and not something Excel recognizes as a date. A fixed
 * `YYYY-MM-DD HH:mm` is unambiguous, sorts as text, and parses in both locales.
 */
export function fmtDateCell(v) {
  if (v == null || v === "") return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return time === "00:00" ? date : `${date} ${time}`;
}

/** Value formatter for `streamCsv`: translates enums and normalizes dates. */
export function cellMapper(lang) {
  return (col, value) => {
    if (DATE_COLS.has(col)) return fmtDateCell(value);
    const group = COL_ENUM[col];
    return group ? enumLabel(group, value, lang) : value;
  };
}

// -------------------------------------------------------------- DB sentinels
// `agentName.js` writes this literal for conversations where the AI could not
// identify a human agent, and a couple of GROUP BY queries coalesce to it. It
// is a stored value, so it stays Arabic at rest and gets translated on the way
// out rather than being migrated.
export const UNKNOWN_AGENT_AR = "(غير معروف)";
const UNKNOWN_AGENT = { ar: UNKNOWN_AGENT_AR, en: "(unknown)" };
const UNASSIGNED = { ar: "(غير مُسند)", en: "(unassigned)" };

/** Agent display name: translates the unknown/unassigned sentinels only. */
export function agentLabel(name, lang) {
  const l = asLang(lang);
  if (name == null || String(name).trim() === "") return UNASSIGNED[l];
  const s = String(name).trim();
  if (s === UNKNOWN_AGENT_AR || s === "(unknown)") return UNKNOWN_AGENT[l];
  return s;
}

export default {
  asLang, langOf, fieldLabel, headers, enumLabel, cellMapper, agentLabel, fmtDateCell, LANGS,
};
