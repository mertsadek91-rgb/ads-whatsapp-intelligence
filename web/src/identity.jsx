// What this installation calls itself, for the shell, the login page and the
// wall displays.
//
// Deliberately mirrors currency.jsx: a context, one fetch on mount, and
// built-in defaults that render correctly if the request never returns — the
// app name must never be the reason a page fails to draw.
import { createContext, useContext, useEffect, useState } from "react";

const DEFAULTS = {
  appName: "لوحة التحليلات",
  appNameEn: "Analytics",
  tagline: "الإعلانات × واتساب",
  taglineEn: "Ads × WhatsApp",
  monogram: "AW",
  logoUrl: null,
  primaryColor: null,
};

const Ctx = createContext({ identity: DEFAULTS, reload: () => {} });

export function IdentityProvider({ children }) {
  const [identity, setIdentity] = useState(DEFAULTS);

  async function load() {
    try {
      // Public on purpose: the login screen renders before any session exists.
      const r = await fetch("/api/identity", { credentials: "same-origin" });
      if (!r.ok) return;
      const d = await r.json();
      setIdentity({ ...DEFAULTS, ...d });
    } catch { /* keep the defaults */ }
  }

  useEffect(() => { load(); }, []);

  // One custom property recolours the whole shell, because the stylesheet is
  // entirely token-driven. Only a hex value ever reaches here — the server
  // rejects anything else, since this is interpolated into CSS.
  useEffect(() => {
    if (identity.primaryColor) {
      document.documentElement.style.setProperty("--primary", identity.primaryColor);
    } else {
      document.documentElement.style.removeProperty("--primary");
    }
  }, [identity.primaryColor]);

  return <Ctx.Provider value={{ identity, reload: load }}>{children}</Ctx.Provider>;
}

export function useIdentity() { return useContext(Ctx); }

/** The name in the language being rendered, with a safe fallback. */
export function brandName(identity, lang) {
  return (lang === "en" ? identity.appNameEn : identity.appName) || identity.appName || DEFAULTS.appName;
}
export function brandTagline(identity, lang) {
  return (lang === "en" ? identity.taglineEn : identity.tagline) || "";
}

export default IdentityProvider;
