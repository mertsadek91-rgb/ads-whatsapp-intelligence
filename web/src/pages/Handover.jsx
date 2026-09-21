// Employee exit — hand a departing agent's whole book to someone else.
// Their conversations are shown broken down by country so the book can be
// split sensibly (per-country) instead of dumped on one person. Every move
// goes through the same guarded preview/execute engine as the assignment
// page, then the agent can be deactivated once nothing is left with them.
import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import { useI18n } from "../i18n.jsx";

export default function Handover() {
  const { t, lang } = useI18n();
  const [facets, setFacets] = useState(null);
  const [owner, setOwner] = useState("");
  const [info, setInfo] = useState(null);
  const [mode, setMode] = useState("all");        // all | per_country
  const [toAll, setToAll] = useState("");
  const [perCountry, setPerCountry] = useState({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [log, setLog] = useState([]);             // per-group outcomes

  useEffect(() => { api.get("/assignment/facets").then(setFacets).catch((e) => setErr(e.message)); }, []);

  const loadInfo = useCallback(async (o) => {
    if (!o) { setInfo(null); return; }
    setBusy("info"); setErr(""); setLog([]);
    try { setInfo(await api.get(`/assignment/handover/${encodeURIComponent(o)}`)); }
    catch (e) { setErr(e.message); } finally { setBusy(""); }
  }, []);
  useEffect(() => { loadInfo(owner); setToAll(""); setPerCountry({}); }, [owner, loadInfo]);

  const assignable = (facets?.employees || []).filter((e) => e.assignable && e.owner_name !== owner);
  const cName = (c) => (lang === "en" ? c.en : c.ar);

  /** Groups to move: either everything to one agent, or country -> agent. */
  function plan() {
    if (mode === "all") return toAll ? [{ country: null, to: toAll, n: info.total }] : [];
    return (info?.by_country || [])
      .filter((c) => perCountry[c.iso2 || "?"])
      .map((c) => ({ country: c.iso2, to: perCountry[c.iso2 || "?"], n: c.n }));
  }

  async function run() {
    const groups = plan();
    if (!groups.length) { setErr(t("اختر الموظف البديل أولاً")); return; }
    const totalToMove = groups.reduce((s, g) => s + g.n, 0);
    if (!window.confirm(`${t("سيتم نقل")} ${totalToMove} ${t("محادثة في Wati. متابعة؟")}`)) return;

    setBusy("run"); setErr(""); setLog([]);
    try {
      for (const g of groups) {
        const qs = new URLSearchParams({ owner, cap: "5000", ...(g.country ? { country: g.country } : {}) }).toString();
        const { ids } = await api.get(`/assignment/contacts/ids?${qs}`);
        if (!ids.length) { setLog((l) => [...l, { ...g, sent: 0, failed: 0, note: t("لا شيء") }]); continue; }
        const r = await api.post("/assignment/execute", {
          waIds: ids, toOwner: g.to, confirm: true, expected: ids.length, reason: "employee_exit",
        });
        setLog((l) => [...l, { ...g, sent: r.sent, failed: r.failed, batchId: r.batchId }]);
      }
      await loadInfo(owner);
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  }

  async function deactivate() {
    if (!window.confirm(t("تعطيل هذا الموظف في النظام؟"))) return;
    setBusy("deact"); setErr("");
    try { await api.post("/assignment/deactivate", { owner }); await loadInfo(owner); }
    catch (e) { setErr(e.message); } finally { setBusy(""); }
  }

  async function undo(batchId) {
    setBusy("undo");
    try { await api.post(`/assignment/undo/${batchId}`, {}); await loadInfo(owner); }
    catch (e) { setErr(e.message); } finally { setBusy(""); }
  }

  return (
    <>
      <div className="topbar"><h2>{t("خروج موظف — تسليم المحادثات")}</h2></div>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t("انقل كل محادثات موظف مغادر إلى غيره — دفعة واحدة أو موزّعة حسب البلد — ثم عطّله.")}
      </p>

      <div className="filterbar">
        <b>{t("الموظف المغادر")}:</b>
        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">{t("اختر الموظف")}…</option>
          {(facets?.owners || []).map((o) => (
            <option key={o.owner} value={o.owner}>{o.owner} ({o.n})</option>
          ))}
        </select>
        {busy === "info" && <span className="muted">{t("جارٍ التحميل…")}</span>}
      </div>

      {err && <p className="err">{err}</p>}

      {info && (
        <>
          <div className="kpis">
            <div className="kpi"><div className="label">{t("محادثات لديه")}</div>
              <div className={`val ${info.total ? "bad" : "good"}`}>{info.total.toLocaleString("en-US")}</div></div>
            <div className="kpi"><div className="label">{t("منهم مهتمّون")}</div><div className="val">{info.interested}</div></div>
            <div className="kpi"><div className="label">{t("آخر نشاط")}</div>
              <div className="val" style={{ fontSize: 17 }}>
                {info.last_activity ? new Date(info.last_activity).toLocaleDateString("en-GB") : "—"}</div></div>
            <div className="kpi"><div className="label">{t("عدد البلدان")}</div><div className="val">{info.by_country.length}</div></div>
          </div>

          {info.total === 0 ? (
            <div className="note ok">
              {t("لم تبقَ لديه أي محادثة.")}
              {info.employee?.active === 1 && (
                <button className="btn ghost sm" style={{ marginInlineStart: 12 }}
                  disabled={busy === "deact"} onClick={deactivate}>{t("تعطيل الموظف")}</button>
              )}
              {info.employee && info.employee.active === 0 && <b> — {t("معطّل بالفعل")}</b>}
            </div>
          ) : (
            <div className="section">
              <h3>{t("خطة التسليم")}</h3>
              <div className="filters" style={{ marginBottom: 14 }}>
                <button className={`chip ${mode === "all" ? "active" : ""}`} onClick={() => setMode("all")}>
                  {t("نقل الكل إلى موظف واحد")}</button>
                <button className={`chip ${mode === "per_country" ? "active" : ""}`} onClick={() => setMode("per_country")}>
                  {t("توزيع حسب البلد")}</button>
              </div>

              {mode === "all" ? (
                <div className="filters">
                  <span>{t("نقل")} <b>{info.total}</b> {t("محادثة إلى")}:</span>
                  <select value={toAll} onChange={(e) => setToAll(e.target.value)}>
                    <option value="">{t("اختر الموظف")}…</option>
                    {assignable.map((e) => <option key={e.owner_name} value={e.owner_name}>{e.full_name || e.owner_name}</option>)}
                  </select>
                </div>
              ) : (
                <div className="scroll" style={{ maxHeight: 340 }}>
                  <table>
                    <thead><tr>
                      <th style={{ cursor: "default" }}>{t("الدولة")}</th><th style={{ cursor: "default" }}>{t("العملاء")}</th>
                      <th style={{ cursor: "default" }}>{t("تم التواصل")}</th><th style={{ cursor: "default" }}>{t("الموظف البديل")}</th>
                    </tr></thead>
                    <tbody>
                      {info.by_country.map((c) => (
                        <tr key={c.iso2 || "?"}>
                          <td>{c.flag} {cName(c)}</td>
                          <td><b>{c.n}</b></td>
                          <td className="good">{c.contacted}</td>
                          <td>
                            <select value={perCountry[c.iso2 || "?"] || ""}
                              onChange={(e) => setPerCountry((p) => ({ ...p, [c.iso2 || "?"]: e.target.value }))}>
                              <option value="">{t("تجاهل")}</option>
                              {assignable.map((e) => (
                                <option key={e.owner_name} value={e.owner_name}>{e.full_name || e.owner_name}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="row-actions" style={{ marginTop: 14 }}>
                <button className="btn" disabled={busy === "run" || plan().length === 0} onClick={run}>
                  {busy === "run" ? t("جارٍ التنفيذ…") : `${t("تنفيذ التسليم")} (${plan().reduce((s, g) => s + g.n, 0)})`}
                </button>
                <span className="muted">{t("هذا إجراء يكتب في Wati مباشرة. يمكن التراجع عنه بعد التنفيذ.")}</span>
              </div>
            </div>
          )}

          {log.length > 0 && (
            <div className="section">
              <h3>{t("نتيجة التسليم")}</h3>
              {log.map((l, i) => (
                <div className="d-row" key={i}>
                  <span>{l.country || t("الكل")} → {l.to}</span>
                  <span>
                    <b className="good">{l.sent} {t("نجحت")}</b>
                    {l.failed > 0 && <b className="bad"> · {l.failed} {t("فشلت")}</b>}
                    {l.batchId && (
                      <button className="btn ghost sm" style={{ marginInlineStart: 10 }}
                        disabled={busy === "undo"} onClick={() => undo(l.batchId)}>{t("تراجع")}</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
