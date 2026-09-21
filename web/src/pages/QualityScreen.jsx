// Public wall-display for the quality board: /screen/quality?token=... and the
// short /tv/<code>/quality. No login — the token is checked server-side, and the
// payload it returns is already sanitized (no evidence, no customer data).
//
// Keeps the last good payload on a failed refresh: a network blip on a wall
// display should leave the previous numbers up, not blank the screen the whole
// floor is looking at.
import { useEffect, useState, useCallback } from "react";
import QualityBoard from "../components/QualityBoard.jsx";

const REFRESH_MS = 45000;

const Center = ({ color, children }) => (
  <div style={{ background: "#f4f7fb", color, height: "100dvh", display: "grid", placeItems: "center",
    fontFamily: "Inter,Cairo,sans-serif", fontSize: 22, textAlign: "center", padding: 24 }}>{children}</div>
);

export default function QualityScreen() {
  const [data, setData] = useState(null);
  const [fatal, setFatal] = useState("");
  const [stale, setStale] = useState(false);
  const [updated, setUpdated] = useState(null);

  // /tv/<code>/quality is the short link; ?token= also works.
  const pathCode = (window.location.pathname.match(/^\/tv\/([^/]+)/) || [])[1];
  const qs = new URLSearchParams(window.location.search);
  const token = decodeURIComponent(pathCode || qs.get("token") || qs.get("k") || "");
  const days = Number(qs.get("days")) || 7;

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/public/quality?token=${encodeURIComponent(token)}&days=${days}`, { credentials: "omit" });
      if (r.status === 401) { setFatal("invalid-token"); return; }
      if (!r.ok) { setStale(true); return; }
      setData(await r.json()); setStale(false); setUpdated(new Date());
    } catch { setStale(true); }
  }, [token, days]);

  useEffect(() => { load(); const id = setInterval(load, REFRESH_MS); return () => clearInterval(id); }, [load]);

  if (fatal === "invalid-token") {
    return <Center color="#dc2626">Invalid screen link — ask management for a new one.</Center>;
  }
  if (!data) return <Center color="#64748b">Loading the quality board…</Center>;

  const label = updated
    ? `${stale ? "Stale · " : ""}Updated ${updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : "";
  return <QualityBoard data={data} updatedLabel={label} />;
}
