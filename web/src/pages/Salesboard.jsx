// In-app (authed) sales leaderboard: shows the same board managers see on the
// wall, plus the kiosk-link controls — copy the public /screen link for the TV,
// or rotate the token to invalidate an old link.
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useI18n } from "../i18n.jsx";
import SalesBoard from "../components/SalesBoard.jsx";

export default function Salesboard() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [tok, setTok] = useState(null);
  const [updated, setUpdated] = useState(null);
  const [copied, setCopied] = useState(false);
  const [editCode, setEditCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [gap, setGap] = useState(null);   // conversations with no human owner

  const load = useCallback(async () => {
    try { setData(await api.get("/salesboard")); setUpdated(new Date()); setErr(""); }
    catch (e) { setErr(e.message); }
    // Coverage gap is refreshed alongside the board; it's the number that
    // matters most once the bots are switched off.
    api.get("/assignment/facets").then((f) => setGap(f.counts)).catch(() => {});
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  useEffect(() => { api.get("/salesboard/token").then((r) => { setTok(r); setEditCode(r.code || ""); }).catch(() => {}); }, []);

  const kioskUrl = tok ? `${window.location.origin}${tok.path}` : "";
  async function copy() {
    try { await navigator.clipboard.writeText(kioskUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  }
  async function saveCode() {
    setCodeErr("");
    try { const r = await api.post("/salesboard/code", { code: editCode.trim() }); setTok(r); setEditCode(r.code); }
    catch (e) { setCodeErr(e.message); }
  }

  const updatedLabel = updated ? `${t("آخر تحديث")}: ${updated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "";

  return (
    <>
      <div className="topbar"><h2>{t("لوحة المبيعات التحفيزية")}</h2></div>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t("تُحدَّث البيانات تلقائياً كل 30 دقيقة (مزامنة واتساب + ميتا + تحليل المحادثات بالذكاء الاصطناعي). العرض يتجدّد كل دقيقة.")}
      </p>

      {gap && (gap.unassigned > 0 || gap.bot > 0) && (
        <div className="note bad" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <b>⚠ {t("فجوة التغطية")}:</b>
          <span>
            {gap.unassigned.toLocaleString("en-US")} {t("محادثة بلا موظف")}
            {gap.bot > 0 && <> · {gap.bot.toLocaleString("en-US")} {t("لدى البوت")}</>}
          </span>
          <Link className="btn sm" to="/assignment?owner=__unhandled__">{t("إسنادها الآن")}</Link>
        </div>
      )}

      <div className="section" style={{ marginBottom: 14 }}>
        <h3>{t("رابط شاشة العرض (كشك)")}</h3>
        <p className="muted" style={{ fontSize: 12 }}>{t("افتح هذا الرابط على تلفاز قسم المبيعات — يعمل دون تسجيل دخول ويعرض هذه اللوحة فقط. الرابط ثابت ولا يتغيّر.")}</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <input readOnly value={kioskUrl} style={{ flex: 1, minWidth: 280, direction: "ltr", fontWeight: 700 }} onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={copy} disabled={!kioskUrl}>{copied ? t("تم النسخ ✓") : t("نسخ")}</button>
          <a className="btn primary" href={tok?.path || "#"} target="_blank" rel="noreferrer">{t("فتح الشاشة")}</a>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>{t("رمز الرابط (قصير وسهل)")}:</label>
          <span className="muted" style={{ direction: "ltr", fontSize: 13 }}>{window.location.origin}/tv/</span>
          <input value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="sales"
            style={{ width: 160, direction: "ltr" }} />
          <button className="btn" onClick={saveCode} disabled={!editCode.trim() || editCode.trim() === tok?.code}>{t("حفظ الرمز")}</button>
        </div>
        {codeErr && <p className="err" style={{ fontSize: 12, marginTop: 6 }}>{codeErr}</p>}
        <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>{t("مثال: اكتب sales ليصبح الرابط ثابتاً وسهلاً. أحرف/أرقام إنجليزية فقط (3–40).")}</p>
      </div>

      {err && <p className="err">{err}</p>}
      <div className="section" style={{ padding: 0, overflow: "hidden", borderRadius: 14 }}>
        {data ? <SalesBoard data={data} updatedLabel={updatedLabel} /> : <p style={{ padding: 20 }}>{t("جارٍ التحميل…")}</p>}
      </div>
    </>
  );
}
