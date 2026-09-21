import { createContext, useContext, useMemo, useState } from "react";

const Ctx = createContext(null);

const iso = (d) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));
const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };

export const PRESETS = [
  { key: "all", label: "كل الفترة", range: () => ({ since: "", until: "" }) },
  { key: "7", label: "آخر 7 أيام", range: () => ({ since: daysAgo(7), until: today() }) },
  { key: "30", label: "آخر 30 يوم", range: () => ({ since: daysAgo(30), until: today() }) },
  { key: "month", label: "هذا الشهر", range: () => ({ since: monthStart(), until: today() }) },
];

export function DateRangeProvider({ children }) {
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [preset, setPreset] = useState("all");

  const value = useMemo(() => {
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    return {
      since, until, preset,
      qs: params.toString(),
      setSince: (v) => { setSince(v); setPreset("custom"); },
      setUntil: (v) => { setUntil(v); setPreset("custom"); },
      applyPreset: (p) => { const r = p.range(); setSince(r.since); setUntil(r.until); setPreset(p.key); },
    };
  }, [since, until, preset]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useDateRange = () => useContext(Ctx);
export default DateRangeProvider;
