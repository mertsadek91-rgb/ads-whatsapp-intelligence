import { useEffect, useState } from "react";
import api from "../api.js";
import { countryLabel } from "../components/country.js";
import { useI18n } from "../i18n.jsx";
import { useCurrency } from "../currency.jsx";

const INTENT = { hot: "ساخن", warm: "دافئ", cold: "بارد" };
const acctLabel = { unknown: "غير معروف", demo: "تجريبي", real: "حقيقي" };
export const CONV_TYPE = {
  bot_only: { label: "بوت فقط", cls: "" },
  awaiting_human: { label: "بانتظار رد", cls: "warn" },
  human_handled: { label: "معالَجة", cls: "good" },
  no_customer: { label: "بلا عميل", cls: "" },
  // /report/engagement counts contacts whose conversation was never synced
  not_synced: { label: "لم تُزامن", cls: "" },
};
const ATTR_AR = {
  lead_stage: "المرحلة (Wati)", contact_owner: "المسؤول", name: "الاسم", source_id: "معرّف الإعلان",
  source_url: "رابط البوست", phone: "الهاتف", cx_score: "CX Score", cx_score_latest: "CX Score (آخر)",
  acc: "رقم الحساب (acc)",
};
const time = (t) => (t ? new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
function convDate(c) {
  const v = c.last_message_at || c.created_at || c.created_date;
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const EMPTY_FILTERS = { q: "", owner: "", since: "", until: "", convType: "", leadStage: "", postUrl: "",
  campaignId: "", adsetId: "", adId: "", tag: "", scoreMin: "", scoreMax: "" };

export default function Conversations() {
  const { t } = useI18n();
  const [f, setF] = useState(EMPTY_FILTERS);
  const [owners, setOwners] = useState([]);
  const [opts, setOpts] = useState({ stages: [], campaigns: [], adsets: [], ads: [], posts: [], postsTotal: 0, tags: [] });
  const [list, setList] = useState([]);
  const [listTotal, setListTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const PAGE = 300;
  const [postQ, setPostQ] = useState("");
  const [postResults, setPostResults] = useState(null);
  const [sel, setSel] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [jobs, setJobs] = useState({ sync: null, analyze: null });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const qs = (extra = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    return p.toString();
  };
  function reloadList(off = offset) {
    api.get(`/conversations?${qs({ offset: off })}`)
      .then((d) => { setList(d.rows || []); setListTotal(d.total ?? (d.rows || []).length); })
      .catch((e) => setErr(e.message));
  }
  // BUG-032 fix (stage 2): server-side search across ALL posts (the dropdown
  // itself is capped at 400) — debounced as-you-type.
  useEffect(() => {
    if (!postQ.trim()) { setPostResults(null); return; }
    const timer = setTimeout(() => {
      api.get(`/conversations/post-search?q=${encodeURIComponent(postQ.trim())}`)
        .then(setPostResults).catch(() => setPostResults([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [postQ]);
  useEffect(() => {
    api.get("/analytics/filters").then((d) => setOwners(d.owners || [])).catch(() => {});
    api.get("/conversations/filter-options").then(setOpts).catch(() => {});
    // BUG-042 fix: the stop button used to only appear if this browser tab
    // itself started the job — a refresh or a second tab saw no running job
    // at all and had no way to stop it. Check status on mount and resume
    // polling if a job is already running server-side.
    api.get("/conversations/jobs-status").then((s) => {
      setJobs(s);
      if (s?.sync?.state === "running" || s?.analyze?.state === "running") pollJobs();
    }).catch(() => {});
  }, []);
  // Changing any filter resets to the first page (offset 0).
  useEffect(() => { setOffset(0); reloadList(0); }, [JSON.stringify(f)]);
  useEffect(() => { reloadList(offset); }, [offset]);

  function pollJobs() {
    const timer = setInterval(async () => {
      const s = await api.get("/conversations/jobs-status").catch(() => null);
      if (s) setJobs(s);
      if (s && s.sync?.state !== "running" && s.analyze?.state !== "running") { clearInterval(timer); reloadList(); }
    }, 2500);
  }
  async function runSync() {
    setErr("");
    try { await api.post("/conversations/sync-batch", { ...f }); setJobs((j) => ({ ...j, sync: { state: "running" } })); pollJobs(); }
    catch (e) { setErr(e.message); }
  }
  async function runBatch() {
    setErr("");
    try { await api.post("/conversations/analyze-batch", { ...f, onlyUnanalyzed: true, skipBot: true }); setJobs((j) => ({ ...j, analyze: { state: "running" } })); pollJobs(); }
    catch (e) { setErr(e.message); }
  }
  async function stopJobs() {
    try { await api.post("/conversations/stop-jobs"); } catch { /* ignore */ }
  }

  // cascading hierarchy: choosing a campaign narrows ad sets; choosing an ad set narrows ads
  const adsetOptions = f.campaignId ? opts.adsets.filter((s) => s.campaign_id === f.campaignId) : opts.adsets;
  const adOptions = (f.adsetId ? opts.ads.filter((a) => a.adset_id === f.adsetId)
    : f.campaignId ? opts.ads.filter((a) => a.campaign_id === f.campaignId) : opts.ads);
  const setCampaign = (e) => setF({ ...f, campaignId: e.target.value, adsetId: "", adId: "" });
  const setAdset = (e) => setF({ ...f, adsetId: e.target.value, adId: "" });

  useEffect(() => {
    if (!sel) return;
    setLoadingDetail(true); setDetail(null);
    api.get(`/conversations/${encodeURIComponent(sel)}`)
      .then(setDetail).catch((e) => setErr(e.message)).finally(() => setLoadingDetail(false));
  }, [sel]);

  async function analyze() {
    setAnalyzing(true); setErr("");
    try {
      const a = await api.post(`/conversations/${encodeURIComponent(sel)}/analyze`);
      setDetail((d) => ({ ...d, analysis: a, stale: false }));
      setList((l) => l.map((x) => (x.wa_id === sel ? { ...x, conv_score: a.conv_score, agent_score: a.agent_score } : x)));
    } catch (e) { setErr(e.message); }
    setAnalyzing(false);
  }

  return (
    <>
      <div className="topbar"><h2>{t("المحادثات + تحليل الذكاء الاصطناعي")}</h2></div>
      <div className="filters">
        <input placeholder={t("بحث بالاسم/الهاتف")} value={f.q} onChange={set("q")} />
        <select value={f.owner} onChange={set("owner")}>
          <option value="">{t("كل الموظفين")}</option>
          {owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={f.convType} onChange={set("convType")}>
          <option value="">{t("كل التصنيفات")}</option>
          {Object.entries(CONV_TYPE).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}
        </select>
        <select value={f.scoreMin && f.scoreMax ? `${f.scoreMin}-${f.scoreMax}` : ""}
          onChange={(e) => { const [a, b] = e.target.value.split("-"); setF({ ...f, scoreMin: a || "", scoreMax: b || "" }); }}>
          <option value="">{t("التقييم (AI)")}</option>
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((n) => <option key={n} value={`${n}-${n + 10}`}>{n} - {n + 10}</option>)}
        </select>
        <select value={f.leadStage} onChange={set("leadStage")}>
          <option value="">{t("كل المراحل")}</option>
          {opts.stages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={f.campaignId} onChange={setCampaign} title={t("الحملة")}>
          <option value="">{t("كل الحملات")}</option>
          {opts.campaigns.map((c) => <option key={c.id} value={c.id}>{(c.name || c.id).slice(0, 40)}</option>)}
        </select>
        <select value={f.adsetId} onChange={setAdset} title={t("المجموعة الإعلانية")}>
          <option value="">{t("كل المجموعات الإعلانية")}</option>
          {adsetOptions.map((s) => <option key={s.id} value={s.id}>{(s.name || s.id).slice(0, 40)}</option>)}
        </select>
        <select value={f.adId} onChange={set("adId")} title={t("الإعلان")}>
          <option value="">{t("كل الإعلانات")}</option>
          {adOptions.map((a) => <option key={a.id} value={a.id}>{(a.name || a.id).slice(0, 40)}</option>)}
        </select>
        <select value={f.postUrl} onChange={set("postUrl")}
          title={opts.postsTotal > opts.posts.length
            ? t("رابط البوست (أول {n} من إجمالي {m} — استخدم البحث لإيجاد بوست غير مُدرَج)", { n: opts.posts.length, m: opts.postsTotal })
            : t("رابط البوست")}>
          <option value="">
            {opts.postsTotal > opts.posts.length
              ? t("كل البوستات (أول {n} من {m})", { n: opts.posts.length, m: opts.postsTotal })
              : t("كل البوستات")}
          </option>
          {opts.posts.map((u) => <option key={u} value={u}>{u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 36)}</option>)}
        </select>
        <input placeholder={t("بحث في كل البوستات…")} value={postQ} onChange={(e) => setPostQ(e.target.value)} style={{ width: 150 }} />
        {postResults && (
          <select value="" onChange={(e) => { if (e.target.value) { setF({ ...f, postUrl: e.target.value }); setPostQ(""); } }}>
            <option value="">{t("{n} صف", { n: postResults.length })}</option>
            {postResults.map((u) => <option key={u} value={u}>{u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 36)}</option>)}
          </select>
        )}
        {opts.tags.length > 0 && (
          <select value={f.tag} onChange={set("tag")}>
            <option value="">{t("كل الوسوم")}</option>
            {opts.tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        )}
        <label className="muted">{t("من")}</label><input type="date" value={f.since} onChange={set("since")} />
        <label className="muted">{t("إلى")}</label><input type="date" value={f.until} onChange={set("until")} />
        <button className="btn ghost" disabled={jobs.sync?.state === "running"} onClick={runSync}>
          {jobs.sync?.state === "running" ? t("مزامنة {a}/{b}…", { a: jobs.sync.done || 0, b: jobs.sync.total || 0 }) : t("↻ مزامنة التصنيف")}
        </button>
        <button className="btn orange" disabled={jobs.analyze?.state === "running"} onClick={runBatch}>
          {jobs.analyze?.state === "running" ? t("تحليل {a}/{b}…", { a: jobs.analyze.done || 0, b: jobs.analyze.total || 0 }) : t("🤖 تحليل حسب الفلاتر")}
        </button>
        <button className="btn ghost" onClick={() => setF(EMPTY_FILTERS)}>{t("مسح")}</button>
        {(jobs.sync?.state === "running" || jobs.analyze?.state === "running") && (
          <button className="btn ghost" onClick={stopJobs}>{t("⏹ إيقاف")}</button>
        )}
        {listTotal > PAGE ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button className="btn ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("السابق")}</button>
            <span className="muted">{t("{a}–{b} من {m} محادثة", { a: offset + 1, b: Math.min(offset + list.length, listTotal), m: listTotal })}</span>
            <button className="btn ghost" disabled={offset + PAGE >= listTotal} onClick={() => setOffset(offset + PAGE)}>{t("التالي")}</button>
          </span>
        ) : (
          <span className="muted">{t("{n} محادثة", { n: list.length })}</span>
        )}
        {jobs.analyze && jobs.analyze.state === "done" && (
          <span className="good">{t("اكتمل: {n} محلّلة", { n: jobs.analyze.done })}{jobs.analyze.skipped ? t("، تُخطّي {n} بوت", { n: jobs.analyze.skipped }) : ""}{jobs.analyze.failed ? t("، {n} فشل", { n: jobs.analyze.failed }) : ""}</span>
        )}
        {jobs.analyze && jobs.analyze.state === "stopped" && (
          <span className="muted">{t("أُوقف التحليل ({n} محلّلة قبل الإيقاف)", { n: jobs.analyze.done })}</span>
        )}
      </div>
      {err && <p className="err">{err}</p>}
      <div className="chat-wrap">
        {/* list */}
        <div className="pane">
          <div className="pane-head">{t("المحادثات")}</div>
          <div className="conv-list">
            {list.map((c) => (
              <div key={c.wa_id} className={`conv-item ${sel === c.wa_id ? "active" : ""}`} onClick={() => setSel(c.wa_id)}>
                <div className="meta">
                  <span className="nm">{c.full_name || c.phone}</span>
                  <span className="tl-time">{convDate(c)}</span>
                </div>
                <div className="meta">
                  <span dir="ltr">{c.phone}</span>
                  <span>{t("{n} رسالة", { n: c.num_messages || 0 })}</span>
                </div>
                <div className="meta">
                  <span>{c.contact_owner || "—"}</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    {c.conv_type && CONV_TYPE[c.conv_type] && <span className={`tag ${CONV_TYPE[c.conv_type].cls}`}>{t(CONV_TYPE[c.conv_type].label)}</span>}
                    {c.stale ? <span className="tag warn">{t("متقادم")}</span>
                      : c.conv_score != null ? <span className={`tag ${c.wrong_persuasion ? "warn" : "good"}`}>{c.conv_score}</span>
                      : <span className="tag">—</span>}
                  </span>
                </div>
              </div>
            ))}
            {list.length === 0 && <p className="muted" style={{ padding: 14 }}>{t("لا محادثات")}</p>}
          </div>
        </div>

        {/* thread */}
        <div className="pane">
          <div className="pane-head">{detail?.contact ? (detail.contact.full_name || detail.contact.phone) : t("اختر محادثة")}</div>
          {loadingDetail && <p style={{ padding: 14 }}>{t("جارٍ التحميل…")}</p>}
          {detail && (
            <div className="thread">
              {detail.partial && <div className="note bad">{t("تعذّر جلب المحادثة من Wati — البيانات المعروضة قد تكون ناقصة.")}</div>}
              {detail.contact?.msg_unavailable === 1 && (
                <div className="note bad">{t("هذه المحادثة على رقم واتساب ثانٍ غير مرتبط بالـ API — تُسحب البيانات الأساسية فقط دون محتوى الرسائل. أضِف توكن الرقم الثاني لعرض المحادثة.")}</div>
              )}
              {detail.messages.length === 0 && !detail.partial && detail.contact?.msg_unavailable !== 1 && <p className="muted">{t("لا رسائل")}</p>}
              {detail.messages.map((m, i) => (
                <div key={i} className={`bubble ${m.dir}`}>
                  <div className="who">{m.dir === "out" ? `${t("الموظف")} · ${m.sender}` : t("العميل")}</div>
                  {m.body}
                  <div className="tm">{time(m.ts)}</div>
                </div>
              ))}
            </div>
          )}
          {!detail && !loadingDetail && <div className="thread" style={{ alignItems: "center", justifyContent: "center" }}><span className="muted">{t("اختر محادثة من القائمة")}</span></div>}
        </div>

        {/* details + evaluation */}
        <div className="pane">
          <div className="pane-head">{t("التفاصيل والتقييم")}</div>
          <div className="details">
            {!detail && <p className="muted">—</p>}
            {detail && <Details detail={detail} analyzing={analyzing} onAnalyze={analyze} />}
          </div>
        </div>
      </div>
    </>
  );
}

function Details({ detail, analyzing, onAnalyze }) {
  const { t, lang } = useI18n();
  const { money } = useCurrency();
  const c = detail.contact;
  const a = detail.analysis;
  const cust = a && (typeof a.customer_details === "string" ? safe(a.customer_details) : a.customer_details) || {};
  const ev = a && (typeof a.agent_eval === "string" ? safe(a.agent_eval) : a.agent_eval) || {};
  const flags = a && (typeof a.flags === "string" ? safe(a.flags) : a.flags) || [];

  return (
    <>
      <div className="d-block">
        <h4>{t("العميل")}</h4>
        <div className="d-row"><span>{t("الهاتف")}</span><b dir="ltr">{c.phone}</b></div>
        <div className="d-row"><span>{t("المرحلة")}</span><b>{c.stage}</b></div>
        <div className="d-row"><span>{t("Score (قواعد)")}</span><b>{c.lead_score} ({c.score_band})</b></div>
        <div className="d-row"><span>{t("الدولة")}</span><b>{countryLabel(c.phone, c.country, lang)}</b></div>
        <div className="d-row"><span>{t("الحملة")}</span><b style={{ maxWidth: 180, textAlign: "end" }}>{c.campaign_name || "—"}</b></div>
        <div className="d-row"><span>{t("المجموعة الإعلانية")}</span><b style={{ maxWidth: 180, textAlign: "end" }}>{c.adset_name || "—"}</b></div>
        <div className="d-row"><span>{t("الإعلان")}</span><b style={{ maxWidth: 180, textAlign: "end" }}>{c.ad_name || c.source_ad_id || "—"}</b></div>
        <div className="d-row"><span>{t("المسؤول")}</span><b>{c.contact_owner || "—"}</b></div>
        <div className="d-row"><span>{t("نوع الحساب")}</span><b>{acctLabel[c.account_type] ? t(acctLabel[c.account_type]) : t("غير معروف")}</b></div>
        <div className="d-row"><span>{t("الإيداع")}</span><b>{money(c.deposit_total_aed || 0)}</b></div>
        {c.cx_score != null && c.cx_score !== "" && <div className="d-row"><span>CX Score (Wati)</span><b>{c.cx_score}</b></div>}
      </div>

      {detail.attributes && Object.keys(detail.attributes).length > 0 && (
        <div className="d-block">
          <h4>{t("كل السمات (Wati)")}</h4>
          {Object.entries(detail.attributes).map(([k, v]) => (
            <div className="d-row" key={k}><span>{ATTR_AR[k] ? t(ATTR_AR[k]) : k}</span><b style={{ maxWidth: 200, textAlign: "end", wordBreak: "break-word" }}>{String(v ?? "—")}</b></div>
          ))}
        </div>
      )}

      {detail.tags && detail.tags.length > 0 && (
        <div className="d-block"><h4>{t("الوسوم")}</h4><div className="chips">{detail.tags.map((tag, i) => <span key={i} className="tag">{typeof tag === "object" ? tag.name : tag}</span>)}</div></div>
      )}

      {detail.events && detail.events.length > 0 && (
        <div className="d-block">
          <h4>{t("سجل النشاط")}</h4>
          <div className="timeline">
            {detail.events.slice(-12).map((e, i) => (
              <div className="tl-item" key={i}><span className="tl-time">{time(e.ts)}</span><span>{e.text}</span></div>
            ))}
          </div>
        </div>
      )}

      {!a && (
        <button className="btn orange" disabled={analyzing} onClick={onAnalyze} style={{ width: "100%" }}>
          {analyzing ? t("جارٍ التحليل…") : t("🤖 حلّل المحادثة")}
        </button>
      )}

      {a && detail.stale && (
        <div className="note bad" style={{ marginBottom: 12 }}>{t("المحادثة وصلتها رسائل جديدة بعد التحليل — أعد التحليل لتحديث النتيجة.")}</div>
      )}
      {a && (
        <>
          <div className="d-block" style={{ textAlign: "center" }}>
            <h4>{t("تقييم المحادثة")}</h4>
            <div className="scorebig" style={{ color: a.conv_score >= 60 ? "var(--green)" : a.conv_score >= 40 ? "var(--orange)" : "var(--red)" }}>{a.conv_score}</div>
            <div className="tag good" style={{ marginTop: 4 }}>{t("النيّة")}: {INTENT[a.lead_intent] ? t(INTENT[a.lead_intent]) : a.lead_intent}</div>
            <div className="muted" style={{ marginTop: 6 }}>{a.lead_status}</div>
          </div>

          <div className="d-block">
            <h4>{t("ملخّص المحادثة")}</h4>
            <div style={{ fontSize: 12.5 }}>{a.summary}</div>
          </div>

          <div className="d-block">
            <h4>{t("تفاصيل العميل (AI)")}</h4>
            <div className="d-row"><span>{t("يريد")}</span><b style={{ maxWidth: 200, textAlign: "end" }}>{cust.needs || "—"}</b></div>
            <div className="d-row"><span>{t("اعتراضات")}</span><b style={{ maxWidth: 200, textAlign: "end" }}>{cust.objections || "—"}</b></div>
            <div className="d-row"><span>{t("نيّة الإيداع")}</span><b>{cust.deposit_intent || "—"}</b></div>
            <div className="d-row"><span>{t("نوع الحساب المذكور")}</span><b>{cust.account_type || "—"}</b></div>
          </div>

          <div className="d-block">
            <h4>{t("تقييم الموظف")} — {a.agent_name || "؟"}</h4>
            <div className="d-row"><span>{t("درجة الأداء")}</span><b style={{ color: a.agent_score >= 60 ? "var(--green)" : a.agent_score >= 40 ? "var(--orange)" : "var(--red)" }}>{a.agent_score}/100</b></div>
            <div className="d-row"><span>{t("زمن المتابعة (وسيط)")}</span><b>{a.follow_up_min != null ? t("{n} دقيقة", { n: a.follow_up_min }) : "—"}</b></div>
            <div className="d-row"><span>{t("أسلوب التواصل")}</span><b style={{ maxWidth: 200, textAlign: "end" }}>{ev.communication_style || "—"}</b></div>
            <div className="d-row"><span>{t("سرعة الرد")}</span><b style={{ maxWidth: 200, textAlign: "end" }}>{ev.response_speed || "—"}</b></div>
            <div className="d-row"><span>{t("جودة المتابعة")}</span><b style={{ maxWidth: 200, textAlign: "end" }}>{ev.follow_up_quality || "—"}</b></div>
            <div className="d-row"><span>{t("الالتزام بالسياسات")}</span><b style={{ maxWidth: 200, textAlign: "end" }}>{ev.policy_compliance || "—"}</b></div>
            <div className="d-row"><span>{t("إقناع خاطئ؟")}</span>{a.wrong_persuasion ? <span className="tag warn">{t("نعم ⚠")}</span> : <span className="tag good">{t("لا")}</span>}</div>
            {Array.isArray(ev.wrong_persuasion_examples) && ev.wrong_persuasion_examples.length > 0 && (
              <ul className="list-tight" style={{ color: "var(--red)" }}>{ev.wrong_persuasion_examples.map((x, i) => <li key={i}>{x}</li>)}</ul>
            )}
            {Array.isArray(ev.strengths) && ev.strengths.length > 0 && (<><div className="muted" style={{ marginTop: 8 }}>{t("نقاط القوة")}</div><ul className="list-tight">{ev.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></>)}
            {Array.isArray(ev.improvements) && ev.improvements.length > 0 && (<><div className="muted" style={{ marginTop: 8 }}>{t("نصائح التحسين")}</div><ul className="list-tight">{ev.improvements.map((x, i) => <li key={i}>{x}</li>)}</ul></>)}
          </div>

          {flags.length > 0 && (
            <div className="d-block"><h4>{t("ملاحظات")}</h4><div className="chips">{flags.map((fl, i) => <span key={i} className="tag warn">{fl}</span>)}</div></div>
          )}

          <button className="btn ghost" disabled={analyzing} onClick={onAnalyze} style={{ width: "100%" }}>
            {analyzing ? "…" : t("إعادة التحليل")}
          </button>
        </>
      )}
    </>
  );
}

function safe(s) { try { return JSON.parse(s); } catch { return {}; } }
