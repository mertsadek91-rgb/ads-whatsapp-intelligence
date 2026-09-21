// WhatsApp broadcast campaigns — our own version of Wati's "Create New
// Campaign" wizard: name -> channel -> template -> audience filters -> send.
//
// This is the first page in the app that messages CUSTOMERS directly (every
// other write feature — Assignment — only moves internal ownership), so it
// carries two safety layers beyond the usual preview/confirm/execute:
//  - a master switch, OFF by default, that must be turned on separately from
//    any individual send (same pattern as EmployeesAdmin's report-email switch);
//  - typing the exact campaign name to arm the Send button, one more
//    deliberate step than Assignment's plain confirm click.
//
// V1 is Single Send only — no Drip, no auto-retry, no SMS fallback. Those are
// real Wati wizard features we chose not to build yet, not a silent gap.
import { useEffect, useState, useCallback } from "react";
import api from "../api.js";
import { useI18n } from "../i18n.jsx";

const STEP_KEYS = ["name", "channel", "template", "audience", "review"];
const CHANNEL_LABELS = {
  "971521057315": "Default",
  "971561178629": "IST Markets English",
};
const fmtDate = (d) => (d ? new Date(d).toLocaleString("en-GB") : "—");
const STATUS_CLS = { done: "b-active", running: "b-warm", error: "b-issue", draft: "b-unknown" };

export default function Broadcasts() {
  const { t, lang } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [facets, setFacets] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const [name, setName] = useState("");
  const [channel, setChannel] = useState("");
  const [channelTemplates, setChannelTemplates] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const emptyFilter = () => ({
    owner: "", country: "", stage: "", leadStage: "", campaign: "",
    since: "", until: "", activeSince: "", activeUntil: "", q: "",
    state: "", source: "", scoreBand: "", deposit: "",
    minMessages: "", maxMessages: "", excludeUnlinked: false,
    tags: [], tagMatch: "any",
  });
  const [filter, setFilter] = useState(emptyFilter());
  const [tagSearch, setTagSearch] = useState("");

  const [audience, setAudience] = useState(null);
  const [campaignPreview, setCampaignPreview] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState(null);

  const [history, setHistory] = useState(null);
  const [runDetail, setRunDetail] = useState(null);

  useEffect(() => {
    api.get("/broadcasts/enabled").then((r) => setEnabled(!!r.enabled)).catch(() => {});
    api.get("/broadcasts/facets").then(setFacets).catch((e) => setErr(e.message));
    api.get("/tags/catalog").then(setCatalog).catch(() => {});
  }, []);

  useEffect(() => {
    if (!channel) { setChannelTemplates([]); return; }
    api.get(`/broadcasts/templates?channel=${encodeURIComponent(channel)}`)
      .then((r) => setChannelTemplates(r.templates || [])).catch((e) => setErr(e.message));
  }, [channel]);

  const tpl = channelTemplates.find((x) => x.name === templateName) || null;

  const fullFilter = useCallback(() => ({ ...filter, channel }), [filter, channel]);
  useEffect(() => {
    if (step < 3) return;
    api.post("/broadcasts/audience/preview", { filter: fullFilter() }).then(setAudience).catch(() => setAudience(null));
  }, [filter, channel, step, fullFilter]);

  async function toggleMaster(on) {
    try { setEnabled((await api.post("/broadcasts/enabled", { enabled: on })).enabled); }
    catch (e) { setErr(e.message); }
  }

  function patchFilter(p) { setFilter((prev) => ({ ...prev, ...p })); }
  function toggleTag(tag) {
    setFilter((prev) => (prev.tags.includes(tag)
      ? { ...prev, tags: prev.tags.filter((x) => x !== tag) }
      : { ...prev, tags: [...prev.tags, tag] }));
  }

  async function goReview() {
    setBusy("preview"); setErr("");
    try {
      const r = await api.post("/broadcasts/preview", { name, templateName, channel, filter: fullFilter() });
      setCampaignPreview(r); setConfirmText(""); setResult(null); setStep(4);
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  }

  async function doExecute() {
    setBusy("execute"); setErr("");
    try {
      const r = await api.post("/broadcasts/execute", {
        name, templateName, channel, filter: fullFilter(),
        confirm: true, expected: campaignPreview.audience.eligible,
      });
      setResult(r);
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  }

  function loadHistory() {
    api.get("/broadcasts/runs").then((r) => setHistory(r.runs || [])).catch((e) => setErr(e.message));
  }
  function openRun(id) {
    api.get(`/broadcasts/runs/${id}`).then(setRunDetail).catch((e) => setErr(e.message));
  }

  function resetWizard() {
    setStep(0); setName(""); setChannel(""); setTemplateName("");
    setFilter(emptyFilter());
    setCampaignPreview(null); setResult(null); setConfirmText("");
  }

  const cName = (c) => (lang === "en" ? c.en : c.ar);
  const canNext = [
    name.trim().length > 0,
    !!channel,
    !!templateName,
    true,
  ];
  const shownTags = catalog?.categories
    ? catalog.categories.flatMap((c) => c.tags).filter((x) => !tagSearch.trim()
      || x.tag.toLowerCase().includes(tagSearch.trim().toLowerCase())
      || x.en.toLowerCase().includes(tagSearch.trim().toLowerCase()) || x.ar.includes(tagSearch.trim()))
    : [];
  const tagLabel = (tag) => {
    for (const c of catalog?.categories || []) {
      const f = c.tags.find((x) => x.tag === tag);
      if (f) return lang === "en" ? f.en : f.ar;
    }
    return tag;
  };

  return (
    <>
      <div className="topbar">
        <h2>{t("حملات واتساب الجماعية")}</h2>
        <button className="btn ghost sm" onClick={() => { setHistory(history ? null : []); if (!history) loadHistory(); }}>
          {history ? t("إخفاء السجل") : t("سجل الحملات")}
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t("نسختنا الخاصة من معالج الحملات في Wati: اسم، قناة، قالب مُعتمد، جمهور مُفلتَر، ثم إرسال. النطاق الحالي إرسال واحد فقط — بدون Drip أو إعادة محاولة تلقائية أو بديل SMS.")}
      </p>

      <div className="section" style={{ marginBottom: 14, borderColor: enabled ? "var(--success)" : "var(--border)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={enabled} onChange={(e) => toggleMaster(e.target.checked)} />
            {t("تفعيل الإرسال الفعلي للحملات")}
          </label>
          <span className="muted" style={{ fontSize: 12 }}>
            {enabled ? t("مُفعَّل — أي حملة تُنفَّذ سترسل رسائل حقيقية لعملاء حقيقيين.") : t("مُعطَّل — يمكن بناء ومعاينة الحملات، لكن التنفيذ سيُرفض حتى تُفعِّل الإرسال.")}
          </span>
        </div>
      </div>

      {err && <p className="err">{err}</p>}

      {history && (
        <div className="section" style={{ marginBottom: 14 }}>
          <h3>{t("سجل الحملات")}</h3>
          <div className="scroll" style={{ maxHeight: 260 }}>
            <table>
              <thead><tr>
                <th>{t("الاسم")}</th><th>{t("القالب")}</th><th>{t("الحالة")}</th>
                <th>{t("أُرسِلت")}</th><th>{t("فشلت")}</th><th>{t("بواسطة")}</th><th>{t("التاريخ")}</th>
              </tr></thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => openRun(r.id)}>
                    <td className="nm">{r.name}</td><td className="muted">{r.template_name}</td>
                    <td><span className={`badge ${STATUS_CLS[r.status] || "b-unknown"}`}>{r.status}</span></td>
                    <td className="good">{r.sent}</td><td className={r.failed ? "bad" : ""}>{r.failed}</td>
                    <td className="muted">{r.created_by}</td><td><span dir="ltr">{fmtDate(r.created_at)}</span></td>
                  </tr>
                ))}
                {history.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 16 }}>{t("لا حملات سابقة.")}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {runDetail && (
        <div className="modal-bg" onClick={() => setRunDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{runDetail.run.name}</h3>
            <div className="kpis" style={{ marginBottom: 12 }}>
              <div className="kpi"><div className="label">{t("الإجمالي")}</div><div className="val">{runDetail.run.total}</div></div>
              <div className="kpi"><div className="label">{t("قُدِّمت")}</div><div className="val good">{runDetail.run.sent}</div></div>
              <div className="kpi"><div className="label">{t("فشلت")}</div><div className="val bad">{runDetail.run.failed}</div></div>
            </div>
            <div className="scroll" style={{ maxHeight: 300 }}>
              <table>
                <thead><tr><th>{t("العميل")}</th><th>{t("الحالة")}</th><th>{t("الخطأ")}</th></tr></thead>
                <tbody>
                  {runDetail.recipients.map((r) => (
                    <tr key={r.wa_id}><td><span dir="ltr">{r.wa_id}</span></td>
                      <td className={r.status === "queued" ? "good" : "bad"}>{r.status}</td>
                      <td className="muted">{r.error || "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-actions" style={{ justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setRunDetail(null)}>{t("إغلاق")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- stepper ---- */}
      <div className="presets" style={{ marginBottom: 14 }}>
        {["اسم الحملة", "القناة", "القالب", "الجمهور", "المراجعة والإرسال"].map((label, i) => (
          <button key={label} className={`chip ${step === i ? "active" : ""}`}
            disabled={i > 0 && !canNext.slice(0, i).every(Boolean)}
            onClick={() => setStep(i)}>{i + 1}. {t(label)}</button>
        ))}
      </div>

      {step === 0 && (
        <div className="section">
          <h3>{t("١. اسم الحملة")}</h3>
          <p className="muted" style={{ marginBottom: 10, fontSize: 12 }}>{t("للتعرّف على الحملة في السجل فقط — لا يظهر للعميل.")}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("مثال: تذكير ندوة أغسطس")} style={{ minWidth: 320 }} />
          <div className="row-actions" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" disabled={!canNext[0]} onClick={() => setStep(1)}>{t("التالي")}</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="section">
          <h3>{t("٢. القناة (رقم واتساب المُرسِل)")}</h3>
          <div className="tag-wrap">
            {(facets?.channels || []).map((c) => (
              <button key={c.ch} className={`tag-pill ${channel === c.ch ? "on" : ""}`} onClick={() => { setChannel(c.ch); setTemplateName(""); }}>
                {CHANNEL_LABELS[c.ch] || "—"} <span dir="ltr">+{c.ch}</span> <b>{c.n}</b>
              </button>
            ))}
          </div>
          <div className="row-actions" style={{ justifyContent: "space-between", marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setStep(0)}>{t("السابق")}</button>
            <button className="btn" disabled={!canNext[1]} onClick={() => setStep(2)}>{t("التالي")}</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="section">
          <h3>{t("٣. القالب")}</h3>
          {channelTemplates.length === 0 && <p className="note bad">{t("لا قوالب مُعتمدة لهذه القناة.")}</p>}
          <div className="tag-wrap" style={{ marginBottom: 12 }}>
            {channelTemplates.map((tpl2) => (
              <button key={tpl2.name} className={`tag-pill ${templateName === tpl2.name ? "on" : ""}`}
                onClick={() => setTemplateName(tpl2.name)}>
                {tpl2.name} <span className="muted">({tpl2.category})</span>
              </button>
            ))}
          </div>
          {tpl && (
            <div className="d-block">
              <h4>{t("معاينة نص القالب")}</h4>
              <p style={{ whiteSpace: "pre-wrap", background: "var(--surface-2)", padding: 10, borderRadius: 8 }}>{tpl.body}</p>
              {tpl.footer && <p className="muted" style={{ fontSize: 12 }}>{tpl.footer}</p>}
              {tpl.vars.length > 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {t("متغيّرات القالب مثل {{name}} تُعبَّأ تلقائياً بواسطة واتساب من الاسم المسجَّل لكل عميل — لا يمكن التحكّم بها من هنا.")}
                </p>
              )}
            </div>
          )}
          <div className="row-actions" style={{ justifyContent: "space-between", marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setStep(1)}>{t("السابق")}</button>
            <button className="btn" disabled={!canNext[2]} onClick={() => setStep(3)}>{t("التالي")}</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="section">
          <h3>{t("٤. الجمهور")}</h3>
          <div className="filterbar" style={{ marginBottom: 12 }}>
            <input placeholder={t("بحث بالاسم أو الرقم…")} value={filter.q} onChange={(e) => patchFilter({ q: e.target.value })} style={{ minWidth: 180 }} />
            <select value={filter.owner} onChange={(e) => patchFilter({ owner: e.target.value })}>
              <option value="">{t("كل الموظفين")}</option>
              {(facets?.owners || []).map((o) => <option key={o.owner} value={o.owner}>{o.owner} ({o.n})</option>)}
            </select>
            <select value={filter.country} onChange={(e) => patchFilter({ country: e.target.value })}>
              <option value="">{t("كل البلدان")}</option>
              {(facets?.countries || []).map((c) => <option key={c.iso2} value={c.iso2}>{c.flag} {cName(c)} ({c.n})</option>)}
            </select>
            <select value={filter.stage} onChange={(e) => patchFilter({ stage: e.target.value })}>
              <option value="">{t("كل المراحل")}</option>
              {(facets?.stages || []).map((s) => <option key={s.stage} value={s.stage}>{s.stage} ({s.n})</option>)}
            </select>
            <select value={filter.campaign} onChange={(e) => patchFilter({ campaign: e.target.value })}>
              <option value="">{t("كل الحملات الإعلانية")}</option>
              {(facets?.campaigns || []).map((c) => <option key={c.id} value={c.id}>{(c.name || c.id).slice(0, 30)} ({c.n})</option>)}
            </select>
            <span className="muted">{t("تاريخ الإنشاء من")}</span>
            <input type="date" value={filter.since} onChange={(e) => patchFilter({ since: e.target.value })} />
            <span className="muted">{t("إلى")}</span>
            <input type="date" value={filter.until} onChange={(e) => patchFilter({ until: e.target.value })} />
          </div>

          <div className="filterbar" style={{ marginBottom: 12 }}>
            <select value={filter.leadStage} onChange={(e) => patchFilter({ leadStage: e.target.value })}>
              <option value="">{t("كل مراحل واطي الخام")}</option>
              {(facets?.leadStages || []).map((s) => <option key={s.lead_stage} value={s.lead_stage}>{s.lead_stage} ({s.n})</option>)}
            </select>
            <select value={filter.state} onChange={(e) => patchFilter({ state: e.target.value })}>
              <option value="">{t("حالة التواصل: الكل")}</option>
              <option value="contacted">{t("تم التواصل")}</option>
              <option value="not_contacted">{t("لم يتم التواصل")}</option>
              <option value="bot_only">{t("بوت فقط")}</option>
            </select>
            <select value={filter.scoreBand} onChange={(e) => patchFilter({ scoreBand: e.target.value })}>
              <option value="">{t("درجة الاهتمام: الكل")}</option>
              {(facets?.scoreBands || []).map((b) => <option key={b.score_band} value={b.score_band}>{b.score_band} ({b.n})</option>)}
            </select>
            <select value={filter.source} onChange={(e) => patchFilter({ source: e.target.value })}>
              <option value="">{t("كل المصادر")}</option>
              {(facets?.sources || []).map((s) => <option key={s.source} value={s.source}>{s.source} ({s.n})</option>)}
            </select>
            <select value={filter.deposit} onChange={(e) => patchFilter({ deposit: e.target.value })}>
              <option value="">{t("الإيداع: الكل")}</option>
              <option value="yes">{t("أودع")}</option>
              <option value="no">{t("لم يودع")}</option>
            </select>
          </div>

          <div className="filterbar" style={{ marginBottom: 12 }}>
            <span className="muted">{t("آخر نشاط من")}</span>
            <input type="date" value={filter.activeSince} onChange={(e) => patchFilter({ activeSince: e.target.value })} />
            <span className="muted">{t("إلى")}</span>
            <input type="date" value={filter.activeUntil} onChange={(e) => patchFilter({ activeUntil: e.target.value })} />
            <span className="fb-sep" />
            <span className="muted">{t("عدد الرسائل من")}</span>
            <input type="number" min="0" placeholder={String(facets?.messageRange?.lo ?? 0)} value={filter.minMessages}
              onChange={(e) => patchFilter({ minMessages: e.target.value })} style={{ width: 80 }} />
            <span className="muted">{t("إلى")}</span>
            <input type="number" min="0" placeholder={String(facets?.messageRange?.hi ?? 0)} value={filter.maxMessages}
              onChange={(e) => patchFilter({ maxMessages: e.target.value })} style={{ width: 80 }} />
            <span className="fb-sep" />
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={filter.excludeUnlinked} onChange={(e) => patchFilter({ excludeUnlinked: e.target.checked })} />
              {t("استبعاد أرقام غير مرتبطة بالـ API")}
            </label>
          </div>

          <div className="d-block" style={{ marginBottom: 12 }}>
            <h4>{t("وسوم العملاء")}</h4>
            <div className="fb" style={{ marginBottom: 8 }}>
              <input type="search" placeholder={t("ابحث عن وسم…")} value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} style={{ minWidth: 180 }} />
              <select value={filter.tagMatch} onChange={(e) => patchFilter({ tagMatch: e.target.value })}>
                <option value="any">{t("مطابقة: أيّ وسم")}</option>
                <option value="all">{t("مطابقة: كل الوسوم")}</option>
              </select>
              {filter.tags.length > 0 && <button className="btn ghost sm" onClick={() => patchFilter({ tags: [] })}>{t("مسح الوسوم")}</button>}
            </div>
            {filter.tags.length > 0 && (
              <div className="tag-wrap" style={{ marginBottom: 8 }}>
                {filter.tags.map((tag) => (
                  <button key={tag} className="tag-pill on" onClick={() => toggleTag(tag)}>{tagLabel(tag)} ✕</button>
                ))}
              </div>
            )}
            <div className="tag-wrap">
              {shownTags.map((x) => (
                <button key={x.tag} className={`tag-pill ${filter.tags.includes(x.tag) ? "on" : ""} ${x.count ? "" : "zero"}`}
                  onClick={() => toggleTag(x.tag)}>{lang === "en" ? x.en : x.ar} <b>{x.count}</b></button>
              ))}
            </div>
          </div>

          {audience && (
            <div className="kpis" style={{ marginBottom: 12 }}>
              <div className="kpi"><div className="label">{t("مطابقون للفلتر")}</div><div className="val">{audience.total_matching}</div></div>
              <div className="kpi"><div className="label">{t("مُستثنَون (طلبوا التوقف)")}</div><div className="val bad">{audience.excluded_opted_out}</div></div>
              {audience.missing_contact_id > 0 && (
                <div className="kpi" title={t("مطابقون ومسموح التواصل معهم، لكن لم تُسحَب هويتهم الداخلية من واتساب بعد — يلزم تحديث بيانات واتساب أولاً.")}>
                  <div className="label">{t("بانتظار تحديث بيانات واتساب")}</div><div className="val">{audience.missing_contact_id}</div>
                </div>
              )}
              <div className="kpi"><div className="label">{t("سيتم إرسال الحملة إليهم")}</div><div className="val good">{audience.eligible}</div></div>
            </div>
          )}
          {audience?.by_country?.length > 0 && (
            <div className="presets" style={{ marginBottom: 12 }}>
              <span className="muted" style={{ alignSelf: "center" }}>{t("حسب الدولة")}:</span>
              {audience.by_country.slice(0, 12).map((c) => (
                <span key={c.iso2 || "?"} className="chip">{c.iso2 || t("غير معروف")} <b>{c.n}</b></span>
              ))}
            </div>
          )}

          <div className="row-actions" style={{ justifyContent: "space-between" }}>
            <button className="btn ghost" onClick={() => setStep(2)}>{t("السابق")}</button>
            <button className="btn" disabled={busy === "preview" || !audience?.eligible} onClick={goReview}>
              {busy === "preview" ? t("جارٍ التحميل…") : t("معاينة الحملة")}
            </button>
          </div>
        </div>
      )}

      {step === 4 && campaignPreview && (
        <div className="section">
          <h3>{t("٥. المراجعة والإرسال")}</h3>
          <div className="kpis" style={{ marginBottom: 12 }}>
            <div className="kpi"><div className="label">{t("سيصل القالب إلى")}</div><div className="val good">{campaignPreview.audience.eligible}</div></div>
            <div className="kpi"><div className="label">{t("مُستثنَون (طلبوا التوقف)")}</div><div className="val">{campaignPreview.audience.excluded_opted_out}</div></div>
          </div>
          <div className="d-block" style={{ marginBottom: 12 }}>
            <h4>{t("القالب")}: {campaignPreview.template.name}</h4>
            <p style={{ whiteSpace: "pre-wrap" }}>{campaignPreview.template.body}</p>
          </div>
          <p className="note" style={{ fontSize: 12 }}>
            {t("هذا إجراء يرسل رسائل واتساب حقيقية للعملاء المطابقين ولا يمكن التراجع عنه بعد التنفيذ (بخلاف إسناد المحادثات).")}
          </p>
          {!enabled && <p className="note bad">{t("الإرسال مُعطَّل حالياً — فعِّله من الأعلى قبل التنفيذ.")}</p>}
          <div className="filterbar" style={{ marginBottom: 12 }}>
            <span>{t("اكتب اسم الحملة")} <b>«{name}»</b> {t("لتفعيل زر الإرسال")}:</span>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} style={{ minWidth: 220 }} />
          </div>

          {result && (
            <div className={`note ${result.failed ? "bad" : "ok"}`} style={{ marginBottom: 12 }}>
              <b>{t("تم التنفيذ")}:</b> {result.sent} {t("قُدِّمت")} · {result.failed} {t("فشلت")}
              <button className="btn ghost sm" style={{ marginInlineStart: 12 }} onClick={resetWizard}>{t("حملة جديدة")}</button>
            </div>
          )}

          {!result && (
            <div className="row-actions" style={{ justifyContent: "space-between" }}>
              <button className="btn ghost" onClick={() => setStep(3)}>{t("السابق")}</button>
              <button className="btn orange" disabled={busy === "execute" || !enabled || confirmText.trim() !== name.trim()}
                onClick={doExecute}>
                {busy === "execute" ? t("جارٍ الإرسال…") : `${t("تنفيذ الإرسال إلى")} ${campaignPreview.audience.eligible}`}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
