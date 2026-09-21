// Currency display switcher (BUG-022 fix). Every amount is stored/computed
// in AED server-side — this only converts what's DISPLAYED, using a static,
// admin-edited exchange rate (no live FX API). Mirrors i18n.jsx's provider
// pattern: a small context, persisted choice in localStorage, one hook.
import { createContext, useContext, useEffect, useState } from "react";
import api from "./api.js";

const CurrencyContext = createContext(null);

export function CurrencyProvider({ children }) {
  const [currency, setCurrency] = useState(() => localStorage.getItem("currency") || "AED");
  const [currencies, setCurrencies] = useState([{ code: "AED", symbol: "د.إ", name_ar: "درهم إماراتي", name_en: "UAE Dirham" }]);
  const [rates, setRates] = useState({ AED: 1 });

  useEffect(() => {
    // Keep the built-in defaults unless the response actually carries data —
    // a malformed/empty payload used to blank `currencies` and crash every
    // page that formats money (currencies[0] became undefined).
    api.get("/settings/currency").then((d) => {
      if (Array.isArray(d?.currencies) && d.currencies.length) setCurrencies(d.currencies);
      if (d?.rates && typeof d.rates === "object") setRates(d.rates);
    }).catch(() => {});
  }, []);
  useEffect(() => { localStorage.setItem("currency", currency); }, [currency]);

  async function saveRates(newRates) {
    const d = await api.post("/settings/currency", { rates: newRates });
    setRates(d.rates);
    return d.rates;
  }

  const meta = currencies.find((c) => c.code === currency) || currencies[0];
  const rate = rates[currency] || 1;

  /** Converts an AED amount to the selected currency and formats it with the symbol. */
  function money(aedAmount, { decimals = 0 } = {}) {
    if (aedAmount == null || aedAmount === "") return "—";
    const converted = Number(aedAmount) * rate;
    const formatted = converted.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return `${formatted} ${meta?.symbol || currency}`;
  }

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, currencies, rates, saveRates, money }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export const useCurrency = () => useContext(CurrencyContext);
export default CurrencyProvider;
