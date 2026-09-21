import { useState, useEffect } from "react";
import { useFetch } from "../components/useFetch.js";
import FilterBar from "../components/FilterBar.jsx";
import { useDateRange } from "../components/DateRangeContext.jsx";
import { countryLabel } from "../components/country.js";
import { useI18n } from "../i18n.jsx";
import { useCurrency } from "../currency.jsx";
import api from "../api.js";

const ACCOUNT = { unknown: "غير معروف", demo: "تجريبي", real: "حقيقي" };
const STATUS = { new: "جديد", reviewing: "قيد المراجعة", contacted: "تم التواصل", converted: "تحوّل", lost: "خسارة" };
const STAGE = { qualified: "مؤهّل", interested: "مهتم", demo: "تجريبي", deposit: "إيداع" };
const BAND = { hot: "ساخن", warm: "دافئ", cold: "بارد" };
// BUG-014 fix: explains *why* a lead has no ad_name instead of a silent blank.
const UNATTRIBUTED_REASON = {
  no_source_id: "لا يوجد معرّف إعلان مرتبط بهذا العميل من واتساب",
  ad_not_synced: "معرّف الإعلان موجود لكن الإعلان نفسه لم يُزامَن بعد من Meta",
};

export default function Leads() {
  const { t, lang } = useI18n();
  const { money } = useCurrency();
  const dr = useDateRange();
  const [f, setF] = useState({ q: "", stage: "", band: "", accountType: "", reviewStatus: "", country: "", owner: "", hasDeposit: "", minScore: "" });
  const opts = useFetch("/analytics/filters");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const badge = (map, val, cls) => <span className={`badge ${cls || "b-" + val}`}>{map[val] ? t(map[val]) : val}</span>;

  const params = new URLSearchParams(dr.qs);
  for (const [k, v] of Object.entries(f)) if (v) params.set(k, v);
  const path = `/leads?${params.toString()}`;
  const { data, loading, error, reload } = useFetch(path, [path]);
  const [edit, setEdit] = useState(null);

  return (
    <>
      <div className="topbar">
        <h2>{t("العملاء المؤهّلون — المراجعة والمتابعة")}</h2>
        <a className="btn ghost" href={`/api/leads/export.csv?${params.toString()}&lang=${lang}`}>{t("تصدير CSV")}</a>
      </div>

      <FilterBar />
      <div className="filters">
        <input placeholder={t("بحث: اسم/هاتف/إعلان")} value={f.q} onChange={set("q")} />
        <select value={f.stage} onChange={set("stage")}><option value="">{t("كل المراحل")}</option>{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
        <select value={f.band} onChange={set("band")}><option value="">{t("كل التصنيفات")}</option>{Object.entries(BAND).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
        <select value={f.accountType} onChange={set("accountType")}><option value="">{t("كل الحسابات")}</option>{Object.entries(ACCOUNT).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
        <select value={f.reviewStatus} onChange={set("reviewStatus")}><option value="">{t("كل الحالات")}</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
        <select value={f.country} onChange={set("country")}><option value="">{t("كل الدول")}</option>{(opts.data?.countries || []).map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select value={f.owner} onChange={set("owner")}><option value="">{t("كل المسؤولين")}</option>{(opts.data?.owners || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
        <select value={f.hasDeposit} onChange={set("hasDeposit")}><option value="">{t("إيداع؟")}</option><option value="1">{t("أودع")}</option><option value="0">{t("لم يودع")}</option></select>
        <input type="number" placeholder={t("أدنى Score")} style={{ width: 110 }} value={f.minScore} onChange={set("minScore")} />
        <button className="btn ghost" onClick={() => setF({ q: "", stage: "", band: "", accountType: "", reviewStatus: "", country: "", owner: "", hasDeposit: "", minScore: "" })}>{t("مسح")}</button>
        <span className="muted">{data ? t("{n} عميل", { n: data.length }) : ""}</span>
      </div>

      {loading && <p>{t("جارٍ التحميل…")}</p>}
      {error && <p className="err">{error}</p>}
      {data && (
        <div className="section" style={{ padding: 0 }}>
          <div className="scroll">
            <table>
              <thead><tr>
                <th>{t("الاسم")}</th><th>{t("الهاتف")}</th><th>{t("المرحلة")}</th><th>Score</th><th>{t("الدولة")}</th>
                <th>{t("الإعلان")}</th><th>{t("المسؤول")}</th><th>{t("نوع الحساب")}</th><th>{t("الإيداع")}</th><th>{t("الحالة")}</th><th></th>
              </tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.wa_id}>
                    <td className="nm">{r.full_name}</td>
                    <td dir="ltr">{r.phone}</td>
                    <td>{STAGE[r.stage] ? t(STAGE[r.stage]) : r.stage}</td>
                    <td><span className={`badge b-${r.score_band}`}>{r.lead_score}</span></td>
                    <td>{countryLabel(r.phone, r.country, lang)}</td>
                    <td className="nm" style={{ maxWidth: 200 }}>
                      {r.ad_name || r.source_ad_id || "—"}
                      {r.unattributed_reason && (
                        <span className="tag warn" style={{ marginInlineStart: 6 }} title={UNATTRIBUTED_REASON[r.unattributed_reason] ? t(UNATTRIBUTED_REASON[r.unattributed_reason]) : r.unattributed_reason}>؟</span>
                      )}
                    </td>
                    <td>{r.contact_owner || "—"}</td>
                    <td>{badge(ACCOUNT, r.account_type)}</td>
                    <td>{money(r.deposit_total_aed)}</td>
                    <td>{STATUS[r.review_status] ? t(STATUS[r.review_status]) : r.review_status}</td>
                    <td><button className="btn ghost" onClick={() => setEdit(r)}>{t("مراجعة")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {edit && <EditModal lead={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function EditModal({ lead, onClose, onSaved }) {
  const { t } = useI18n();
  const { money } = useCurrency();
  const [f, setF] = useState({
    account_type: lead.account_type || "unknown",
    deposit_count: lead.deposit_count || 0,
    deposit_total_aed: lead.deposit_total_aed || 0,
    review_status: lead.review_status || "new",
    notes: lead.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [history, setHistory] = useState(null);

  useEffect(() => {
    api.get(`/leads/${encodeURIComponent(lead.wa_id)}/history`).then(setHistory).catch(() => setHistory([]));
  }, [lead.wa_id]);

  async function save() {
    setBusy(true); setErr("");
    try { await api.patch(`/leads/${encodeURIComponent(lead.wa_id)}`, f); onSaved(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("مراجعة العميل")} — {lead.full_name}</h3>
        <p className="muted" style={{ marginBottom: 14 }}>
          📞 {lead.phone} · {lead.ad_name || "—"} · {t("المسؤول")}: {lead.contact_owner || "—"}
        </p>
        <div className="field">
          <label>{t("نوع الحساب")}</label>
          <select value={f.account_type} onChange={(e) => setF({ ...f, account_type: e.target.value })}>
            {Object.entries(ACCOUNT).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </div>
        <div className="grid2">
          <div className="field"><label>{t("عدد الإيداعات")}</label>
            <input type="number" value={f.deposit_count} onChange={(e) => setF({ ...f, deposit_count: e.target.value })} /></div>
          <div className="field"><label>{t("إجمالي الإيداع (د.إ)")}</label>
            <input type="number" value={f.deposit_total_aed} onChange={(e) => setF({ ...f, deposit_total_aed: e.target.value })} /></div>
        </div>
        <div className="field">
          <label>{t("حالة المتابعة")}</label>
          <select value={f.review_status} onChange={(e) => setF({ ...f, review_status: e.target.value })}>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </div>
        <div className="field"><label>{t("ملاحظات")}</label>
          <textarea rows="3" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        {err && <div className="err">{err}</div>}
        <div className="row-actions">
          <button className="btn" disabled={busy} onClick={save}>{busy ? "…" : t("حفظ")}</button>
          <button className="btn ghost" onClick={onClose}>{t("إلغاء")}</button>
        </div>

        {history && history.length > 0 && (
          <div className="d-block" style={{ marginTop: 18 }}>
            <h4>{t("سجلّ المراجعة")}</h4>
            <div className="timeline">
              {history.slice(0, 8).map((h, i) => (
                <div className="tl-item" key={i}>
                  <span className="tl-time">{new Date(h.changed_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  <span>{h.changed_by} — {STATUS[h.review_status] ? t(STATUS[h.review_status]) : h.review_status} · {ACCOUNT[h.account_type] ? t(ACCOUNT[h.account_type]) : h.account_type} · {money(h.deposit_total_aed)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
