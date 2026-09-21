import { useFetch, fmt0 } from "../components/useFetch.js";
import DataTable from "../components/DataTable.jsx";
import { CONV_TYPE } from "./Conversations.jsx";
import { countryLabel } from "../components/country.js";
import { useI18n } from "../i18n.jsx";

const time = (t) => (t ? new Date(t).toLocaleDateString("en-GB") : "—");

export default function Reengagement() {
  const { t, lang } = useI18n();
  const { data, loading, error } = useFetch("/report/re-engagement?minMsgs=2");
  if (loading) return <p>{t("جارٍ التحميل…")}</p>;
  if (error) return <p className="err">{error}</p>;

  const cols = [
    { key: "full_name", label: t("العميل") },
    { key: "phone", label: t("الهاتف"), render: (r) => <span dir="ltr">{r.phone}</span> },
    { key: "country", label: t("الدولة"), render: (r) => countryLabel(r.phone, r.country, lang) },
    { key: "lead_score", label: "Score", num: true, render: (r) => <span className={`badge b-${r.score_band}`}>{r.lead_score}</span> },
    { key: "customer_msgs", label: t("رسائل العميل"), num: true, render: (r) => fmt0(r.customer_msgs) },
    { key: "conv_type", label: t("التصنيف"), render: (r) => <span className={`tag ${CONV_TYPE[r.conv_type]?.cls || ""}`}>{CONV_TYPE[r.conv_type] ? t(CONV_TYPE[r.conv_type].label) : r.conv_type}</span> },
    { key: "ad_name", label: t("الإعلان") },
    { key: "contact_owner", label: t("المسؤول") },
    { key: "last_activity", label: t("آخر نشاط"), render: (r) => time(r.last_activity) },
  ];

  return (
    <>
      <div className="topbar">
        <h2>{t("قائمة إعادة التواصل — ليدات مدفوعة بلا رد بشري")}</h2>
        <a className="btn ghost" href={`/api/report/re-engagement.csv?minMsgs=2&lang=${lang}`}>{t("تصدير CSV")}</a>
      </div>
      <div className="note">{t("عملاء أرسلوا رسالتين أو أكثر لكن المحادثة بقيت «بانتظار رد» أو «بوت فقط» دون تدخّل موظف — فرصة استرداد عالية القيمة. مرتّبة حسب درجة الاهتمام. اتصل بهم أو أعِد إسنادهم لفريق المبيعات.")}</div>
      <div className="section">
        <p className="muted" style={{ marginBottom: 10 }}>{t("{n} عميل للمتابعة", { n: data.length })}</p>
        <DataTable columns={cols} rows={data} initialSort={{ key: "lead_score", dir: "desc" }} />
      </div>
    </>
  );
}
