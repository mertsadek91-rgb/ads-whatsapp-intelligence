// Currency display switcher (BUG-022 fix). All amounts are stored in AED —
// this only affects DISPLAY: a static, manually-set exchange rate (admin-
// editable in Settings, no live FX API) converts AED figures to whichever
// currency the viewer picked. Rate = how many units of that currency equal
// 1 AED (so displayAmount = amountInAed * rate).
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
// these in Settings; they are never fetched live. AED is always fixed at 1.
export const DEFAULT_RATES = {
  AED: 1, USD: 0.272, EUR: 0.25, GBP: 0.215, SAR: 1.02,
  KWD: 0.0835, QAR: 0.99, BHD: 0.1025, OMR: 0.105, EGP: 13.4,
};

const CODES = new Set(CURRENCIES.map((c) => c.code));

/** Whitelist-or-drop clamp for a saved rates object — never persist a currency outside the known list. */
export function sanitizeRates(input) {
  const out = {};
  for (const [code, rate] of Object.entries(input || {})) {
    if (CODES.has(code) && Number.isFinite(Number(rate)) && Number(rate) > 0) out[code] = Number(rate);
  }
  out.AED = 1; // AED is the storage base currency — always fixed, never trust client input for it
  return out;
}

export default { CURRENCIES, DEFAULT_RATES, sanitizeRates };
