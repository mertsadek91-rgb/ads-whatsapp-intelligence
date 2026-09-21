// Manage the employee directory that drives the nightly report emails: each
// sales agent's name→email, the campaign-report recipient, and the general
// manager who is CC'd on everything. Also the master send switch (kept OFF
// until the admin confirms SMTP with a test email) and a manual "run now".
import { useState, useEffect } from "react";
import { useFetch } from "../components/useFetch.js";
import { useI18n } from "../i18n.jsx";
import api from "../api.js";

const ROLES = [
  ["agent", "موظف مبيعات"],
  ["campaign_manager", "مسؤول الحملات"],
  ["general_manager", "المدير العام"],
];

// Language-aware on purpose: an earlier draft always returned Arabic and used an
// empty-string dictionary entry as an English prefix, which rendered a bare
// Arabic duration on the English page.
const ago = (ts, lang = "ar") => {
  if (!ts) return null;
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  const en = lang === "en";
  if (min < 1) return en ? "just now" : "الآن";
  if (min < 60) return en ? `${min} min ago` : `قبل ${min} دقيقة`;
  const h = Math.floor(min / 60);
  if (h < 24) return en ? `${h}h ${min % 60}m ago` : `قبل ${h} ساعة و${min % 60} دقيقة`;
  const d = Math.floor(h / 24);
  return en ? `${d}d ${h % 24}h ago` : `قبل ${d} يوم و${h % 24} ساعة`;
};
/** True when the gap is a day or more — the point at which the board is not "live". */
const isStaleDays = (ts) => !!ts && Date.now() - new Date(ts).getTime() >= 86400000;

/**
 * Emergency refresh for the two wall boards.
 *
 * The automatic tick re-reads at most 600 conversations every 30 minutes, which
 * means a thread can sit up to two days stale. That is fine in the background and
 * useless when a manager is standing in front of the board disputing whether a
 * customer was contacted. This re-reads EVERY conversation in the window now.
 *
 * It reports what CHANGED, not just that it ran — "nothing moved, the board was
 * already right" is as valuable an answer as finding three missed replies, and
 * the argument only ends if the button can say which one it was.
 */
function BoardRefresh({ t, lang }) {
  const [days, setDays] = useState(7);
  const [state, setState] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => api.get("/admin/refresh-boards/status").then(setState).catch(() => {});
  useEffect(() => { load(); }, []);

  async function run() {
    setBusy(true); setErr(""); setResult(null);
    try {
      setResult(await api.post("/admin/refresh-boards", { days, hours: 6 }));
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // The oldest conversation read is the honest staleness figure: the newest one
  // is always "just now" and tells you nothing about the row you are arguing over.
  const oldest = state?.oldest_conversation_read;

  return (
    <div className="section" style={{ borderInlineStart: "3px solid var(--warning)" }}>
      <h3>{t("تحديث فوري للوحات العرض")}</h3>
      <p className="muted" style={{ marginBottom: 10 }}>
        {t("يُعيد قراءة كل محادثة في الفترة من واتساب فوراً، بلا حد أقصى — للحالات الطارئة عندما تشكّ في أن اللوحة متأخّرة. لا يشغّل الذكاء الاصطناعي ولا يكلّف شيئاً.")}
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={busy}>
          <option value={7}>{t("آخر 7 أيام")}</option>
          <option value={14}>{t("آخر 14 يوماً")}</option>
          <option value={30}>{t("آخر 30 يوماً")}</option>
        </select>
        <button className="btn orange" disabled={busy || state?.running} onClick={run}>
          {busy || state?.running ? t("جارٍ التحديث…") : t("حدّث الآن")}
        </button>
        {busy && <span className="muted" style={{ fontSize: 12 }}>{t("قد يستغرق دقيقة أو دقيقتين — لا تُغلق الصفحة.")}</span>}
      </div>

      {state && (
        <>
          <div className="id-detail"><span>{t("آخر قراءة لقائمة العملاء")}</span>
            <b>{ago(state.contacts_synced_at, lang) || "—"}</b></div>
          <div className="id-detail"><span>{t("أقدم محادثة لم تُقرأ منذ")}</span>
            <b className={isStaleDays(oldest) ? "err" : undefined}>{ago(oldest, lang) || "—"}</b></div>
        </>
      )}

      {err && <p className="err">{err}</p>}

      {result && (
        <div className="d-block" style={{ marginTop: 12 }}>
          <h4>{t("نتيجة التحديث")}</h4>
          <div className="id-detail"><span>{t("الفترة")}</span>
            <b dir="ltr">{result.window?.since} → {result.window?.until}</b></div>
          <div className="id-detail"><span>{t("جهات اتصال محدَّثة")}</span><b>{result.contacts_updated}</b></div>
          <div className="id-detail"><span>{t("محادثات أُعيدت قراءتها")}</span>
            <b>{result.conversations_reread}{result.reread_failed ? ` · ${result.reread_failed} ${t("تعذّرت")}` : ""}</b></div>
          <div className="id-detail"><span>{t("تم التواصل: قبل ← بعد")}</span>
            <b>{result.before?.contacted} ← {result.after?.contacted}</b></div>
          {/* The answer to the argument, stated plainly either way. */}
          <p style={{ marginTop: 10, fontWeight: 700 }} className={result.flipped_to_contacted ? "good" : undefined}>
            {result.flipped_to_contacted
              ? `${t("تحوّل إلى «تم التواصل»")}: ${result.flipped_to_contacted}`
              : t("لا شيء تغيّر — اللوحة كانت محدَّثة فعلاً.")}
          </p>
          {result.flipped_ids?.length > 0 && (
            <p className="muted" style={{ fontSize: 12, direction: "ltr", overflowWrap: "anywhere" }}>
              {result.flipped_ids.join(" · ")}
            </p>
          )}
          {result.errors?.length > 0 && (
            <p className="err" style={{ fontSize: 12 }}>{result.errors.join(" | ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
const blankRow = () => ({ owner_name: "", email: "", full_name: "", role: "agent", lang: "ar", active: 1, countries: [] });
const EMAIL_KIND = { employee_weekly: "تقرير موظف", campaign_daily: "تقرير حملات", alert: "تنبيه", test: "اختبار" };
const EMAIL_STATUS = { sent: "أُرسل", error: "فشل", skipped: "متخطّى" };

export default function EmployeesAdmin() {
  const { t, lang } = useI18n();
  const { data, loading, error, reload } = useFetch("/settings/employees", []);
  const reports = useFetch("/settings/reports", []);
  const status = useFetch("/admin/report-status", []);
  const countryOpts = useFetch("/settings/country-options", []);
  const [draft, setDraft] = useState(blankRow());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [testTo, setTestTo] = useState("");
  const [rptLang, setRptLang] = useState("ar");
  const [rptAgent, setRptAgent] = useState("");
  const [rptWeek, setRptWeek] = useState("");
  const [rptMonth, setRptMonth] = useState("");
  const periods = useFetch("/admin/report/periods", []);
  useEffect(() => {
    const p = periods.data;
    if (p) {
      if (!rptWeek && p.weeks?.[0]) setRptWeek(p.weeks[0].monday);
      if (!rptMonth && p.months?.[0]) setRptMonth(p.months[0].key);
    }
  }, [periods.data]);
  const openPdf = (path) => window.open(`/api${path}`, "_blank", "noopener");

  useEffect(() => { if (msg) { const id = setTimeout(() => setMsg(""), 4000); return () => clearTimeout(id); } }, [msg]);

  async function save(row) {
    setBusy(true);
    try { await api.post("/settings/employees", row); reload(); if (!row.id) setDraft(blankRow()); }
    catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  async function remove(id) {
    if (!window.confirm(t("حذف هذا الصف؟"))) return;
    await api.del(`/settings/employees/${id}`); reload();
  }
  async function seed() {
    setBusy(true);
    try { const r = await api.post("/settings/employees/seed"); setMsg(t("أُضيف {n} موظف", { n: r.added })); reload(); }
    catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  async function toggleSend(enabled) {
    const r = await api.post("/settings/reports", { email_enabled: enabled });
    reports.reload?.(); return r;
  }
  async function sendTest() {
    setBusy(true);
    try { const r = await api.post("/admin/send-test-email", testTo ? { to: testTo } : {}); setMsg(r.ok ? t("تم إرسال بريد الاختبار") : (r.reason || t("تعذّر الإرسال"))); }
    catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  async function runNow() {
    if (!window.confirm(t("تشغيل خط التقارير الآن؟"))) return;
    setBusy(true);
    try {
      await api.post("/admin/run-nightly", {});
      setMsg(t("بدأ التشغيل — ستظهر النتيجة في لوحة المتابعة بعد قليل"));
      setTimeout(() => status.reload?.(), 4000);
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  async function sendNow() {
    if (!window.confirm(t("سيتم توليد التقارير وإرسالها فوراً بالبريد لكل الموظفين والمديرين. متابعة؟"))) return;
    setBusy(true);
    try {
      await api.post("/admin/send-reports-now", {});
      setMsg(t("بدأ التوليد والإرسال — ستظهر النتيجة في لوحة المتابعة بعد قليل"));
      setTimeout(() => status.reload?.(), 6000);
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }

  const VERDICT_CLS = { sent: "good", error: "bad", skipped: "" };
  const fmtTime = (d) => (d ? new Date(d).toLocaleString("en-GB") : "—");

  const rows = data || [];
  const smtpOk = reports.data?.smtp_configured;
  const sendOn = reports.data?.email_enabled;

  return (
    <>
      <div className="topbar"><h2>{t("إدارة الموظفين والإيميلات")}</h2></div>

      <BoardRefresh t={t} lang={lang} />

      <div className="section">
        <h3>{t("تفعيل إرسال التقارير")}</h3>
        <p className="muted" style={{ marginBottom: 10 }}>
          {t("حالة خادم البريد (SMTP)")}: {smtpOk ? <b className="good">{t("مضبوط ✓")}</b> : <b className="err">{t("غير مضبوط — اضبط متغيرات Coolify")}</b>}
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={!!sendOn} disabled={!smtpOk} onChange={(e) => toggleSend(e.target.checked)} />
            {t("تفعيل الإرسال الآلي للتقارير")}
          </label>
          <span className="fb-sep" />
          <input placeholder={t("بريد للاختبار (اختياري)")} value={testTo} onChange={(e) => setTestTo(e.target.value)} style={{ width: 220 }} />
          <button className="btn ghost" disabled={busy || !smtpOk} onClick={sendTest}>{t("إرسال بريد اختبار")}</button>
          <button className="btn ghost" disabled={busy} onClick={runNow}>{t("تشغيل كامل الآن")}</button>
          <button className="btn orange" disabled={busy || !smtpOk} onClick={sendNow}>{t("توليد وإرسال الآن")}</button>
        </div>
        {!sendOn && <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>{t("الإرسال مطفأ: النظام يُولّد التقارير لكن لا يُرسلها حتى تُفعّل الإرسال.")}</p>}
      </div>

      <div className="section">
        <h3>{t("معاينة التقارير — ادرس النتيجة النهائية")}</h3>
        <p className="muted" style={{ marginBottom: 10, fontSize: 12 }}>{t("افتح أي تقرير كـ PDF فوراً (نفس الملف الذي يُرسل بالبريد) دون انتظار الإرسال.")}</p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <span className="muted">{t("اللغة")}:</span>
          {[["ar", "عربي"], ["en", "EN"]].map(([v, lbl]) => (
            <button key={v} className={`chip ${rptLang === v ? "active" : ""}`} onClick={() => setRptLang(v)}>{lbl}</button>
          ))}
          <span className="fb-sep" />
          <span className="muted">{t("الموظف")}:</span>
          <select value={rptAgent} onChange={(e) => setRptAgent(e.target.value)}>
            <option value="">{t("اختر الموظف")}</option>
            {(data || []).filter((e) => e.role === "agent" && e.owner_name).map((e) => (
              <option key={e.id} value={e.owner_name}>{e.owner_name}</option>
            ))}
          </select>
        </div>

        <div className="rpt-blocks">
          {/* Weekly block — isolated from the monthly one */}
          <div className="rpt-block">
            <h4>📅 {t("التقارير الأسبوعية")}</h4>
            <label className="rpt-field">{t("اختر الأسبوع")}
              <select value={rptWeek} onChange={(e) => setRptWeek(e.target.value)}>
                {(periods.data?.weeks || []).map((w) => (
                  <option key={w.monday} value={w.monday}>{w.key} · {w.since} → {w.until}</option>
                ))}
              </select>
            </label>
            <div className="rpt-actions">
              <button className="btn ghost" onClick={() => openPdf(`/admin/report/campaign.pdf?cadence=weekly&week=${rptWeek}&lang=${rptLang}`)}>{t("تقرير الحملات")}</button>
              <button className="btn ghost" disabled={!rptAgent} onClick={() => openPdf(`/admin/report/employee-weekly.pdf?agent=${encodeURIComponent(rptAgent)}&week=${rptWeek}&lang=${rptLang}`)}>{t("تقرير الموظف")}</button>
            </div>
          </div>

          {/* Monthly block — isolated from the weekly one */}
          <div className="rpt-block">
            <h4>🗓️ {t("التقارير الشهرية")}</h4>
            <label className="rpt-field">{t("اختر الشهر")}
              <select value={rptMonth} onChange={(e) => setRptMonth(e.target.value)}>
                {(periods.data?.months || []).map((m) => (
                  <option key={m.key} value={m.key}>{m.key} · {m.since} → {m.until}</option>
                ))}
              </select>
            </label>
            <div className="rpt-actions">
              <button className="btn ghost" onClick={() => openPdf(`/admin/report/campaign.pdf?cadence=monthly&month=${rptMonth}&lang=${rptLang}`)}>{t("تقرير الحملات")}</button>
              <button className="btn ghost" disabled={!rptAgent} onClick={() => openPdf(`/admin/report/employee-monthly.pdf?agent=${encodeURIComponent(rptAgent)}&month=${rptMonth}&lang=${rptLang}`)}>{t("تقرير الموظف")}</button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <b style={{ fontSize: 13 }}>{t("تقرير الحملات اليومي")}: </b>
          <button className="btn ghost" onClick={() => openPdf(`/admin/report/campaign.pdf?cadence=daily&lang=${rptLang}`)}>{t("فتح")}</button>
        </div>
        <p className="muted" style={{ marginTop: 8, fontSize: 11.5 }}>{t("قد يستغرق التوليد بضع ثوانٍ (يشمل تحليل الذكاء الاصطناعي).")}</p>
      </div>

      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3>{t("متابعة التشغيل")}</h3>
          <button className="btn ghost" onClick={() => status.reload?.()}>{t("تحديث")}</button>
        </div>
        {status.data?.running && <p className="good">{t("تشغيل قيد التنفيذ الآن…")}</p>}
        {status.data?.last_run
          ? <p className="muted" style={{ fontSize: 12 }}>
              {t("آخر تشغيل")}: <b>{fmtTime(status.data.last_run.built_at)}</b>
              <span style={{ display: "block", marginTop: 4, direction: "ltr", textAlign: "start", fontFamily: "ui-monospace,monospace" }}>{status.data.last_run.summary}</span>
            </p>
          : <p className="muted">{t("لا تشغيل مُسجَّل بعد.")}</p>}
        <h4 style={{ margin: "14px 0 6px" }}>{t("آخر الإيميلات المُرسَلة")}</h4>
        {status.data?.emails?.length
          ? <table>
              <thead><tr>
                <th>{t("النوع")}</th><th>{t("المستلم")}</th><th>{t("الفترة")}</th><th>{t("الحالة")}</th><th>{t("الوقت")}</th>
              </tr></thead>
              <tbody>
                {status.data.emails.map((e, i) => (
                  <tr key={i}>
                    <td>{t(EMAIL_KIND[e.kind] || e.kind)}</td>
                    <td dir="ltr">{e.recipient}</td>
                    <td dir="ltr">{e.period_key}</td>
                    <td><span className={VERDICT_CLS[e.status] || ""} title={e.error || ""}>{t(EMAIL_STATUS[e.status] || e.status)}</span></td>
                    <td dir="ltr">{fmtTime(e.sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          : <p className="muted">{t("لم تُرسل أي إيميلات بعد.")}</p>}
      </div>

      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3>{t("الموظفون والأدوار")}</h3>
          <button className="btn ghost" disabled={busy} onClick={seed}>{t("تعبئة من المحادثات")}</button>
        </div>
        {msg && <p className="muted">{msg}</p>}
        {loading && <p>{t("جارٍ التحميل…")}</p>}
        {error && <p className="err">{error}</p>}
        <table>
          <thead><tr>
            <th>{t("الاسم في واتساب")}</th><th>{t("الاسم الكامل")}</th><th>{t("الإيميل")}</th>
            <th>{t("الدور")}</th><th>{t("الدول")}</th><th>{t("اللغة")}</th><th>{t("مفعّل")}</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => <EmpRow key={r.id} row={r} onSave={save} onRemove={remove} busy={busy} t={t} countryOpts={countryOpts.data || []} />)}
            <EmpRow row={draft} draft onChange={setDraft} onSave={save} busy={busy} t={t} countryOpts={countryOpts.data || []} />
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {t("الموظف يستلم تقريره فقط؛ مسؤول الحملات يستلم تقرير الحملات؛ المدير العام يُنسخ (CC) على الكل.")}
        </p>
      </div>
    </>
  );
}

function EmpRow({ row, draft, onChange, onSave, onRemove, busy, t, countryOpts }) {
  const [local, setLocal] = useState(row);
  const [picker, setPicker] = useState(false);
  useEffect(() => { if (!draft) setLocal(row); }, [row, draft]);
  const v = draft ? row : local;
  const set = (patch) => { const next = { ...v, ...patch }; draft ? onChange(next) : setLocal(next); };
  const isAgent = v.role === "agent";
  const selected = Array.isArray(v.countries) ? v.countries : [];
  const toggleCountry = (iso) => set({ countries: selected.includes(iso) ? selected.filter((c) => c !== iso) : [...selected, iso] });
  const chosen = countryOpts.filter((c) => selected.includes(c.iso2));
  return (
    <tr>
      <td><input value={v.owner_name || ""} disabled={!isAgent} placeholder={isAgent ? "" : "—"} onChange={(e) => set({ owner_name: e.target.value })} style={{ width: 150 }} /></td>
      <td><input value={v.full_name || ""} onChange={(e) => set({ full_name: e.target.value })} style={{ width: 140 }} /></td>
      <td><input type="email" value={v.email || ""} onChange={(e) => set({ email: e.target.value })} dir="ltr" style={{ width: 200 }} /></td>
      <td>
        <select value={v.role} onChange={(e) => set({ role: e.target.value })}>
          {ROLES.map(([val, label]) => <option key={val} value={val}>{t(label)}</option>)}
        </select>
      </td>
      <td>
        <button type="button" className="btn ghost" onClick={() => setPicker(true)} style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}
          title={chosen.map((c) => c.ar).join("، ")}>
          {chosen.length ? `${chosen.slice(0, 3).map((c) => c.flag).join(" ")}${chosen.length > 3 ? ` +${chosen.length - 3}` : ""}` : `🌍 ${t("اختر")}`}
        </button>
        {picker && (
          <div className="modal-bg" onClick={() => setPicker(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
              <h3>{t("الدول التي يعمل عليها")}</h3>
              <div style={{ maxHeight: 340, overflow: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {countryOpts.map((c) => (
                  <label key={c.iso2} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, padding: "3px 4px" }}>
                    <input type="checkbox" checked={selected.includes(c.iso2)} onChange={() => toggleCountry(c.iso2)} />
                    {c.flag} {c.ar}
                  </label>
                ))}
              </div>
              <button className="btn orange" onClick={() => setPicker(false)} style={{ marginTop: 12 }}>{t("تم")}</button>
            </div>
          </div>
        )}
      </td>
      <td>
        <select value={v.lang} onChange={(e) => set({ lang: e.target.value })}>
          <option value="ar">{t("عربي")}</option><option value="en">EN</option>
        </select>
      </td>
      <td><input type="checkbox" checked={!!v.active} onChange={(e) => set({ active: e.target.checked ? 1 : 0 })} /></td>
      <td style={{ whiteSpace: "nowrap" }}>
        <button className="btn ghost" disabled={busy} onClick={() => onSave(v)}>{draft ? t("إضافة") : t("حفظ")}</button>
        {!draft && <button className="btn ghost" disabled={busy} onClick={() => onRemove(row.id)} style={{ marginInlineStart: 6 }}>🗑</button>}
      </td>
    </tr>
  );
}
