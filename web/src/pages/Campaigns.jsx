import { useFetch, fmt0, fmt2 } from "../components/useFetch.js";
import DataTable from "../components/DataTable.jsx";
import IdCell from "../components/IdCell.jsx";
import { useI18n } from "../i18n.jsx";
import { useCurrency } from "../currency.jsx";

const statusBadge = (s) => {
  const cls = s === "WITH_ISSUES" ? "b-issue" : s === "PAUSED" ? "b-paused" : "b-active";
  return <span className={`badge ${cls}`}>{s || "—"}</span>;
};

export default function Campaigns() {
  const { t } = useI18n();
  const { money } = useCurrency();
  const { data, loading, error } = useFetch("/analytics/campaigns");
  if (loading) return <p>{t("جارٍ التحميل…")}</p>;
  if (error) return <p className="err">{error}</p>;
  const cols = [
    { key: "campaign_name", label: t("الحملة") },
    { key: "campaign_id", label: t("المعرّف"), render: (r) => <IdCell id={r.campaign_id} url={r.manage_url} /> },
    { key: "status", label: t("الحالة"), render: (r) => statusBadge(r.status) },
    { key: "spend_aed", label: t("الإنفاق"), num: true, render: (r) => money(r.spend_aed) },
    { key: "impressions", label: t("الظهور"), num: true, render: (r) => fmt0(r.impressions) },
    { key: "clicks", label: t("النقرات"), num: true, render: (r) => fmt0(r.clicks) },
    { key: "ctr_pct", label: "CTR", num: true, render: (r) => fmt2(r.ctr_pct) + "%" },
    { key: "results", label: t("النتائج"), num: true, render: (r) => fmt0(r.results) },
    { key: "result_type", label: t("النوع") },
    { key: "cpr_aed", label: t("التكلفة"), num: true, render: (r) => money(r.cpr_aed, { decimals: 2 }) },
  ];
  return (
    <>
      <div className="topbar"><h2>{t("أداء الحملات")}</h2></div>
      <div className="section"><DataTable columns={cols} rows={data} initialSort={{ key: "spend_aed", dir: "desc" }} /></div>
    </>
  );
}
