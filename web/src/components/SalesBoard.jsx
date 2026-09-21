// Sales-floor communication dashboard — light theme (matches the owner's design
// mockup). Presentational + fully data-driven; self-contained styling scoped
// under `.ebd` so it renders identically on the public kiosk route and inside
// the app Layout without colliding with global CSS. Used by SalesScreen (kiosk)
// and the in-app Salesboard page.
import { useState, useEffect } from "react";
import { useI18n, translate } from "../i18n.jsx";

const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

// initials from a name's first two words (falls back to first 2 chars).
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
const AVATAR_BG = ["linear-gradient(135deg,#0ea5e9,#6366f1)", "linear-gradient(135deg,#ec4899,#8b5cf6)",
  "linear-gradient(135deg,#f59e0b,#ef4444)", "linear-gradient(135deg,#10b981,#0ea5e9)",
  "linear-gradient(135deg,#64748b,#334155)", "linear-gradient(135deg,#a855f7,#ec4899)"];

const STATUS_LABEL = { excellent: "ممتاز", average: "متوسط", poor: "يحتاج تحسين", inactive: "بدون بيانات" };
const FILL_CLASS = { excellent: "", average: "warn", poor: "bad", inactive: "bad" };

function fmtResponse(min, lang = "ar") {
  if (min == null) return { text: "—", cls: "kpi-neutral" };
  const U = lang === "en" ? { h: "h", m: "m" } : { h: "س", m: "د" };
  const cls = min <= 60 ? "kpi-good" : min <= 240 ? "kpi-warn" : "kpi-bad";
  if (min < 60) return { text: `${Math.round(min)} ${U.m}`, cls };
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return { text: m ? `${h}${U.h} ${m}${U.m}` : `${h}${U.h}`, cls };
}

function Trend({ d }) {
  if (d == null) return <span className="trend flat">—</span>;
  if (d === 0) return <span className="trend flat">→ 0%</span>;
  return d > 0 ? <span className="trend up">▲ {Math.abs(d)}%</span> : <span className="trend down">▼ {Math.abs(d)}%</span>;
}

export default function SalesBoard({ data, updatedLabel, lang }) {
  const i18n = useI18n();
  // `lang` prop forces a fixed language (the kiosk screen is English-only);
  // otherwise follow the app-wide setting.
  const activeLang = lang || i18n.lang || "ar";
  const t = lang ? (s, vars) => translate(s, lang, vars) : i18n.t;
  const dir = activeLang === "en" ? "ltr" : "rtl";
  const locale = activeLang === "en" ? "en-GB" : "ar-AE";
  const [clock, setClock] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [locale]);

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const daily = data?.daily || [];
  const win = data?.window || {};
  const teamResp = fmtResponse(totals.avg_response_min, activeLang);
  const dateRange = (win.since && win.until)
    ? `${new Date(win.since + "T00:00:00Z").toLocaleDateString(locale, { day: "numeric", month: "long" })} — ${new Date(win.until + "T00:00:00Z").toLocaleDateString(locale, { day: "numeric", month: "long" })}`
    : "";
  // Contact rate is already a percentage, so the chart reads against a full
  // 0–100 axis (not against the best day) — that is what makes a 60% day look
  // visibly worse than a 93% one instead of merely a little shorter.
  const target = data?.target ?? 90;
  const maxRate = Math.max(100, ...daily.map((d) => d.rate));
  // rounded so the inline style reads "59.7%", not "59.699999999999996%"
  const barPct = (rate) => Math.max(3, Math.round((rate / maxRate) * 1000) / 10);
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : rows;

  const leadFoot = totals.leads_delta_pct == null ? t("لا توجد فترة سابقة للمقارنة")
    : `${totals.leads_delta_pct > 0 ? "+" : ""}${totals.leads_delta_pct}% ${t("مقارنة بالأسبوع السابق")}`;
  const wrongFoot = totals.wrong_delta == null || totals.wrong_delta === 0 ? t("بدون تغيّر عن الأسبوع السابق")
    : totals.wrong_delta < 0 ? `${t("انخفاض بمقدار")} ${Math.abs(totals.wrong_delta)} ${t("عن الأسبوع السابق")}`
    : `${t("ارتفاع بمقدار")} ${totals.wrong_delta} ${t("عن الأسبوع السابق")}`;

  return (
    <div className="ebd" dir={dir}>
      <style>{ebdCss}</style>

      <section className="topbar">
        <div className="title-wrap">
          <h1>{t("لوحة أداء التواصل")}</h1>
          <p>{t("تحليل نتائج الموظفين في التواصل مع العملاء خلال آخر 7 أيام")}</p>
        </div>
        <div className="top-actions">
          <div className="live-chip"><span className="pulse" /> {t("تحديث مباشر")}</div>
          {dateRange && <div className="date-chip">{dateRange}</div>}
          <div className="clock">{clock}</div>
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-card white">
          <div className="stat-head"><span>{t("إجمالي العملاء")}</span><span className="stat-icon">👥</span></div>
          <div className="stat-value">{fmt(totals.leads)}</div>
          <div className="stat-foot">{leadFoot}{totals.unavailable ? ` · +${fmt(totals.unavailable)} ${t("على رقم غير مرتبط")}` : ""}</div>
        </article>
        <article className="stat-card green">
          <div className="stat-head"><span>{t("تم التواصل")}</span><span className="stat-icon">✓</span></div>
          <div className="stat-value">{fmt(totals.contacted)}</div>
          <div className="stat-foot">{fmt(totals.within_2h)} {t("عميلًا تم الرد عليهم خلال ساعتين")}</div>
        </article>
        <article className="stat-card yellow">
          <div className="stat-head"><span>{t("نسبة التواصل")}</span><span className="stat-icon">%</span></div>
          <div className="stat-value">{fmt(totals.contact_rate_pct)}%</div>
          <div className="stat-foot">{t("الهدف")}: {target}%</div>
        </article>
        <article className="stat-card red">
          <div className="stat-head"><span>{t("لم يتم التواصل")}</span><span className="stat-icon">!</span></div>
          <div className="stat-value">{fmt(totals.not_contacted)}</div>
          <div className="stat-foot">{t("تحتاج إلى متابعة فورية")}</div>
        </article>
        <article className="stat-card green">
          <div className="stat-head"><span>{t("المهتمون")}</span><span className="stat-icon">★</span></div>
          <div className="stat-value">{fmt(totals.interested)}</div>
          <div className="stat-foot">{fmt(totals.interested_rate_pct)}% {t("من العملاء الذين تم التواصل معهم")}</div>
        </article>
        <article className="stat-card blue">
          <div className="stat-head"><span>{t("متوسط زمن الرد")}</span><span className="stat-icon">⏱</span></div>
          <div className="stat-value">{teamResp.text}</div>
          <div className="stat-foot">{t("متوسط زمن أول رد بشري")}</div>
        </article>
      </section>

      <section className="insight-row">
        <article className="panel">
          <div className="panel-head">
            <div><h2 className="panel-title">{t("نجم الأسبوع")}</h2><p className="panel-sub">{t("أعلى نسبة تواصل وجودة متابعة")}</p></div>
            <span style={{ fontSize: 24 }}>🏆</span>
          </div>
          {data?.top ? (
            <div className="star-card">
              <div className="avatar">{initials(data.top.name)}</div>
              <div>
                <div className="star-name">{data.top.name}</div>
                <div className="star-meta">{fmt(data.top.contacted)} {t("من أصل")} {fmt(data.top.leads)} {t("عميلًا تم التواصل معهم")}</div>
              </div>
              <div className="score-badge">{data.top.contact_rate_pct}%<small>{t("نسبة التواصل")}</small></div>
            </div>
          ) : <div className="star-card"><div className="star-meta">{t("لا بيانات بعد لهذه الفترة.")}</div></div>}
        </article>

        <article className="panel">
          <div className="panel-head">
            <div><h2 className="panel-title">{t("اتجاه الأداء اليومي")}</h2><p className="panel-sub">{t("نسبة التواصل لكل يوم خلال الفترة المحددة")}</p></div>
          </div>
          <div className="chart-wrap">
            <div className="bars">
              {/* The plot is a fixed-height box so a bar's percentage height has
                  something definite to resolve against — without it every bar
                  fell back to its min-height and the chart read as a flat line.
                  Day labels live in their own row so the target line can be
                  positioned against the plot alone. */}
              <div className="bar-plot">
                <div className="bar-target" style={{ bottom: `${barPct(target)}%` }}>
                  <span>{t("الهدف")} {target}%</span>
                </div>
                {daily.map((d) => (
                  <div className="bar-col" key={d.date}>
                    <div className={`bar${d.rate >= target ? " ok" : ""}`} title={`${d.rate}%`}
                      style={{ height: `${barPct(d.rate)}%` }}>
                      <span className="bar-value">{d.rate}%</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bar-labels">
                {daily.map((d) => (
                  <div className="bar-label" key={d.date}>
                    {new Date(d.date + "T00:00:00Z").toLocaleDateString(locale, { weekday: "short" })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="table-toolbar">
          <div><h2 className="panel-title">{t("تفاصيل أداء الموظفين")}</h2><p className="panel-sub">{t("ترتيب الموظفين حسب نسبة التواصل مع العملاء")}</p></div>
          <div className="search"><span>⌕</span><input type="text" placeholder={t("البحث باسم الموظف...")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="legend">
            <span><i style={{ background: "#22c55e" }} /> {t("ممتاز")}</span>
            <span><i style={{ background: "#f59e0b" }} /> {t("متوسط")}</span>
            <span><i style={{ background: "#ef4444" }} /> {t("يحتاج تحسين")}</span>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr>
              <th>#</th><th className="employee-col">{t("الموظف")}</th><th>{t("الحالة")}</th>
              <th>{t("نسبة التواصل")}</th><th>{t("العملاء")}</th><th>{t("تم التواصل")}</th>
              <th>{t("لم يتم التواصل")}</th><th>{t("المهتمون")}</th><th>{t("متوسط زمن الرد")}</th>
              <th>{t("تواصل خاطئ")}</th><th>{t("مقارنة بالأسبوع السابق")}</th>
            </tr></thead>
            <tbody>
              {filtered.map((r) => {
                const resp = fmtResponse(r.avg_response_min, activeLang);
                return (
                  <tr key={r.name}>
                    <td><span className="rank">{r.rank}</span></td>
                    <td>
                      <div className="employee">
                        <div className="avatar" style={{ background: AVATAR_BG[(r.rank - 1) % AVATAR_BG.length] }}>{initials(r.name)}</div>
                        <div><strong>{r.name}</strong><span>{t("موظف مبيعات")}</span></div>
                      </div>
                    </td>
                    <td><span className={`status ${r.status}`}>{t(STATUS_LABEL[r.status] || r.status)}</span></td>
                    <td className="progress-cell">
                      <div className="progress-top">
                        <strong className={r.status === "excellent" ? "kpi-good" : r.status === "average" ? "kpi-warn" : "kpi-bad"}>{r.contact_rate_pct}%</strong>
                        <span className="kpi-neutral">{fmt(r.contacted)}/{fmt(r.leads)}</span>
                      </div>
                      <div className="progress-track"><div className={`progress-fill ${FILL_CLASS[r.status]}`} style={{ width: `${Math.min(100, r.contact_rate_pct)}%` }} /></div>
                    </td>
                    <td className="kpi-neutral">{fmt(r.leads)}</td>
                    <td className="kpi-good">{fmt(r.contacted)}</td>
                    <td className={r.not_contacted ? "kpi-bad" : "kpi-neutral"}>{fmt(r.not_contacted)}</td>
                    <td className="kpi-good">{fmt(r.interested)}</td>
                    <td className={resp.cls}>{resp.text}</td>
                    <td className={r.wrong_persuasion ? "kpi-bad" : "kpi-neutral"}>{r.wrong_persuasion ? `⚠ ${r.wrong_persuasion}` : "0"}</td>
                    <td><Trend d={r.delta_pct} /></td>
                  </tr>
                );
              })}
              {!q && data?.unassigned && data.unassigned.leads > 0 && (() => {
                const u = data.unassigned; const resp = fmtResponse(u.avg_response_min, activeLang);
                return (
                  <tr className="ebd-unassigned">
                    <td><span className="rank">—</span></td>
                    <td>
                      <div className="employee">
                        <div className="avatar" style={{ background: "#94a3b8" }}>🤖</div>
                        <div><strong>{t("غير مُسند / بوت")}</strong><span>{t("لم يستلمها موظف بشري")}</span></div>
                      </div>
                    </td>
                    <td><span className="status inactive">{t("غير مُسند")}</span></td>
                    <td className="progress-cell">
                      <div className="progress-top">
                        <strong className="kpi-bad">{u.contact_rate_pct}%</strong>
                        <span className="kpi-neutral">{fmt(u.contacted)}/{fmt(u.leads)}</span>
                      </div>
                      <div className="progress-track"><div className="progress-fill bad" style={{ width: `${Math.min(100, u.contact_rate_pct)}%` }} /></div>
                    </td>
                    <td className="kpi-neutral">{fmt(u.leads)}</td>
                    <td className="kpi-good">{fmt(u.contacted)}</td>
                    <td className={u.not_contacted ? "kpi-bad" : "kpi-neutral"}>{fmt(u.not_contacted)}</td>
                    <td className="kpi-good">{fmt(u.interested)}</td>
                    <td className={resp.cls}>{resp.text}</td>
                    <td className="kpi-neutral">—</td>
                    <td>—</td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      </section>

      <div className="footer">
        <span>{updatedLabel || ""}</span>
        <span>{t("لوحة التحليلات الداخلية — IST Markets")}</span>
      </div>
    </div>
  );
}

const ebdCss = `
.ebd{ width:min(1920px,100%); margin:auto; padding:24px; color:#0f172a;
  font-family:'Cairo','Segoe UI',Tahoma,Arial,sans-serif;
  background:radial-gradient(circle at 10% 0%, rgba(56,189,248,.10), transparent 30%),
    radial-gradient(circle at 90% 10%, rgba(167,139,250,.10), transparent 28%), #f4f7fb; }
.ebd *{ box-sizing:border-box; }
.ebd .topbar{ display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:22px; }
.ebd .title-wrap h1{ margin:0 0 8px; font-size:clamp(24px,2.2vw,42px); letter-spacing:-.6px; }
.ebd .title-wrap p{ margin:0; color:#64748b; font-size:15px; }
.ebd .top-actions{ display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.ebd .date-chip,.ebd .live-chip,.ebd .clock{ background:#fff; border:1px solid rgba(15,23,42,.10); border-radius:14px;
  padding:11px 14px; color:#334155; box-shadow:0 8px 24px rgba(15,23,42,.06); font-size:14px; white-space:nowrap; }
.ebd .live-chip{ display:flex; align-items:center; gap:8px; color:#15803d; }
.ebd .pulse{ width:9px; height:9px; border-radius:50%; background:#22c55e; box-shadow:0 0 0 0 rgba(34,197,94,.6); animation:ebd-pulse 1.8s infinite; }
@keyframes ebd-pulse{ 70%{box-shadow:0 0 0 10px rgba(34,197,94,0)} 100%{box-shadow:0 0 0 0 rgba(34,197,94,0)} }
.ebd .stats-grid{ display:grid; grid-template-columns:repeat(6,1fr); gap:14px; margin-bottom:18px; }
.ebd .stat-card{ position:relative; background:linear-gradient(180deg,#fff,#f8fafc); border:1px solid rgba(15,23,42,.10);
  border-radius:20px; padding:18px; min-height:124px; overflow:hidden; box-shadow:0 14px 35px rgba(15,23,42,.08); }
.ebd .stat-card::before{ content:""; position:absolute; inset:auto -25px -45px auto; width:110px; height:110px; border-radius:50%; background:var(--accent-soft); filter:blur(2px); }
.ebd .stat-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; color:#64748b; font-size:13px; margin-bottom:17px; }
.ebd .stat-icon{ width:38px; height:38px; border-radius:12px; background:var(--accent-soft); color:var(--accent); display:grid; place-items:center; font-size:18px; font-weight:800; }
.ebd .stat-value{ font-size:34px; font-weight:800; line-height:1; color:var(--accent); }
.ebd .stat-foot{ margin-top:11px; color:#64748b; font-size:12px; }
.ebd .green{ --accent:#16a34a; --accent-soft:rgba(34,197,94,.14); }
.ebd .blue{ --accent:#0284c7; --accent-soft:rgba(56,189,248,.16); }
.ebd .yellow{ --accent:#d97706; --accent-soft:rgba(245,158,11,.16); }
.ebd .red{ --accent:#dc2626; --accent-soft:rgba(239,68,68,.14); }
.ebd .white{ --accent:#0f172a; --accent-soft:rgba(15,23,42,.06); }
.ebd .insight-row{ display:grid; grid-template-columns:1.15fr 2fr; gap:16px; margin-bottom:18px; }
.ebd .panel{ background:linear-gradient(180deg,#fff,#f8fafc); border:1px solid rgba(15,23,42,.10); border-radius:20px; box-shadow:0 14px 35px rgba(15,23,42,.08); }
.ebd .panel-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:18px 20px; border-bottom:1px solid rgba(15,23,42,.10); }
.ebd .panel-title{ margin:0; font-size:17px; }
.ebd .panel-sub{ margin:4px 0 0; color:#64748b; font-size:12px; }
.ebd .star-card{ padding:22px; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:18px; }
.ebd .avatar{ width:70px; height:70px; border-radius:20px; display:grid; place-items:center; font-size:22px; font-weight:800; color:#fff;
  background:linear-gradient(135deg,#0ea5e9,#6366f1); box-shadow:0 12px 30px rgba(14,165,233,.28); }
.ebd .star-name{ font-size:22px; font-weight:800; margin-bottom:6px; }
.ebd .star-meta{ color:#64748b; font-size:13px; }
.ebd .score-badge{ min-width:112px; text-align:center; padding:16px 14px; border-radius:18px; background:rgba(34,197,94,.14); color:#15803d; border:1px solid rgba(34,197,94,.22); font-weight:800; font-size:22px; }
.ebd .score-badge small{ display:block; font-size:11px; color:#16a34a; margin-top:4px; font-weight:500; }
.ebd .chart-wrap{ padding:26px 20px 20px; }
.ebd .bars{ direction:ltr; }
/* fixed-height plot: this is the box every bar's height % resolves against */
.ebd .bar-plot{ position:relative; height:190px; display:flex; align-items:flex-end; justify-content:space-between; gap:14px;
  border-bottom:1px solid rgba(15,23,42,.14); }
.ebd .bar-col{ flex:1; min-width:36px; height:100%; display:flex; align-items:flex-end; justify-content:center; }
.ebd .bar{ width:100%; max-width:54px; border-radius:12px 12px 5px 5px; background:linear-gradient(180deg,#38bdf8,#2563eb);
  position:relative; min-height:4px; box-shadow:0 10px 22px rgba(37,99,235,.2); transition:height .5s cubic-bezier(.22,1,.36,1); }
.ebd .bar.ok{ background:linear-gradient(180deg,#4ade80,#16a34a); box-shadow:0 10px 22px rgba(22,163,74,.22); }
.ebd .bar-value{ position:absolute; top:-21px; left:50%; transform:translateX(-50%); font-size:12px; font-weight:700; color:#334155; }
.ebd .bar-target{ position:absolute; inset-inline:0; border-top:1px dashed rgba(220,38,38,.55); pointer-events:none; }
.ebd .bar-target span{ position:absolute; inset-inline-end:0; top:-17px; font-size:10.5px; font-weight:700; color:#dc2626;
  background:rgba(255,255,255,.85); padding:0 4px; border-radius:4px; }
.ebd .bar-labels{ display:flex; justify-content:space-between; gap:14px; margin-top:8px; }
.ebd .bar-label{ flex:1; min-width:36px; text-align:center; font-size:11.5px; color:#64748b; }
.ebd .table-panel{ overflow:hidden; }
.ebd .table-toolbar{ display:flex; align-items:center; justify-content:space-between; gap:14px; padding:16px 20px; border-bottom:1px solid rgba(15,23,42,.10); flex-wrap:wrap; }
.ebd .search{ min-width:250px; flex:0 1 340px; position:relative; }
.ebd .search input{ width:100%; background:#fff; border:1px solid rgba(15,23,42,.10); color:#0f172a; border-radius:12px; padding-block:11px; padding-inline:12px 40px; outline:none; }
.ebd .search span{ position:absolute; inset-inline-end:14px; top:50%; transform:translateY(-50%); color:#64748b; }
.ebd .legend{ display:flex; gap:14px; color:#64748b; font-size:12px; flex-wrap:wrap; }
.ebd .legend i{ display:inline-block; width:9px; height:9px; border-radius:50%; margin-inline-start:5px; }
.ebd .table-scroll{ overflow:auto; background:#f8fafc; }
.ebd table{ width:100%; border-collapse:separate; border-spacing:0 10px; padding:0 14px 14px; min-width:1180px; }
.ebd th{ color:#64748b; font-size:12px; font-weight:600; padding:12px 14px; text-align:center; white-space:nowrap; }
.ebd th.employee-col{ text-align:start; }
.ebd tbody tr{ background:#fff; box-shadow:0 5px 18px rgba(15,23,42,.045); }
.ebd tbody tr:hover{ background:#f8fafc; }
.ebd td{ padding:15px 14px; text-align:center; border-top:1px solid rgba(15,23,42,.07); border-bottom:1px solid rgba(15,23,42,.07); white-space:nowrap; }
.ebd td:first-child{ border-start-start-radius:14px; border-end-start-radius:14px; border-inline-start:1px solid rgba(15,23,42,.07); }
.ebd td:last-child{ border-start-end-radius:14px; border-end-end-radius:14px; border-inline-end:1px solid rgba(15,23,42,.07); }
.ebd .employee{ display:flex; align-items:center; gap:12px; text-align:start; }
.ebd .employee .avatar{ width:42px; height:42px; border-radius:13px; font-size:14px; box-shadow:none; }
.ebd .employee strong{ display:block; font-size:14px; }
.ebd .employee span{ display:block; color:#64748b; font-size:11px; margin-top:4px; }
.ebd .rank{ width:30px; height:30px; border-radius:10px; background:#eef2f7; display:inline-grid; place-items:center; font-weight:800; color:#475569; }
.ebd .kpi-good{ color:#16a34a; font-weight:800; }
.ebd .kpi-warn{ color:#d97706; font-weight:800; }
.ebd .kpi-bad{ color:#e11d48; font-weight:800; }
.ebd .kpi-neutral{ color:#475569; font-weight:700; }
.ebd .progress-cell{ min-width:220px; }
.ebd .progress-top{ display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px; }
.ebd .progress-track{ height:8px; border-radius:999px; background:#e2e8f0; overflow:hidden; }
.ebd .progress-fill{ height:100%; border-radius:999px; background:linear-gradient(90deg,#22c55e,#4ade80); }
.ebd .progress-fill.warn{ background:linear-gradient(90deg,#f59e0b,#facc15); }
.ebd .progress-fill.bad{ background:linear-gradient(90deg,#ef4444,#fb7185); }
.ebd .trend{ display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:700; padding:7px 9px; border-radius:10px; }
.ebd .trend.up{ color:#15803d; background:rgba(34,197,94,.14); }
.ebd .trend.down{ color:#e11d48; background:rgba(239,68,68,.14); }
.ebd .trend.flat{ color:#475569; background:rgba(148,163,184,.15); }
.ebd .status{ display:inline-flex; align-items:center; gap:6px; padding:7px 10px; border-radius:999px; font-size:11px; font-weight:700; }
.ebd .status.excellent{ background:rgba(34,197,94,.14); color:#15803d; }
.ebd .status.average{ background:rgba(245,158,11,.16); color:#b45309; }
.ebd .status.poor{ background:rgba(239,68,68,.14); color:#be123c; }
.ebd .status.inactive{ background:#eef2f7; color:#64748b; }
.ebd tbody tr.ebd-unassigned td{ background:#f1f5f9; }
.ebd tbody tr.ebd-unassigned .employee strong{ color:#475569; }
.ebd .footer{ display:flex; justify-content:space-between; gap:12px; color:#64748b; font-size:11px; padding:14px 4px 0; flex-wrap:wrap; }
@media(max-width:1450px){ .ebd .stats-grid{ grid-template-columns:repeat(3,1fr); } }
@media(max-width:900px){ .ebd .stats-grid{ grid-template-columns:repeat(2,1fr); } .ebd .insight-row{ grid-template-columns:1fr; } }
@media(max-width:520px){ .ebd .stats-grid{ grid-template-columns:1fr; } }
`;
