// Currency display switcher (BUG-022 fix). Amounts are stored in ONE currency
// — the ad account's billing currency, see lib/money.js — and this converts
// them for display only, using a static, admin-edited rate (no live FX API).
// Rate = how many units of that currency equal 1 unit of the base
// (displayAmount = storedAmount * rate), so the base itself is always 1.
//
// The base used to be hardcoded as AED here and in the browser. On a
// USD-billed ad account that silently multiplied dollars by a dirham rate.
export const CURRENCIES = [
  { code: "AED", symbol: "د.إ", name_ar: "درهم إماراتي", name_en: "UAE Dirham" },
  { code: "USD", symbol: "$", name_ar: "دولار أمريكي", name_en: "US Dollar" },
  { code: "EUR", symbol: "€", name_ar: "يورو", name_en: "Euro" },
  { code: "GBP", symbol: "£", name_ar: "جنيه إسترليني", name_en: "British Pound" },
  { code: "SAR", symbol: "﷼", name_ar: "ريال سعودي", name_en: "Saudi Riyal" },
  { code: "KWD", symbol: "د.ك", name_ar: "دينار كويتي", name_en: "Kuwaiti Dinar" },
  { code: "QAR", symbol: "ر.ق", name_ar: "ريال قطري", name_en: "Qatari Riyal" },
  { code: "BHD", symbol: "د.ب", name_ar: "دينار بحريني", name_en: "Bahraini Dinar" },
  { code: "OMR", symbol: "ر.ع", name_ar: "ريال عماني", name_en: "Omani Rial" },
  { code: "EGP", symbol: "ج.م", name_ar: "جنيه مصري", name_en: "Egyptian Pound" },
];

// Approximate starting rates (1 AED = X of that currency) — the admin edits
// these in Settings; they are never fetched live. They assume an AED base,
// which is the historical default; on any other base they are simply wrong
// until an admin edits them, and the Settings page says so rather than
// pretending a converted figure is meaningful.
export const DEFAULT_RATES = {
  AED: 1, USD: 0.272, EUR: 0.25, GBP: 0.215, SAR: 1.02,
  KWD: 0.0835, QAR: 0.99, BHD: 0.1025, OMR: 0.105, EGP: 13.4,
};

const CODES = new Set(CURRENCIES.map((c) => c.code));

/**
 * Whitelist-or-drop clamp for a saved rates object — never persist a currency
 * outside the known list, and always pin the BASE to exactly 1.
 *
 * The base is a parameter rather than the constant AED it used to be: on a
 * USD-billed installation, pinning AED to 1 made the stored currency itself
 * convertible and left USD — the currency the numbers are actually in — being
 * multiplied by a rate. Every figure on every board was then wrong by that
 * factor, with nothing on screen to suggest it.
 */
export function sanitizeRates(input, base = "AED") {
  const b = CODES.has(base) ? base : "AED";
  const out = {};
  for (const [code, rate] of Object.entries(input || {})) {
    if (CODES.has(code) && Number.isFinite(Number(rate)) && Number(rate) > 0) out[code] = Number(rate);
  }
  out[b] = 1;   // the stored currency converts to itself; never trust client input for it
  return out;
}

export default { CURRENCIES, DEFAULT_RATES, sanitizeRates };
