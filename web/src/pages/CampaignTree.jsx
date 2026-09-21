// Interactive Campaign -> Ad Set -> Ad tree: expand a campaign to see its ad
// sets, expand an ad set to see its ads, each row showing date-filtered spend/
// results and its Wati outcome (contacts + qualified). Answers "which layer,
// which ad, is actually producing".
import { useState } from "react";
import { useFetch, fmt0, fmt2 } from "../components/useFetch.js";
import IdCell from "../components/IdCell.jsx";
import { useDateRange } from "../components/DateRangeContext.jsx";
import { useI18n } from "../i18n.jsx";
import { useCurrency } from "../currency.jsx";

const statusBadge = (s) => {
  if (!s) return null;
  const cls = s === "WITH_ISSUES" ? "b-issue" : s === "ACTIVE" ? "b-active" : "b-paused";
  return <span className={`badge ${cls}`} style={{ marginInlineStart: 6 }}>{s}</span>;
};

export default function CampaignTree() {
  const { t } = useI18n();
  const { money } = useCurrency();
  const dr = useDateRange();
  const path = `/analytics/campaign-tree?${dr.qs}`;
  const { data, loading, error } = useFetch(path, [path]);
  const [open, setOpen] = useState({}); // id -> bool
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const tree = data || [];

  const Metrics = ({ m }) => (
    <span className="tree-metrics">
      <span title={t("الإنفاق")}>💰 {money(m.spend_aed)}</span>
      <span title={t("النتائج")}>🎯 {fmt0(m.results)}</span>
      <span title={t("جهات Wati")}>👥 {fmt0(m.contacts)}</span>
      <span title={t("مؤهّل")} style={{ color: Number(m.qualified) > 0 ? "var(--green)" : undefined }}>⭐ {fmt0(m.qualified)}</span>
      <span title={t("نسبة التأهّل")}>{m.contacts ? fmt2((100 * m.qualified) / m.contacts) + "%" : "—"}</span>
    </span>
  );

  return (
    <>
      <div className="topbar"><h2>{t("شجرة الحملات — الحملة ثم المجموعة ثم الإعلان")}</h2></div>
      <p className="muted" style={{ marginBottom: 12 }}>{t("اضغط للتوسيع: الإنفاق والنتائج حسب الفترة، وجهات Wati والمؤهّلون لكل مستوى.")}</p>
      {loading && <p>{t("جارٍ التحميل…")}</p>}
      {error && <p className="err">{error}</p>}

      <div className="tree">
        {tree.map((c) => (
          <div className="tree-camp" key={c.campaign_id}>
            <div className="tree-row lvl-camp" onClick={() => toggle(c.campaign_id)}>
              <span className="tree-caret">{open[c.campaign_id] ? "▾" : "▸"}</span>
              <b className="tree-name">{c.name || c.campaign_id}</b>
              <span onClick={(e) => e.stopPropagation()}><IdCell id={c.campaign_id} url={c.manage_url} /></span>
              <Metrics m={c.metrics} />
            </div>
            {open[c.campaign_id] && c.adsets.map((s) => (
              <div key={s.adset_id}>
                <div className="tree-row lvl-adset" onClick={() => toggle(s.adset_id)}>
                  <span className="tree-caret">{open[s.adset_id] ? "▾" : "▸"}</span>
                  <span className="tree-name">{s.name || s.adset_id}</span>
                  <span onClick={(e) => e.stopPropagation()}><IdCell id={s.adset_id} /></span>
                  <Metrics m={s.metrics} />
                </div>
                {open[s.adset_id] && s.ads.map((a) => (
                  <div className="tree-row lvl-ad" key={a.ad_id}>
                    <span className="tree-name">{a.name || a.ad_id}{statusBadge(a.status)}</span>
                    <span><IdCell id={a.ad_id} url={a.manage_url} /></span>
                    <Metrics m={a.metrics} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      {data && tree.length === 0 && <p className="muted">{t("لا حملات ضمن النطاق المحدّد.")}</p>}
    </>
  );
}
