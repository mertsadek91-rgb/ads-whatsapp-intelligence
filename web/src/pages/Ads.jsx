import { useState } from "react";
import { useFetch, fmt0, fmt2 } from "../components/useFetch.js";
import DataTable from "../components/DataTable.jsx";
import FilterBar from "../components/FilterBar.jsx";
import IdCell from "../components/IdCell.jsx";
import { useDateRange } from "../components/DateRangeContext.jsx";
import { useI18n } from "../i18n.jsx";
import { useCurrency } from "../currency.jsx";

export default function Ads() {
  const { t } = useI18n();
  const { money } = useCurrency();
  const dr = useDateRange();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [minQ, setMinQ] = useState("");
  const [detail, setDetail] = useState(null); // the ad row shown in the details modal
  const params = new URLSearchParams(dr.qs);
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (minQ) params.set("minQualified", minQ);
  const path = `/analytics/ads?${params.toString()}`;
  const { data, loading, error } = useFetch(path, [path]);

  const statusBadge = (s) => {
    const cls = s === "WITH_ISSUES" ? "b-issue" : s === "PAUSED" ? "b-paused" : "b-active";
    return <span className={`badge ${cls}`}>{s === "WITH_ISSUES" ? t("⚠ مشكلة") : s || "—"}</span>;
  };

  const cols = [
    // The id sits under the name rather than in a column of its own: it frees
    // ~150px, which is most of what this 18-column grid needs to fit on screen.
    // Filtering this column still searches the id, as the ID column used to.
    { key: "ad_name", label: t("الإعلان"),
      match: (f, r) => `${r.ad_name ?? ""} ${r.ad_id ?? ""}`.toLowerCase().includes(f.toLowerCase()),
      render: (r) => (
        <>
          <span className="nm-text" title={r.ad_name || ""}>{r.ad_name || "—"}</span>
          <span className="cell-sub">
            <IdCell id={r.ad_id} url={r.manage_url} tail={8} />
            <button type="button" className="id-btn" title={t("التفاصيل")} onClick={() => setDetail(r)}>ℹ️</button>
          </span>
        </>
      ) },
    { key: "status", label: t("الحالة"), render: (r) => statusBadge(r.status) },
    { key: "spend_aed", label: t("الإنفاق"), num: true, render: (r) => money(r.spend_aed) },
    { key: "impressions", label: t("الظهور"), num: true, render: (r) => fmt0(r.impressions) },
    { key: "clicks", label: t("النقرات"), num: true, render: (r) => fmt0(r.clicks) },
    { key: "ctr_pct", label: "CTR", num: true, render: (r) => fmt2(r.ctr_pct) + "%" },
    { key: "cpc_aed", label: "CPC", num: true, render: (r) => money(r.cpc_aed, { decimals: 2 }) },
    { key: "cpm_aed", label: "CPM", num: true, render: (r) => money(r.cpm_aed, { decimals: 2 }) },
    { key: "frequency", label: t("التكرار"), num: true, render: (r) => <span className={Number(r.frequency) > 3.5 ? "bad" : ""}>{fmt2(r.frequency)}</span> },
    { key: "convos_meta", label: t("محادثات"), num: true, render: (r) => fmt0(r.convos_meta) },
    { key: "cpr_aed", label: t("تكلفة المحادثة"), num: true, render: (r) => money(r.cpr_aed, { decimals: 2 }) },
    { key: "contacts_wati", label: t("جهات Wati"), num: true, render: (r) => fmt0(r.contacts_wati) },
    { key: "wati_capture_pct", label: t("% التقاط"), num: true, render: (r) => r.wati_capture_pct != null ? fmt2(r.wati_capture_pct) + "%" : "—" },
    { key: "cost_per_contact", label: t("تكلفة الجهة"), num: true, render: (r) => r.cost_per_contact ? money(r.cost_per_contact, { decimals: 2 }) : "—" },
    { key: "qualified", label: t("مؤهّل"), num: true, render: (r) => <b>{fmt0(r.qualified)}</b> },
    { key: "qual_rate_pct", label: t("% التأهّل"), num: true, render: (r) => r.qual_rate_pct != null ? <span className={Number(r.qual_rate_pct) >= 8 ? "good" : ""}>{fmt2(r.qual_rate_pct)}%</span> : "—" },
    { key: "deposits", label: t("إيداعات"), num: true, render: (r) => fmt0(r.deposits) },
    { key: "cost_per_qualified", label: t("تكلفة المؤهّل"), num: true,
      render: (r) => <span className={r.cost_per_qualified && Number(r.cost_per_qualified) < 80 ? "good" : Number(r.cost_per_qualified) > 200 ? "bad" : ""}>{r.cost_per_qualified ? money(r.cost_per_qualified) : "—"}</span> },
  ];

  return (
    <>
      <div className="topbar"><h2>{t("أداء الإعلانات — أيّها يجلب العملاء المؤهّلين")}</h2></div>
      <FilterBar>
        <span className="fb-sep" />
        <input placeholder={t("بحث باسم الإعلان")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("كل الحالات")}</option>
          <option value="ACTIVE">{t("نشط")}</option>
          <option value="PAUSED">{t("موقوف")}</option>
          <option value="WITH_ISSUES">{t("به مشكلة")}</option>
        </select>
        <input type="number" placeholder={t("أدنى مؤهّل")} style={{ width: 110 }} value={minQ} onChange={(e) => setMinQ(e.target.value)} />
      </FilterBar>
      <p className="muted" style={{ marginBottom: 12 }}>{t("الكمّ ≠ الجودة: قارن «محادثات» بـ«مؤهّل». الإنفاق إجمالي الفترة؛ الجهات/المؤهّل تتبع التاريخ.")}</p>
      {loading && <p>{t("جارٍ التحميل…")}</p>}
      {error && <p className="err">{error}</p>}
      {data && <div className="section"><DataTable columns={cols} rows={data} wide initialSort={{ key: "qualified", dir: "desc" }} /></div>}
      {detail && (
        <div className="modal-bg" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("تفاصيل الإعلان")}</h3>
            <div className="id-detail" title={detail.ad_name}><b>{detail.ad_name || "—"}</b></div>
            <div className="id-detail"><span>{t("رقم الإعلان")}</span><IdCell id={detail.ad_id} url={detail.manage_url} tail={99} /></div>
            <div className="id-detail"><span>{t("رقم الحملة")}</span><IdCell id={detail.campaign_id} tail={99} /></div>
            <div className="id-detail"><span>{t("رقم المجموعة الإعلانية")}</span><IdCell id={detail.adset_id} tail={99} /></div>
            {detail.manage_url && (
              <a className="btn orange" href={detail.manage_url} target="_blank" rel="noreferrer" style={{ marginTop: 14, display: "inline-block" }}>
                {t("افتح في مدير إعلانات Meta")} ↗
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}
