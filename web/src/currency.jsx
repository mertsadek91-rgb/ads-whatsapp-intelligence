// Currency display switcher (BUG-022 fix). Amounts are stored and computed
// server-side in ONE currency — the ad account's billing currency — and this
// only converts what is DISPLAYED, using a static, admin-edited rate (no live
// FX API). Mirrors i18n.jsx's provider pattern: a small context, a persisted
// choice in localStorage, one hook.
//
// The base used to be hardcoded as AED on both sides. On an account billed in
// anything else, every figure shown was the stored number multiplied by a rate
// that did not apply to it. The server now says what the base is; this asks.
import { createContext, useContext, useEffect, useState } from "react";
import api from "./api.js";

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  // AED until the server says otherwise: it is what every installation
  // predating this stored, so the fallback changes nothing under them.
  const [base, setBase] = useState("AED");
  const [currency, setCurrency] = useState(() => localStorage.getItem("currency") || "");
  const [currencies, setCurrencies] = useState([{ code: "AED", symbol: "د.إ", name_ar: "درهم إماراتي", name_en: "UAE Dirham" }]);
  const [rates, setRates] = useState({ AED: 1 });

  useEffect(() => {
    // Keep the built-in defaults unless the response actually carries data —
    // a malformed/empty payload used to blank `currencies` and crash every
    // page that formats money (currencies[0] became undefined).
    api.get("/settings/currency").then((d) => {
      if (Array.isArray(d?.currencies) && d.currencies.length) setCurrencies(d.currencies);
      if (d?.rates && typeof d.rates === "object") setRates(d.rates);
      if (typeof d?.base === "string" && d.base) setBase(d.base);
    }).catch(() => {});
  }, []);
  useEffect(() => { if (currency) localStorage.setItem("currency", currency); }, [currency]);

  // Nobody has chosen one yet: show the currency the numbers are already in,
  // which needs no conversion and therefore cannot be wrong.
  const selected = currency || base;

  async function saveRates(newRates) {
    const d = await api.post("/settings/currency", { rates: newRates });
    setRates(d.rates);
    if (typeof d?.base === "string" && d.base) setBase(d.base);
    return d.rates;
  }

  const meta = currencies.find((c) => c.code === selected) || currencies[0];
  // The base converts to itself. Reading it out of `rates` would work too, but
  // only because sanitizeRates pins it — this does not depend on that.
  const rate = selected === base ? 1 : (rates[selected] || 1);

  /**
   * Converts a stored amount (in `base`) to the selected currency and formats
   * it with the symbol. The parameter is no longer named aedAmount: it is
   * whatever the account bills in, which is the whole point.
   */
  function money(amount, { decimals = 0 } = {}) {
    if (amount == null || amount === "") return "—";
    const converted = Number(amount) * rate;
    const formatted = converted.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return `${formatted} ${meta?.symbol || currency}`;
  }

  return (
    <CurrencyContext.Provider
      value={{ currency: selected, setCurrency, base, currencies, rates, saveRates, money }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export const useCurrency = () => useContext(CurrencyContext);
export default CurrencyProvider;
