// How far back an import reads — one operator decision, two very different
// sources underneath.
//
// The stored value is a single string with three meanings, because that is how
// the question is actually asked ("since when do you want data?") and storing
// a date plus a separate "everything" flag lets the two disagree:
//
//   ""            the default window. Whatever the install has always used
//                 (META_LOOKBACK_DAYS, 120 days out of the box). Leaving an
//                 existing .env install alone must not silently change what it
//                 imports, so blank keeps meaning exactly what it meant.
//   "all"         everything each source will give us.
//   "YYYY-MM-DD"  from that day.
//
// What each source can honour differs, and pretending otherwise is how you get
// a UI that promises data nobody can fetch:
//
//   Meta   retains ad insights for about 37 months. A request for 2015 is not
//          an error, it just returns nothing, so "all" is clamped to that.
//   Wati   getContacts has no date filter at all — the contact list is always
//          read whole. The date therefore bounds the expensive half: which
//          contacts we pull the message thread for (one request each).
export const ALL = "all";

/** Roughly how far back Meta's insights go. */
export const META_MAX_MONTHS = 37;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));

/**
 * Coerce anything an API caller or an old config row might hold into one of the
 * three shapes above. An unparseable value becomes "" (the default window)
 * rather than throwing: a bad settings row must not stop the nightly import.
 */
export function normalizeSince(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "";
  if (s === ALL || s === "*") return ALL;
  if (DATE.test(s)) return s;
  // Accept a full timestamp, which is what a browser date control sometimes
  // sends and what a copied value from a log looks like.
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : ymd(d);
}

/** The `since` date to ask Meta for, given the live config. Always a date. */
export function metaSince(config) {
  const v = normalizeSince(config?.data?.since);
  const floor = daysAgo(META_MAX_MONTHS * 30);
  if (v === ALL) return floor;
  if (v) return v < floor ? floor : v;
  const days = Number(config?.meta?.lookbackDays) || 120;
  return daysAgo(days);
}

/**
 * The earliest contact-creation date whose WhatsApp thread is worth fetching,
 * or null for no lower bound. Null for both "" and "all": the default window is
 * a Meta reporting window, not a reason to throw away conversation history.
 */
export function watiSince(config) {
  const v = normalizeSince(config?.data?.since);
  return v && v !== ALL ? new Date(`${v}T00:00:00Z`) : null;
}

/** One line for a log or a status panel, in both languages. */
export function describeRange(config) {
  const v = normalizeSince(config?.data?.since);
  const msgs = !!config?.data?.watiMessages;
  const ar = v === ALL ? "كل البيانات المتاحة"
    : v ? `منذ ${v}`
    : `آخر ${Number(config?.meta?.lookbackDays) || 120} يوماً`;
  const en = v === ALL ? "all available data"
    : v ? `since ${v}`
    : `the last ${Number(config?.meta?.lookbackDays) || 120} days`;
  return {
    since: v, watiMessages: msgs, metaSince: metaSince(config),
    ar: `${ar}${msgs ? "، مع سجلّ محادثات واتساب" : "، بدون سجلّ المحادثات"}`,
    en: `${en}${msgs ? ", including WhatsApp message history" : ", without message history"}`,
  };
}

export default { ALL, normalizeSince, metaSince, watiSince, describeRange, META_MAX_MONTHS };
