// Post performance — visual card grid: the post's creative image with stat
// boxes underneath, "best" badges, and per-post AI analysis of WHY it worked
// (from ad copy + what its customers actually asked for — text signals; the
// model does not see the image pixels).
import { useState, useEffect } from "react";
import { useFetch, fmt0, fmt2 } from "../components/useFetch.js";
import FilterBar from "../components/FilterBar.jsx";
import IdCell from "../components/IdCell.jsx";
import { useDateRange } from "../components/DateRangeContext.jsx";
import { useI18n } from "../i18n.jsx";
import api from "../api.js";

export default function Posts() {
  const { t, lang } = useI18n();
  const dr = useDateRange();
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [adsetId, setAdsetId] = useState("");
  const [platform, setPlatform] = useState("");
  const filters = useFetch("/analytics/filters");
  const opts = useFetch("/conversations/filter-options");
  const params = new URLSearchParams(dr.qs);
  if (q) params.set("q", q);
  if (country) params.set("country", country);
  if (campaignId) params.set("campaignId", campaignId);
  if (adsetId) params.set("adsetId", adsetId);
  if (platform) params.set("platform", platform);
  params.set("lang", lang); // per-language stored AI verdicts ride on each row
  const path = `/analytics/posts?${params.toString()}`;
  const { data, loading, error, reload } = useFetch(path, [path]);
  // Ad sets cascade under the selected campaign, matching the Conversations page.
  const adsets = (opts.data?.adsets || []).filter((s) => !campaignId || s.campaign_id === campaignId);

  const [insights, setInsights] = useState(null); // { posts:[{post_url, why_it_worked, improve}], overall:[] }
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState("");

  useEffect(() => {
    api.get(`/analytics/post-insights?lang=${lang}`)
      .then((r) => setInsights(r.generated ? r : null)).catch(() => setInsights(null));
  }, [lang]);

  async function generateInsights() {
    setGenBusy(true); setGenErr("");
    try {
      setInsights(await api.post("/analytics/post-insights", { lang }));
      reload(); // verdicts are stored per post — refetch so every card shows its evaluation
    } catch (e) { setGenErr(e.message); }
    setGenBusy(false);
  }

  const VERDICT = {
    successful: { label: "ناجح", cls: "good" },
    average: { label: "متوسط", cls: "" },
    unsuccessful: { label: "يحتاج تحسين", cls: "warn" },
  };

  // "Best" badges — computed over the loaded set so they always match what's on screen.
  const rows = data || [];
  const bestQualified = rows.length ? rows.reduce((a, b) => (Number(b.qualified) > Number(a.qualified) ? b : a)) : null;
  const bestEngagement = rows.length ? rows.reduce((a, b) => (Number(b.contacts) > Number(a.contacts) ? b : a)) : null;
  const bestRate = rows.filter((r) => Number(r.contacts) >= 10).length
    ? rows.filter((r) => Number(r.contacts) >= 10).reduce((a, b) => (Number(b.qual_rate_pct) > Number(a.qual_rate_pct) ? b : a))
    : null;

  const badgesFor = (r) => [
    bestQualified?.post_url === r.post_url && Number(r.qualified) > 0 && { text: `🏆 ${t("أفضل بوست")}`, cls: "good" },
    bestEngagement?.post_url === r.post_url && { text: `🔥 ${t("أفضل تفاعل")}`, cls: "warn" },
    bestRate?.post_url === r.post_url && { text: `🎯 ${t("أفضل نسبة اهتمام")}`, cls: "good" },
    r.ad_status && {
      text: r.ad_status === "active" ? `🟢 ${t("فعال")}` : `⏸ ${t("متوقف")}`,
      cls: r.ad_status === "active" ? "good" : "",
    },
    r.verdict && VERDICT[r.verdict] && {
      text: `${t(VERDICT[r.verdict].label)}${r.ai_score != null ? ` ${r.ai_score}` : ""}`,
      cls: VERDICT[r.verdict].cls,
    },
  ].filter(Boolean);

  const MEDIA = { video: ["🎬", "فيديو"], carousel: ["🖼", "كاروسيل"], image: ["📷", "صورة"] };

  return (
    <>
      <div className="topbar">
        <h2>{t("أداء البوستات — أي منشور جلب العملاء")}</h2>
        <button className="btn orange" disabled={genBusy} onClick={generateInsights}>
          {genBusy ? t("جارٍ التوليد…") : t("🤖 لماذا نجحت هذه البوستات؟")}
        </button>
      </div>
      <FilterBar>
        <span className="fb-sep" />
        <input placeholder={t("بحث في رابط البوست/الإعلان")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">{t("كل الدول")}</option>
          {(filters.data?.countries || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setAdsetId(""); }}>
          <option value="">{t("كل الحملات")}</option>
          {(opts.data?.campaigns || []).map((c) => <option key={c.id} value={c.id}>{(c.name || c.id).slice(0, 40)}</option>)}
        </select>
        <select value={adsetId} onChange={(e) => setAdsetId(e.target.value)}>
          <option value="">{t("كل المجموعات الإعلانية")}</option>
          {adsets.map((s) => <option key={s.id} value={s.id}>{(s.name || s.id).slice(0, 40)}</option>)}
        </select>
        <div className="presets">
          {[["", "الكل"], ["instagram", "انستغرام"], ["facebook", "فيسبوك"]].map(([v, label]) => (
            <button key={v} className={`chip ${platform === v ? "active" : ""}`} onClick={() => setPlatform(v)}>{t(label)}</button>
          ))}
        </div>
      </FilterBar>

      {genErr && <p className="err">{genErr}</p>}
      {insights?.overall?.length > 0 && (
        <div className="section">
          <h3>{t("🧠 دروس المحتوى العامة (من البوستات الرابحة)")}</h3>
          <ul className="list-tight">{insights.overall.map((x, i) => <li key={i}>{x}</li>)}</ul>
          {insights.generated_at && <p className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>{t("آخر توليد")}: {new Date(insights.generated_at).toLocaleString("en-GB")}</p>}
        </div>
      )}

      {loading && <p>{t("جارٍ التحميل…")}</p>}
      {error && <p className="err">{error}</p>}

      <div className="post-grid">
        {rows.map((r) => {
          const ai = r.ai_why ? { why_it_worked: r.ai_why, improve: r.ai_improve } : null;
          return (
            <div className="post-card" key={r.post_url}>
              <a href={r.post_url} target="_blank" rel="noreferrer" className="post-img-wrap">
                {r.thumbnail_url
                  ? <img src={r.thumbnail_url} alt="" loading="lazy" />
                  : <div className="post-img-placeholder">📷<span>{t("لا صورة متاحة")}</span></div>}
                {r.media_type && MEDIA[r.media_type] && (
                  <span className="post-media-chip">{MEDIA[r.media_type][0]} {t(MEDIA[r.media_type][1])}</span>
                )}
              </a>
              <div className="post-body">
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minHeight: 22 }}>
                  {badgesFor(r).map((b, i) => <span key={i} className={`tag ${b.cls}`}>{b.text}</span>)}
                </div>
                <div className="post-ad-name" title={r.sample_ad}>
                  {r.sample_ad || "—"}
                  {r.ad_count > 1 && <span className="tag" style={{ marginInlineStart: 6 }}>{t("+{n} أخرى", { n: r.ad_count - 1 })}</span>}
                </div>
                <a href={r.post_url} target="_blank" rel="noreferrer" className="post-link" dir="ltr">
                  {(r.post_url || "").replace(/^https?:\/\/(www\.)?/, "").slice(0, 42)}
                </a>
                {(r.ad_id || r.campaign_id) && (
                  <div className="post-id-row">
                    <span>{t("رقم الحملة")}</span>
                    <IdCell id={r.campaign_id} url={r.manage_url} />
                  </div>
                )}
                {r.caption && <div className="post-caption" title={r.caption}>{r.caption}</div>}
                <div className="post-stats">
                  <div className="post-stat"><span>{t("جهات")}</span><b>{fmt0(r.contacts)}</b></div>
                  <div className="post-stat"><span>{t("مؤهّل")}</span><b style={{ color: Number(r.qualified) > 0 ? "var(--green)" : undefined }}>{fmt0(r.qualified)}</b></div>
                  <div className="post-stat"><span>{t("نسبة التأهّل")}</span><b>{fmt2(r.qual_rate_pct)}%</b></div>
                  <div className="post-stat"><span>{t("إيداعات")}</span><b>{fmt0(r.deposits)}</b></div>
                  <div className="post-stat"><span>{t("الوصول")}</span><b>{r.reach != null ? fmt0(r.reach) : "—"}</b></div>
                  <div className="post-stat"><span>{t("الظهور")}</span><b>{r.impressions != null ? fmt0(r.impressions) : "—"}</b></div>
                  <div className="post-stat"><span>{t("التكرار")}</span><b style={{ color: Number(r.frequency) > 3.5 ? "var(--red)" : undefined }}>{r.frequency != null ? fmt2(r.frequency) : "—"}</b></div>
                  <div className="post-stat"><span>CTR</span><b>{r.ctr_pct != null ? fmt2(r.ctr_pct) + "%" : "—"}</b></div>
                </div>
                {ai && (
                  <div className="post-ai">
                    <div><b>💡 {r.verdict === "unsuccessful" ? t("لماذا قصّر؟") : t("لماذا نجح؟")}</b> {ai.why_it_worked}</div>
                    {ai.improve && <div style={{ marginTop: 4 }}><b>🔧 {t("للتحسين")}:</b> {ai.improve}</div>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {data && rows.length === 0 && <p className="muted">{t("لا بوستات ضمن النطاق المحدّد.")}</p>}
    </>
  );
}
