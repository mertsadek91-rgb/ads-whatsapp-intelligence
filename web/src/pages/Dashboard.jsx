import { useState } from "react";
import { useFetch, fmt0 } from "../components/useFetch.js";
import TrendChart from "../components/TrendChart.jsx";
import FilterBar from "../components/FilterBar.jsx";
import { useDateRange } from "../components/DateRangeContext.jsx";
import { useI18n } from "../i18n.jsx";
import { useCurrency } from "../currency.jsx";

function Kpi({ label, val }) {
  return <div className="kpi"><div className="label">{label}</div><div className="val">{val}</div></div>;
}

export default function Dashboard() {
  const { t } = useI18n();
  const { money, currency, rates } = useCurrency();
  const dr = useDateRange();
  const s = useFetch(`/analytics/summary?${dr.qs}`, [dr.qs]);
  const monthly = useFetch("/analytics/monthly");
  const daily = useFetch(`/analytics/daily?${dr.qs}`, [dr.qs]);

  // Chart series store raw AED — convert the money-denominated ones before
  // charting so bar heights/tooltips match the selected currency. Also sort
  // ascending by the x key: the daily endpoint returns DESC while monthly
  // returns ASC, which made the two charts read in OPPOSITE directions.
  const rate = rates[currency] || 1;
  const prep = (rows, moneyKey, xKey) => [...(rows || [])]
    .map((r) => ({ ...r, [moneyKey]: r[moneyKey] != null ? Number(r[moneyKey]) * rate : r[moneyKey] }))
    .sort((a, b) => String(a[xKey]).localeCompare(String(b[xKey])));

  // Daily x values arrive as raw ISO timestamps ("2026-04-09T00:00:00.000Z") —
  // show DD/MM instead of the unreadable full string.
  const dayFormat = (d) => { const s10 = String(d).slice(0, 10); return `${s10.slice(8, 10)}/${s10.slice(5, 7)}`; };
  const moneyFormat = (v, name, item) =>
    String(item?.dataKey || "").startsWith("spend") ? money(v) : (v == null ? "—" : Number(v).toLocaleString("en-US"));

  const bars = [{ key: "spend", name: `${t("الإنفاق")} (${currency})`, color: "#2D3748" }];
  const lines = [
    { key: "qualified", name: t("مؤهّل"), color: "#FF7A59" },
    { key: "contacts", name: t("جهات"), color: "#0091AE" },
  ];

  return (
    <>
      <div className="topbar"><h2>{t("لوحة المؤشرات")}</h2></div>
      <FilterBar note="التاريخ يصفّي جهات الاتصال والمؤهّلين والاتجاهات. الإنفاق إجمالي الفترة." />

      {s.loading && <p>{t("جارٍ التحميل…")}</p>}
      {s.error && <p className="err">{s.error}</p>}
      {s.data && (
        <div className="kpis">
          <Kpi label={t("إجمالي الإنفاق")} val={money(s.data.spend)} />
          <Kpi label={t("محادثات Meta")} val={fmt0(s.data.convos)} />
          <Kpi label={t("جهات اتصال (Wati)")} val={fmt0(s.data.contacts)} />
          <Kpi label={t("مرتبطة بإعلان")} val={fmt0(s.data.attributed)} />
          <Kpi label={t("عملاء مؤهّلون")} val={fmt0(s.data.qualified)} />
          <Kpi label={t("تكلفة العميل المؤهّل")} val={s.data.cost_per_qualified ? money(s.data.cost_per_qualified) : "—"} />
          <Kpi label={t("حسابات حقيقية")} val={fmt0(s.data.real_accounts)} />
          <Kpi label={t("مودِعون / إجمالي الإيداع")} val={`${fmt0(s.data.depositors)} / ${money(s.data.deposit_total)}`} />
        </div>
      )}

      <CompareSection />
      <HighlightsSection qs={dr.qs} />
      <EmployeeRankingSection />

      <div className="section">
        <h3>{t("الاتجاه الشهري")}</h3>
        {monthly.data && (
          <TrendChart data={prep(monthly.data, "spend", "month")} xKey="month" bars={bars} lines={lines} valueFormat={moneyFormat} />
        )}
      </div>

      <div className="section">
        <h3>{t("الاتجاه اليومي")}</h3>
        {daily.data && daily.data.length > 0 ? (
          <TrendChart data={prep(daily.data, "spend_aed", "day")} xKey="day"
            bars={[{ ...bars[0], key: "spend_aed" }]} lines={lines} xFormat={dayFormat} valueFormat={moneyFormat} />
        ) : <p className="muted">{t("لا بيانات يومية ضمن النطاق المحدّد.")}</p>}
      </div>
    </>
  );
}

const PERIODS = [
  { key: "week", label: "أسبوع" },
  { key: "month", label: "شهر" },
  { key: "year", label: "سنة" },
];

// Period-over-period deltas: last N days vs the N before them. Coloring is
// semantic per metric — more leads/qualified is good (green when up), but a
// higher cost-per-lead is bad (red when up) — not a blanket up=green.
function CompareSection() {
  const { t } = useI18n();
  const { money } = useCurrency();
  const [period, setPeriod] = useState("month");
  const { data, loading } = useFetch(`/analytics/compare?period=${period}`, [period]);

  const c = data?.current, p = data?.previous, ch = data?.change;
  const metrics = c ? [
    { label: t("عدد الليدات"), cur: fmt0(c.contacts), prev: fmt0(p.contacts), pct: ch.contacts_pct, upIsGood: true },
    { label: t("عملاء مؤهّلون"), cur: fmt0(c.qualified), prev: fmt0(p.qualified), pct: ch.qualified_pct, upIsGood: true },
    { label: t("تكلفة الليد"), cur: c.cost_per_contact != null ? money(c.cost_per_contact, { decimals: 2 }) : "—", prev: p.cost_per_contact != null ? money(p.cost_per_contact, { decimals: 2 }) : "—", pct: ch.cost_per_contact_pct, upIsGood: false },
    { label: t("تكلفة المؤهّل"), cur: c.cost_per_qualified != null ? money(c.cost_per_qualified) : "—", prev: p.cost_per_qualified != null ? money(p.cost_per_qualified) : "—", pct: ch.cost_per_qualified_pct, upIsGood: false },
    { label: t("الإنفاق"), cur: money(c.spend), prev: money(p.spend), pct: ch.spend_pct, upIsGood: null },
  ] : [];

  return (
    <div className="section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>{t("📊 مقارنة الفترات — صعود أم هبوط؟")}</h3>
        <div className="presets">
          {PERIODS.map((pr) => (
            <button key={pr.key} className={`chip ${period === pr.key ? "active" : ""}`} onClick={() => setPeriod(pr.key)}>
              {t(pr.label)}
            </button>
          ))}
        </div>
      </div>
      {data && (
        <p className="muted" style={{ margin: "6px 0 12px" }}>
          {t("آخر {n} يوماً مقارنةً بالـ {n} يوماً التي قبلها.", { n: data.days })}
        </p>
      )}
      {loading && <p>{t("جارٍ التحميل…")}</p>}
      {c && (
        <>
          <div className="kpis">
            {metrics.map((m) => <DeltaCard key={m.label} {...m} />)}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            {c.best_day && (
              <span className="tag good">
                🏆 {t("أفضل يوم")}: {new Date(c.best_day.day).toLocaleDateString("en-GB")} — {c.best_day.qualified} {t("مؤهّل")} / {c.best_day.contacts} {t("ليد")}
              </span>
            )}
            <span className="tag">
              📈 {t("متوسط الليدات يومياً")}: {c.avg_daily_contacts}
              {p.avg_daily_contacts ? ` (${t("سابقاً")}: ${p.avg_daily_contacts})` : ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// Best campaign / best ad / best post — "best" = most qualified customers
// produced (the business outcome), matching the server's ranking rule.
function HighlightsSection({ qs }) {
  const { t } = useI18n();
  const { money } = useCurrency();
  const { data } = useFetch(`/analytics/highlights?${qs}`, [qs]);
  if (!data || (!data.best_campaign && !data.best_ad && !data.best_post)) return null;
  const c = data.best_campaign, a = data.best_ad, p = data.best_post;

  const Stat = ({ label, val }) => (
    <div style={{ background: "var(--surface-1)", borderRadius: 8, padding: "4px 10px", fontSize: 12 }}>
      <span className="muted">{label}: </span><b>{val}</b>
    </div>
  );

  return (
    <div className="section">
      <h3>{t("🏆 أبرز النتائج")}</h3>
      <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {c && (
          <div className="d-block" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
            <h4>{t("أفضل حملة إعلانية")}</h4>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{c.campaign_name}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Stat label={t("مؤهّل")} val={fmt0(c.qualified)} />
              <Stat label={t("جهات")} val={fmt0(c.contacts)} />
              <Stat label={t("الإنفاق")} val={money(c.spend_aed)} />
              {c.cost_per_qualified != null && <Stat label={t("تكلفة المؤهّل")} val={money(c.cost_per_qualified)} />}
            </div>
          </div>
        )}
        {a && (
          <div className="d-block" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, display: "flex", gap: 10 }}>
            {a.thumbnail_url && <img src={a.thumbnail_url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}>
              <h4>{t("أفضل إعلان")}</h4>
              <div style={{ fontWeight: 700, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.ad_name}>{a.ad_name}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Stat label={t("مؤهّل")} val={fmt0(a.qualified)} />
                <Stat label={t("جهات")} val={fmt0(a.contacts)} />
                {a.cost_per_qualified != null && <Stat label={t("تكلفة المؤهّل")} val={money(a.cost_per_qualified)} />}
              </div>
            </div>
          </div>
        )}
        {p && (
          <div className="d-block" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, display: "flex", gap: 10 }}>
            {p.thumbnail_url && <img src={p.thumbnail_url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}>
              <h4>{t("أفضل بوست")}</h4>
              <a href={p.post_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, display: "block", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "ltr" }}>{p.post_url.replace(/^https?:\/\/(www\.)?/, "")}</a>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Stat label={t("مؤهّل")} val={fmt0(p.qualified)} />
                <Stat label={t("جهات")} val={fmt0(p.contacts)} />
                {p.qual_rate_pct != null && <Stat label={t("% التأهّل")} val={`${p.qual_rate_pct}%`} />}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Employee of the week/month + top ranking. The winner title respects the
// min-N fairness gate (an agent with 2 conversations can't "win" over one
// with 60) — below-threshold agents still appear in the list.
function EmployeeRankingSection() {
  const { t } = useI18n();
  const [period, setPeriod] = useState("month");
  const { data, loading } = useFetch(`/analytics/employee-ranking?period=${period}`, [period]);
  const w = data?.winner;

  return (
    <div className="section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>{t("👥 تقرير الموظفين")}</h3>
        <div className="presets">
          <button className={`chip ${period === "week" ? "active" : ""}`} onClick={() => setPeriod("week")}>{t("أسبوع")}</button>
          <button className={`chip ${period === "month" ? "active" : ""}`} onClick={() => setPeriod("month")}>{t("شهر")}</button>
        </div>
      </div>
      {loading && <p>{t("جارٍ التحميل…")}</p>}
      {data && !data.ranking.length && <p className="muted" style={{ marginTop: 8 }}>{t("لا محادثات محلّلة لموظفين في هذه الفترة.")}</p>}
      {w && (
        <div className="d-block" style={{ marginTop: 10, background: "var(--success-tint)", borderRadius: 10, padding: "10px 14px" }}>
          <b>🏆 {period === "week" ? t("موظف الأسبوع") : t("موظف الشهر")}: {w.agent}</b>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            {t("{n} محادثة", { n: w.conversations })} · {w.results} {t("نتيجة (ساخن+دافئ)")} · {t("متوسط الأداء")} {w.avg_score ?? "—"}
            {w.wrong_persuasion ? <span className="bad"> · ⚠ {w.wrong_persuasion} {t("إقناع خاطئ")}</span> : null}
          </div>
        </div>
      )}
      {data?.ranking.length > 0 && (
        <>
          <table style={{ width: "100%", marginTop: 12, fontSize: 12.5 }}>
            <thead><tr>
              <th style={{ textAlign: "start" }}>#</th><th style={{ textAlign: "start" }}>{t("الموظف")}</th>
              <th>{t("محادثات")}</th><th>{t("ساخن")}</th><th>{t("دافئ")}</th>
              <th>{t("متوسط الأداء")}</th><th>{t("إقناع خاطئ")}</th>
            </tr></thead>
            <tbody>
              {data.ranking.slice(0, 5).map((a, i) => (
                <tr key={a.agent} style={{ borderTop: "1px solid var(--border)" }}>
                  <td>{i + 1}</td>
                  <td style={{ fontWeight: i === 0 ? 700 : 400 }}>{a.agent}{a.conversations < data.min_n && <span className="muted" title={t("أقل من الحد الأدنى للعينة ({n} محادثة)", { n: data.min_n })}> *</span>}</td>
                  <td style={{ textAlign: "center" }}>{a.conversations}</td>
                  <td style={{ textAlign: "center", color: "var(--green)" }}>{a.hot}</td>
                  <td style={{ textAlign: "center", color: "var(--orange)" }}>{a.warm}</td>
                  <td style={{ textAlign: "center" }}>{a.avg_score ?? "—"}</td>
                  <td style={{ textAlign: "center" }}>{a.wrong_persuasion ? <span className="bad">{a.wrong_persuasion}</span> : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 8, fontSize: 11.5 }}>
            * {t("أقل من الحد الأدنى للعينة ({n} محادثة)", { n: data?.min_n })} — <a href="/employees">{t("التقرير الكامل لكل موظف ←")}</a>
          </p>
        </>
      )}
    </div>
  );
}

function DeltaCard({ label, cur, prev, pct, upIsGood }) {
  const { t } = useI18n();
  let color = "var(--gray)", arrow = "•";
  if (pct != null && pct !== 0) {
    arrow = pct > 0 ? "▲" : "▼";
    if (upIsGood === null) color = "var(--gray)";
    else color = (pct > 0) === upIsGood ? "var(--green)" : "var(--red)";
  }
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="val">{cur}</div>
      <div style={{ fontSize: 12, marginTop: 2 }}>
        <b style={{ color }}>{arrow} {pct != null ? `${Math.abs(pct)}%` : "—"}</b>
        <span className="muted" style={{ marginInlineStart: 6 }}>{t("مقابل")} {prev}</span>
      </div>
    </div>
  );
}
