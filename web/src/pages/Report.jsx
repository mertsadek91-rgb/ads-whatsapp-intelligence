import { useState } from "react";
import { useFetch, fmt0, fmt2 } from "../components/useFetch.js";
import DataTable from "../components/DataTable.jsx";
import { CONV_TYPE } from "./Conversations.jsx";
import { useI18n } from "../i18n.jsx";
import api from "../api.js";

const INTENT = { hot: "ساخن", warm: "دافئ", cold: "بارد" };
function Kpi({ label, val, color }) {
  return <div className="kpi"><div className="label">{label}</div><div className="val" style={color ? { color } : null}>{val}</div></div>;
}

export default function Report() {
  const { t, lang } = useI18n();
  const sum = useFetch("/report/ai-summary");
  const eng = useFetch("/report/engagement");
  const coaching = useFetch("/report/coaching");
  const insights = useFetch("/report/insights");
  const [gen, setGen] = useState(false);
  const [err, setErr] = useState("");

  async function generate() {
    setGen(true); setErr("");
    try { await api.post("/report/insights", { lang }); insights.reload(); }
    catch (e) { setErr(e.message); }
    setGen(false);
  }

  if (sum.loading) return <p>{t("جارٍ التحميل…")}</p>;
  const tot = (sum.data && sum.data.totals) || {};

  return (
    <>
      <div className="topbar"><h2>{t("التقرير الشامل — العملاء والموظفون")}</h2></div>

      {/* engagement breakdown */}
      {eng.data && (
        <div className="section">
          <h3>{t("تفكيك المحادثات (التفاعل)")}</h3>
          <div className="chips">
            {eng.data.types.map((x) => {
              const c = CONV_TYPE[x.conv_type];
              const pct = eng.data.total ? Math.round((x.n / eng.data.total) * 100) : 0;
              return <span key={x.conv_type} className={`tag ${c?.cls || ""}`}>{c ? t(c.label) : x.conv_type}: {fmt0(x.n)} ({pct}%)</span>;
            })}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>{t("إجمالي المحادثات")}: {fmt0(eng.data.total)}. {t("«بوت فقط» و«بانتظار رد» = فرص إعادة تواصل (راجع صفحة إعادة التواصل).")}</p>
        </div>
      )}

      {!tot.analyzed ? (
        <div className="note">{t("لا توجد محادثات محلّلة بعد. حلّل بعض المحادثات من صفحة «المحادثات» ثم عُد هنا للتقارير المعتمدة على الذكاء الاصطناعي.")}</div>
      ) : (
        <>
          <div className="kpis">
            <Kpi label={t("محادثات محلّلة")} val={fmt0(tot.analyzed)} />
            <Kpi label={t("متوسط جودة المحادثة")} val={fmt2(tot.avg_conv)} />
            <Kpi label={t("متوسط أداء الموظفين")} val={fmt2(tot.avg_agent)} />
            <Kpi label={t("متوسط زمن المتابعة (د)")} val={fmt2(tot.avg_follow_up)} />
            <Kpi label={t("ساخن")} val={fmt0(tot.hot)} color="var(--green)" />
            <Kpi label={t("دافئ")} val={fmt0(tot.warm)} color="var(--orange)" />
            <Kpi label={t("بارد")} val={fmt0(tot.cold)} color="var(--gray)" />
            <Kpi label={t("إقناع خاطئ")} val={fmt0(tot.wrong_persuasion)} color="var(--red)" />
          </div>

          <div className="section"><h3>{t("أداء الموظفين")}</h3>
            <DataTable rows={sum.data.employees} initialSort={{ key: "conversations", dir: "desc" }} columns={[
              { key: "agent", label: t("الموظف") },
              { key: "conversations", label: t("محادثات"), num: true, render: (r) => fmt0(r.conversations) },
              { key: "avg_agent_score", label: t("متوسط الأداء"), num: true, render: (r) => <b style={{ color: r.avg_agent_score >= 60 ? "var(--green)" : r.avg_agent_score >= 40 ? "var(--orange)" : "var(--red)" }}>{fmt2(r.avg_agent_score)}</b> },
              { key: "avg_conv_score", label: t("جودة المحادثة"), num: true, render: (r) => fmt2(r.avg_conv_score) },
              { key: "avg_follow_up_min", label: t("متابعة (د)"), num: true, render: (r) => fmt2(r.avg_follow_up_min) },
              { key: "wrong_persuasion", label: t("إقناع خاطئ"), num: true, render: (r) => r.wrong_persuasion > 0 ? <span className="bad">{r.wrong_persuasion}</span> : "0" },
            ]} /></div>
        </>
      )}

      {/* coaching */}
      {coaching.data && coaching.data.length > 0 && (
        <div className="section">
          <h3>{t("🎓 تدريب الموظفين (مجمّع)")}</h3>
          <div className="grid2">
            {coaching.data.map((a) => (
              <div key={a.agent} className="d-block" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
                <h4>{a.agent_label || a.agent} <span className="muted">· {a.conversations} {t("محادثة")} · {t("أداء")} {fmt2(a.avg_score)}{a.wrong_persuasion ? ` · ⚠ ${a.wrong_persuasion} ${t("إقناع خاطئ")}` : ""}</span></h4>
                {a.top_improvements.length > 0 && <><div className="muted">{t("أبرز نصائح التحسين")}</div><ul className="list-tight">{a.top_improvements.map((x, i) => <li key={i}>{x.text} {x.count > 1 ? `(×${x.count})` : ""}</li>)}</ul></>}
                {a.top_mistakes.length > 0 && <><div className="muted" style={{ marginTop: 6, color: "var(--red)" }}>{t("أمثلة إقناع خاطئ")}</div><ul className="list-tight" style={{ color: "var(--red)" }}>{a.top_mistakes.map((x, i) => <li key={i}>{x.text}</li>)}</ul></>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI themes */}
      <div className="section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{t("🧠 رؤى الذكاء الاصطناعي (اعتراضات وأسباب الخسارة)")}</h3>
          <button className="btn orange" disabled={gen} onClick={generate}>{gen ? t("جارٍ التوليد…") : t("توليد / تحديث الرؤى")}</button>
        </div>
        {err && <p className="err">{err}</p>}
        {!insights.data?.generated ? <p className="muted">{t("لم تُولَّد بعد. اضغط «توليد الرؤى» (يلخّص المحادثات المحلّلة عبر DeepSeek).")}</p> : (
          <div className="grid2">
            <InsightList title={t("أهم الاعتراضات")} items={insights.data.top_objections} render={(o) => <><b>{o.objection}</b> {o.approx_count ? `(~${o.approx_count})` : ""}<div className="muted">{t("رد مقترح")}: {o.suggested_response}</div></>} />
            <InsightList title={t("أسباب عدم التحويل")} items={insights.data.lost_reasons} />
            <InsightList title={t("أخطاء الموظفين الشائعة")} items={insights.data.agent_common_mistakes} />
            <InsightList title={t("أفضل الممارسات")} items={insights.data.best_practices} />
            <InsightList title={t("أفكار لرسائل الإعلانات")} items={insights.data.ad_messaging_ideas} />
            <InsightList title={t("توصيات إدارية")} items={insights.data.management_recommendations} />
          </div>
        )}
        {insights.data?.generated_at && <p className="muted" style={{ marginTop: 8 }}>{t("آخر توليد")}: {new Date(insights.data.generated_at).toLocaleString("en-GB")}</p>}
      </div>
    </>
  );
}

function InsightList({ title, items, render }) {
  if (!items || !items.length) return null;
  return (
    <div className="d-block">
      <h4>{title}</h4>
      <ul className="list-tight">{items.map((x, i) => <li key={i}>{render ? render(x) : x}</li>)}</ul>
    </div>
  );
}
