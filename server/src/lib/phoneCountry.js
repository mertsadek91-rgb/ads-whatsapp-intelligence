// Derive a customer's country from their WhatsApp phone number's international
// dialing code. The Wati `country` field is empty for every contact, but the
// phone (E.164, no "+") is always present — so the dial code is the only
// reliable country signal we have. Dial codes are variable length (1-4
// digits) and some are prefixes of others, so match the LONGEST known code.
//
// ISO-2 is the join key with Meta's country breakdown (which reports ISO-2),
// so each entry carries iso2 alongside Arabic/English display names.

// Ordered longest-first at build time so the first match is the longest.
const DIAL = {
  // Gulf + Levant + North Africa (this account's core audience)
  "971": ["AE", "الإمارات", "UAE"],
  "966": ["SA", "السعودية", "Saudi Arabia"],
  "965": ["KW", "الكويت", "Kuwait"],
  "974": ["QA", "قطر", "Qatar"],
  "973": ["BH", "البحرين", "Bahrain"],
  "968": ["OM", "عُمان", "Oman"],
  "962": ["JO", "الأردن", "Jordan"],
  "961": ["LB", "لبنان", "Lebanon"],
  "963": ["SY", "سوريا", "Syria"],
  "964": ["IQ", "العراق", "Iraq"],
  "967": ["YE", "اليمن", "Yemen"],
  "970": ["PS", "فلسطين", "Palestine"],
  "20": ["EG", "مصر", "Egypt"],
  "212": ["MA", "المغرب", "Morocco"],
  "213": ["DZ", "الجزائر", "Algeria"],
  "216": ["TN", "تونس", "Tunisia"],
  "218": ["LY", "ليبيا", "Libya"],
  "249": ["SD", "السودان", "Sudan"],
  "222": ["MR", "موريتانيا", "Mauritania"],
  "252": ["SO", "الصومال", "Somalia"],
  "253": ["DJ", "جيبوتي", "Djibouti"],
  "269": ["KM", "جزر القمر", "Comoros"],
  // Broader (leads occasionally come from these)
  "90": ["TR", "تركيا", "Turkey"],
  "98": ["IR", "إيران", "Iran"],
  "92": ["PK", "باكستان", "Pakistan"],
  "91": ["IN", "الهند", "India"],
  "880": ["BD", "بنغلاديش", "Bangladesh"],
  "93": ["AF", "أفغانستان", "Afghanistan"],
  "234": ["NG", "نيجيريا", "Nigeria"],
  "254": ["KE", "كينيا", "Kenya"],
  "233": ["GH", "غانا", "Ghana"],
  "27": ["ZA", "جنوب أفريقيا", "South Africa"],
  "44": ["GB", "بريطانيا", "United Kingdom"],
  "33": ["FR", "فرنسا", "France"],
  "49": ["DE", "ألمانيا", "Germany"],
  "39": ["IT", "إيطاليا", "Italy"],
  "34": ["ES", "إسبانيا", "Spain"],
  "1": ["US", "أمريكا/كندا", "USA/Canada"],
  "7": ["RU", "روسيا", "Russia"],
  "60": ["MY", "ماليزيا", "Malaysia"],
  "62": ["ID", "إندونيسيا", "Indonesia"],
  "63": ["PH", "الفلبين", "Philippines"],
  "86": ["CN", "الصين", "China"],
};
// Longest dial codes first so longest-prefix wins (e.g. 971 before 97-nothing,
// 20 before 2-nothing, 966 before 96-nothing).
const CODES = Object.keys(DIAL).sort((a, b) => b.length - a.length);

const UNKNOWN = { iso2: null, ar: "غير محدَّد", en: "Unknown", flag: "🏳️" };

/** ISO-2 -> flag emoji via regional-indicator symbols (no image assets). */
export function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return "🏳️";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + (iso2.charCodeAt(0) - 65), A + (iso2.charCodeAt(1) - 65));
}

/** phone (any format) -> { iso2, ar, en, flag }. Unknown/empty -> UNKNOWN. */
export function countryOf(phone) {
  const digits = String(phone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return { ...UNKNOWN };
  for (const code of CODES) {
    if (digits.startsWith(code)) {
      const [iso2, ar, en] = DIAL[code];
      return { iso2, ar, en, flag: flagEmoji(iso2) };
    }
  }
  return { ...UNKNOWN };
}

// The full country list for the employee-directory multi-select (deduped by
// ISO-2, sorted by Arabic name). Same vocabulary countryOf() resolves to.
export const COUNTRIES = (() => {
  const seen = new Set();
  const out = [];
  for (const [iso2, ar, en] of Object.values(DIAL)) {
    if (seen.has(iso2)) continue;
    seen.add(iso2);
    out.push({ iso2, ar, en, flag: flagEmoji(iso2) });
  }
  return out.sort((a, b) => a.ar.localeCompare(b.ar, "ar"));
})();

export default { countryOf, flagEmoji, COUNTRIES };
