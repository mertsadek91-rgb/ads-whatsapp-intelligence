// Per-country lead analysis: which countries the customers actually came from
// (derived from each contact's phone dial-code — the Wati country field is
// empty), how many qualified, Meta spend served there, and a keep/watch/close
// verdict — so the owner can decide which country to keep spending on and
// which to close a campaign on (esp. multi-country experimental campaigns).
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { useFetch, fmt0, fmt2 } from "../components/useFetch.js";
import DataTable from "../components/DataTable.jsx";
import { useDateRange } from "../components/DateRangeContext.jsx";
import { useI18n } from "../i18n.jsx";
import { useCurrency } from "../currency.jsx";

const VERDICT = {
  keep: { label: "استمر", cls: "good" },
  watch: { label: "راقب", cls: "" },
  close: { label: "أغلِق", cls: "bad" },
};

export default function Countries() {
  const { t } = useI18n();
  const { money } = useCurrency();
  const dr = useDateRange();
  const path = `/analytics/countries?${dr.qs}`;
  const { data, loading, error } = useFetch(path, [path]);

  const rows = data?.rows || [];
  const totals = data?.totals;
  const chartData = rows.slice(0, 12).map((r) => ({ name: `${r.flag} ${t(r.ar)}`, contacts: r.contacts, qualified: r.qualified }));

  const cols = [
    { key: "ar", label: t("الدولة"), render: (r) => <span>{r.flag} {t(r.ar)}</span> },
    { key: "contacts", label: t("العملاء"), num: true, render: (r) => <b>{fmt0(r.contacts)}</b> },
    { key: "contacted", label: t("تواصل بشري"), num: true, render: (r) => fmt0(r.contacted) },
    { key: "qualified", label: t("المهتمون"), num: true, render: (r) => <span style={{ color: Number(r.qualified) > 0 ? "var(--green)" : undefined }}>{fmt0(r.qualified)}</span> },
    { key: "qual_rate_pct", label: t("نسبة التأهّل"), num: true, render: (r) => fmt2(r.qual_rate_pct) + "%" },
    { key: "deposits", label: t("إيداعات"), num: true, render: (r) => fmt0(r.deposits) },
    { key: "spend_aed", label: t("الإنفاق"), num: true, render: (r) => r.spend_aed != null ? money(r.spend_aed) : "—" },
    { key: "cost_per_lead", label: t("تكلفة الليد"), num: true, render: (r) => r.cost_per_lead != null ? money(r.cost_per_lead, { decimals: 2 }) : "—" },
    { key: "cost_per_qualified", label: t("تكلفة المهتم"), num: true, render: (r) => r.cost_per_qualified != null ? money(r.cost_per_qualified, { decimals: 2 }) : "—" },
    { key: "top_campaigns", label: t("أبرز الحملات"), render: (r) => (
      <span title={(r.top_campaigns || []).map((c) => `${c.name} (${c.n})`).join(" · ")}>
        {(r.top_campaigns || []).slice(0, 2).map((c) => (c.name || "").slice(0, 22)).join("، ") || "—"}
      </span>
    ) },
    { key: "employees", label: t("الموظفون"), render: (r) => (r.employees || []).length
      ? <span title={r.employees.join("، ")}>{r.employees.join("، ")}</span> : "—" },
    { key: "verdict", label: t("التوصية"), render: (r) => r.verdict && VERDICT[r.verdict]
      ? <span className={`badge ${VERDICT[r.verdict].cls === "good" ? "b-active" : VERDICT[r.verdict].cls === "bad" ? "b-issue" : "b-paused"}`}>{t(VERDICT[r.verdict].label)}</span>
      : "—" },
  ];

  return (
    <>
      <div className="topbar"><h2>{t("تحليل البلدان — من أين يأتي العملاء وأين ننفق")}</h2></div>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t("الدولة مُشتقّة من رمز هاتف العميل؛ الإنفاق حسب استهداف Meta للجمهور. قارن العملاء بالمهتمين وتكلفة الليد لتقرّر أين تستمر وأين تُغلق.")}
      </p>
      {loading && <p>{t("جارٍ التحميل…")}</p>}
      {error && <p className="err">{error}</p>}

      {totals && (
        <div className="kpis" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="label">{t("عدد الدول")}</div><div className="val">{fmt0(totals.countries)}</div></div>
          <div className="kpi"><div className="label">{t("إجمالي العملاء")}</div><div className="val">{fmt0(totals.contacts)}</div></div>
          <div className="kpi"><div className="label">{t("إجمالي المهتمين")}</div><div className="val">{fmt0(totals.qualified)}</div></div>
          <div className="kpi"><div className="label">{t("إجمالي الإنفاق")}</div><div className="val">{totals.has_spend ? money(totals.spend_aed) : "—"}</div></div>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="section">
          <h3>{t("العملاء والمهتمون حسب الدولة")}</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, n) => [Number(v).toLocaleString("en-US"), n]} />
              <Legend verticalAlign="top" height={32} />
              <Bar dataKey="contacts" name={t("العملاء")} fill="#0091AE" radius={[4, 4, 0, 0]} />
              <Bar dataKey="qualified" name={t("المهتمون")} fill="#00BDA5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {rows.length > 0 && <div className="section"><DataTable columns={cols} rows={rows} initialSort={{ key: "contacts", dir: "desc" }} /></div>}
      {data && rows.length === 0 && <p className="muted">{t("لا بيانات ضمن النطاق المحدّد.")}</p>}
      {totals && !totals.has_spend && (
        <p className="muted" style={{ fontSize: 12 }}>{t("إنفاق Meta حسب البلد يظهر بعد أول مزامنة تشمل تقسيم البلد.")}</p>
      )}
    </>
  );
}
