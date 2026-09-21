// Public wall-display (kiosk) route: /screen/salesboard?token=... — no login.
// Fetches the token-gated public endpoint and auto-refreshes every 60s so the
// TV always shows the latest (the server re-syncs the underlying data every
// 30 min). Rendered outside the app Layout/auth gate.
import { useEffect, useState, useCallback, useRef } from "react";
import SalesBoard from "../components/SalesBoard.jsx";
import { translate } from "../i18n.jsx";

const REFRESH_MS = 60000;
// The public wall-display is English-only, regardless of the app language.
const SCREEN_LANG = "en";

export default function SalesScreen() {
  const t = (s, vars) => translate(s, SCREEN_LANG, vars);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [updated, setUpdated] = useState(null);
  const [, tick] = useState(0);
  // Short stable link is /tv/<code>; legacy /screen/salesboard?token=<code> works too.
  const pathCode = (window.location.pathname.match(/^\/tv\/([^/]+)/) || [])[1];
  const qs = new URLSearchParams(window.location.search);
  const token = decodeURIComponent(pathCode || qs.get("token") || qs.get("k") || "");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/public/salesboard?token=${encodeURIComponent(token)}`, { credentials: "omit" });
      if (!r.ok) { setErr(r.status === 401 ? "invalid-token" : "server"); return; }
      setData(await r.json()); setErr(""); setUpdated(new Date());
    } catch { setErr("network"); }
  }, [token]);

  useEffect(() => { load(); const id = setInterval(load, REFRESH_MS); return () => clearInterval(id); }, [load]);
  // Re-render the live clock every 30s.
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(id); }, []);
  const liveRef = useRef();

  if (err === "invalid-token") {
    return <div style={{ background: "#f4f7fb", color: "#dc2626", minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "Cairo,sans-serif", fontSize: 22 }}>
      {t("رابط غير صالح — اطلب رابط شاشة جديداً من الإدارة.")}
    </div>;
  }
  if (!data) {
    return <div style={{ background: "#f4f7fb", color: "#64748b", minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "Cairo,sans-serif", fontSize: 22 }}>
      {t("جارٍ التحميل…")}
    </div>;
  }
  const updatedLabel = updated ? `${t("آخر تحديث")}: ${updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "";
  return <div ref={liveRef} style={{ background: "#f4f7fb", minHeight: "100vh" }}><SalesBoard data={data} updatedLabel={updatedLabel} lang={SCREEN_LANG} /></div>;
}
