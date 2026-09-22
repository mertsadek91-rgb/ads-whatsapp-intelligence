// Derive a customer's country from their WhatsApp phone number's international
// dialing code. The Wati `country` field is empty for every contact, but the
// phone (E.164, no "+") is always present — so the dial code is the only
// reliable country signal we have. Dial codes are variable length (1-4
// digits) and some are prefixes of others, so match the LONGEST known code.
//
// ISO-2 is the join key with Meta's country breakdown (which reports ISO-2),
// so each entry carries iso2 alongside Arabic/English display names.
//
// Two dial codes are not countries, and treating them as one was the defect
// worth fixing here. An unmapped code yields null and is visibly blank on every
// board; these two produced a confident WRONG answer that flowed on into geo
// tagging, the Countries page and the Meta country join:
//
//   +1  is the North American Numbering Plan — the United States AND Canada AND
//       twenty-odd Caribbean and Pacific countries. It resolved to "US" with the
//       display name "أمريكا/كندا", a slash pair no ISO lookup can split, so a
//       Canadian lead was indistinguishable from an American one and a Jamaican
//       lead was recorded as American.
//   +7  is Russia AND Kazakhstan. It resolved to "RU" outright.
//
// Both are now decided by the digits that actually decide them. This stays a
// curated table rather than a full E.164 library because the table also carries
// Arabic names, and 240 hand-written Arabic country names would introduce more
// error than the coverage gap they close. If worldwide coverage is ever needed,
// libphonenumber-js resolves the ISO-2 and this table keeps the naming.

/** iso2 -> [Arabic, English]. The single source of display names. */
const NAMES = {
  AE: ["الإمارات", "UAE"], SA: ["السعودية", "Saudi Arabia"], KW: ["الكويت", "Kuwait"],
  QA: ["قطر", "Qatar"], BH: ["البحرين", "Bahrain"], OM: ["عُمان", "Oman"],
  JO: ["الأردن", "Jordan"], LB: ["لبنان", "Lebanon"], SY: ["سوريا", "Syria"],
  IQ: ["العراق", "Iraq"], YE: ["اليمن", "Yemen"], PS: ["فلسطين", "Palestine"],
  EG: ["مصر", "Egypt"], MA: ["المغرب", "Morocco"], DZ: ["الجزائر", "Algeria"],
  TN: ["تونس", "Tunisia"], LY: ["ليبيا", "Libya"], SD: ["السودان", "Sudan"],
  MR: ["موريتانيا", "Mauritania"], SO: ["الصومال", "Somalia"], DJ: ["جيبوتي", "Djibouti"],
  KM: ["جزر القمر", "Comoros"],
  TR: ["تركيا", "Turkey"], IR: ["إيران", "Iran"], PK: ["باكستان", "Pakistan"],
  IN: ["الهند", "India"], BD: ["بنغلاديش", "Bangladesh"], AF: ["أفغانستان", "Afghanistan"],
  NG: ["نيجيريا", "Nigeria"], KE: ["كينيا", "Kenya"], GH: ["غانا", "Ghana"],
  ZA: ["جنوب أفريقيا", "South Africa"],
  GB: ["بريطانيا", "United Kingdom"], FR: ["فرنسا", "France"], DE: ["ألمانيا", "Germany"],
  IT: ["إيطاليا", "Italy"], ES: ["إسبانيا", "Spain"],
  MY: ["ماليزيا", "Malaysia"], ID: ["إندونيسيا", "Indonesia"], PH: ["الفلبين", "Philippines"],
  CN: ["الصين", "China"],
  // +1 and +7, each now reachable on its own rather than folded into a neighbour.
  US: ["أمريكا", "United States"], CA: ["كندا", "Canada"],
  RU: ["روسيا", "Russia"], KZ: ["كازاخستان", "Kazakhstan"],
  // NANP members that are neither the US nor Canada. Each owns its area codes
  // outright, so each is exactly resolvable.
  BS: ["الباهاما", "Bahamas"], BB: ["بربادوس", "Barbados"], AI: ["أنغويلا", "Anguilla"],
  AG: ["أنتيغوا وبربودا", "Antigua and Barbuda"],
  VG: ["جزر العذراء البريطانية", "British Virgin Islands"],
  VI: ["جزر العذراء الأمريكية", "US Virgin Islands"], KY: ["جزر كايمان", "Cayman Islands"],
  BM: ["برمودا", "Bermuda"], GD: ["غرينادا", "Grenada"],
  TC: ["جزر تركس وكايكوس", "Turks and Caicos"], JM: ["جامايكا", "Jamaica"],
  MS: ["مونتسيرات", "Montserrat"], MP: ["جزر ماريانا الشمالية", "Northern Mariana Islands"],
  GU: ["غوام", "Guam"], AS: ["ساموا الأمريكية", "American Samoa"],
  SX: ["سانت مارتن", "Sint Maarten"], LC: ["سانت لوسيا", "Saint Lucia"],
  DM: ["دومينيكا", "Dominica"], VC: ["سانت فنسنت والغرينادين", "Saint Vincent and the Grenadines"],
  PR: ["بورتوريكو", "Puerto Rico"], DO: ["الدومينيكان", "Dominican Republic"],
  TT: ["ترينيداد وتوباغو", "Trinidad and Tobago"], KN: ["سانت كيتس ونيفيس", "Saint Kitts and Nevis"],
};

/** Dial code -> iso2, for codes a prefix alone decides. */
const DIAL = {
  "971": "AE", "966": "SA", "965": "KW", "974": "QA", "973": "BH", "968": "OM",
  "962": "JO", "961": "LB", "963": "SY", "964": "IQ", "967": "YE", "970": "PS",
  "20": "EG", "212": "MA", "213": "DZ", "216": "TN", "218": "LY", "249": "SD",
  "222": "MR", "252": "SO", "253": "DJ", "269": "KM",
  "90": "TR", "98": "IR", "92": "PK", "91": "IN", "880": "BD", "93": "AF",
  "234": "NG", "254": "KE", "233": "GH", "27": "ZA",
  "44": "GB", "33": "FR", "49": "DE", "39": "IT", "34": "ES",
  "60": "MY", "62": "ID", "63": "PH", "86": "CN",
};

// NANP area code -> the country holding it. The United States is the default
// for anything unlisted: it holds the large majority of the plan's area codes,
// and an unlisted US code and a newly-allocated US code both want "US" anyway.
const NANP = {
  // Canada, enumerated in full — Canada no longer being recorded as the United
  // States is the entire point of this table.
  204: "CA", 226: "CA", 236: "CA", 249: "CA", 250: "CA", 263: "CA", 289: "CA",
  306: "CA", 343: "CA", 354: "CA", 365: "CA", 367: "CA", 368: "CA", 382: "CA",
  387: "CA", 403: "CA", 416: "CA", 418: "CA", 428: "CA", 431: "CA", 437: "CA",
  438: "CA", 450: "CA", 468: "CA", 474: "CA", 506: "CA", 514: "CA", 519: "CA",
  548: "CA", 579: "CA", 581: "CA", 584: "CA", 587: "CA", 604: "CA", 613: "CA",
  639: "CA", 647: "CA", 672: "CA", 683: "CA", 705: "CA", 709: "CA", 742: "CA",
  753: "CA", 778: "CA", 780: "CA", 782: "CA", 807: "CA", 819: "CA", 825: "CA",
  867: "CA", 873: "CA", 879: "CA", 902: "CA", 905: "CA",
  // Caribbean, Atlantic and Pacific members.
  242: "BS", 246: "BB", 264: "AI", 268: "AG", 284: "VG", 340: "VI", 345: "KY",
  441: "BM", 473: "GD", 649: "TC", 658: "JM", 664: "MS", 670: "MP", 671: "GU",
  684: "AS", 721: "SX", 758: "LC", 767: "DM", 784: "VC", 787: "PR", 809: "DO",
  829: "DO", 849: "DO", 868: "TT", 869: "KN", 876: "JM", 939: "PR",
};

/**
 * +1 — North American Numbering Plan. The three digits after the country code
 * are the area code, and the area code is what names the country.
 */
function resolveNanp(rest) {
  if (rest.length < 3) return null;     // too short to say, and guessing is the old bug
  return NANP[Number(rest.slice(0, 3))] || "US";
}

/**
 * +7 — shared by Russia and Kazakhstan. Kazakhstan holds the 6xx and 7xx
 * ranges (7 7xx is its mobile range); Russia holds the rest, including the 9xx
 * range that nearly every Russian mobile uses.
 */
function resolveSeven(rest) {
  if (!rest.length) return null;
  return rest[0] === "6" || rest[0] === "7" ? "KZ" : "RU";
}

const SPLIT = { 1: resolveNanp, 7: resolveSeven };

// Longest dial codes first so longest-prefix wins (971 before a shorter 97x,
// 20 before a shorter 2x). Both split codes are single digits, so they sort
// last and can never shadow a longer code.
const CODES = [...Object.keys(DIAL), ...Object.keys(SPLIT)]
  .sort((a, b) => b.length - a.length);

const UNKNOWN = { iso2: null, ar: "غير محدَّد", en: "Unknown", flag: "🏳️" };

/** ISO-2 -> flag emoji via regional-indicator symbols (no image assets). */
export function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return "🏳️";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + (iso2.charCodeAt(0) - 65), A + (iso2.charCodeAt(1) - 65));
}

/** The public shape for an iso2, or the Unknown bucket. */
function describeCountry(iso2) {
  const name = iso2 && NAMES[iso2];
  if (!name) return { ...UNKNOWN };
  return { iso2, ar: name[0], en: name[1], flag: flagEmoji(iso2) };
}

/** phone (any format) -> { iso2, ar, en, flag }. Unknown/empty -> UNKNOWN. */
export function countryOf(phone) {
  const digits = String(phone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return { ...UNKNOWN };
  for (const code of CODES) {
    if (!digits.startsWith(code)) continue;
    const iso2 = SPLIT[code] ? SPLIT[code](digits.slice(code.length)) : DIAL[code];
    return describeCountry(iso2);
  }
  return { ...UNKNOWN };
}

// The full country list for the employee-directory multi-select (deduped by
// ISO-2, sorted by Arabic name). Same vocabulary countryOf() resolves to.
export const COUNTRIES = (() => {
  const reachable = new Set([...Object.values(DIAL), ...Object.values(NANP), "US", "RU", "KZ"]);
  return [...reachable]
    .map((iso2) => describeCountry(iso2))
    .filter((c) => c.iso2)
    .sort((a, b) => a.ar.localeCompare(b.ar, "ar"));
})();

export default { countryOf, flagEmoji, COUNTRIES };
