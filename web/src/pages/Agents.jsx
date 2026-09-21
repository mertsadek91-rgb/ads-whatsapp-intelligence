import { useFetch, fmt0, fmt2 } from "../components/useFetch.js";
import DataTable from "../components/DataTable.jsx";
import FilterBar from "../components/FilterBar.jsx";
import { useDateRange } from "../components/DateRangeContext.jsx";
import { useI18n } from "../i18n.jsx";

export default function Agents() {
  const { t } = useI18n();
  const dr = useDateRange();
  const path = `/analytics/agents?${dr.qs}`;
  const { data, loading, error } = useFetch(path, [path]);
  const cols = [
    { key: "agent", label: t("المسؤول") },
    { key: "contacts", label: t("جهات الاتصال"), num: true, render: (r) => fmt0(r.contacts) },
    { key: "qualified", label: t("مؤهّل"), num: true, render: (r) => <b>{fmt0(r.qualified)}</b> },
    { key: "qual_rate_pct", label: t("نسبة التأهّل"), num: true, render: (r) => fmt2(r.qual_rate_pct) + "%" },
    { key: "avg_first_response_min", label: t("متوسط أول رد (د)"), num: true, render: (r) => fmt2(r.avg_first_response_min) },
  ];
  return (
    <>
      <div className="topbar"><h2>{t("أداء المسؤولين (Contact Owner)")}</h2></div>
      <FilterBar />
      {loading && <p>{t("جارٍ التحميل…")}</p>}
      {error && <p className="err">{error}</p>}
      {data && <div className="section"><DataTable columns={cols} rows={data} initialSort={{ key: "contacts", dir: "desc" }} /></div>}
    </>
  );
}
