// Editing the business profile after installation.
//
// Reuses the wizard's review component verbatim: the thing an operator reviews
// before activating and the thing they edit six months later are the same
// document, and teaching two different screens for it would be a way to have
// them disagree.
//
// The one thing this page adds is honesty about cost. Activating a change can
// mean re-scoring a month of conversations against the AI budget, or it can be
// free — so the result says which, rather than letting someone discover it on
// the invoice.
import { useEffect, useState } from "react";
import api from "../api.js";
import { useI18n } from "../i18n.jsx";
import ProfileReview from "../setup/ProfileReview.jsx";

export default function BusinessProfile() {
  const { t, lang } = useI18n();
  const [live, setLive] = useState(null);
  const [draft, setDraft] = useState(null);
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState(null);
  const [repairs, setRepairs] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [errors, setErrors] = useState([]);
  const [versions, setVersions] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);

  const say = (ok, text) => setMsg({ ok, text });

  async function load() {
    try {
      const d = await api.get("/business-profile");
      setLive(d.profile); setMeta(d.meta); setSummary(d.summary); setAiAvailable(d.aiAvailable);
      const dr = await api.get("/business-profile/draft");
      if (dr.draft) {
        setDraft(dr.draft); setRepairs(dr.repairs || []);
        setWarnings(dr.warnings || []); setErrors(dr.errors || []);
      }
      setVersions(await api.get("/business-profile/versions").catch(() => []));
    } catch (e) { say(false, e.message); }
  }
  useEffect(() => { load(); }, []);

  const editing = draft || live;

  async function saveDraft(next) {
    setDraft(next);
    try {
      const r = await api.put("/business-profile/draft", { profile: next });
      setErrors(r.errors || []); setRepairs(r.repairs || []); setSummary(r.summary);
    } catch (e) { say(false, e.message); }
  }

  async function regenerate() {
    if (!window.confirm(t("سيُعاد بناء المسوّدة من موقعك ويُستبدل ما عدّلته فيها. متابعة؟"))) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.post("/business-profile/generate", {});
      setDraft(r.profile); setRepairs(r.repairs || []); setWarnings(r.warnings || []);
      setErrors(r.errors || []); setSummary(r.summary);
      say(true, t("تم بناء مسوّدة جديدة — راجعها قبل التفعيل"));
    } catch (e) { say(false, e.message); }
    finally { setBusy(false); }
  }

  async function activate() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post("/business-profile/activate", { profile: draft || live });
      say(true, r.reanalysisRequired
        ? t("تم التفعيل. تغيّرت مفردات التقييم، لذا ستُعاد مراجعة المحادثات الأخيرة تلقائياً.")
        : t("تم التفعيل. لم تتغيّر مفردات التقييم، فلن تُعاد مراجعة أي محادثة."));
      setDraft(null);
      await load();
    } catch (e) { say(false, e.message); }
    finally { setBusy(false); }
  }

  if (!editing) return <div>{t("جارٍ التحميل…")}</div>;

  return (
    <div>
      <h2>{t("ملف نشاط الشركة")}</h2>
      <p className="hint">
        {t("هذا الملف يحدّد كيف يُقيَّم كل موظف وكل محادثة. أي تعديل هنا يسري على التحليلات القادمة.")}
      </p>
      {msg && <div className={msg.ok ? "note ok" : "note err"}>{msg.text}</div>}

      <section className="section">
        <div className="setup-note">
          {t("النسخة الحالية")}: <b>v{meta?.version ?? 0}</b>
          {" · "}{t("مصدرها")}: {meta?.source === "ai" ? t("الذكاء الاصطناعي") : meta?.source === "human" ? t("تحرير يدوي") : t("افتراضية")}
          {" · "}{t("إصدار التقييم")}: <code>{meta?.policy_version}</code>
          {summary && <>
            {" · "}{summary.issueTypes} {t("نوع مخالفة")}
            {" · "}{summary.aiTags}/{summary.tags} {t("وسم يستنتجه الذكاء الاصطناعي")}
          </>}
        </div>
        {summary?.unverifiedFacts > 0 && (
          <div className="note err">
            {t("{n} معلومة عن شركتك لم تُؤكَّد بعد. النظام يستخدمها للحكم على صحّة ما يقوله موظفوك.",
               { n: summary.unverifiedFacts })}
          </div>
        )}
        {draft && (
          <div className="note">
            {t("لديك مسوّدة غير مفعّلة. ما تراه أدناه هو المسوّدة، والنسخة الحالية ما زالت تعمل.")}
          </div>
        )}
      </section>

      {errors.length > 0 && (
        <div className="note err">
          <strong>{t("لا يمكن التفعيل قبل إصلاح هذه:")}</strong>
          <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      <ProfileReview
        profile={editing} summary={summary} warnings={warnings} repairs={repairs}
        lang={lang} onChange={saveDraft} />

      <section className="section">
        <button className="btn primary" disabled={busy || errors.length > 0} onClick={activate}>
          {busy ? t("جارٍ…") : t("فعّل هذه النسخة")}
        </button>{" "}
        {draft && (
          <button className="btn ghost" disabled={busy}
            onClick={() => { setDraft(null); setErrors([]); setRepairs([]); load(); }}>
            {t("تجاهل المسوّدة")}
          </button>
        )}{" "}
        {aiAvailable && (
          <button className="btn ghost" disabled={busy} onClick={regenerate}>
            {t("أعِد البناء من موقع الشركة")}
          </button>
        )}
        <p className="hint">
          {t("التفعيل لا يعيد مراجعة المحادثات إلا إذا تغيّرت مفردات التقييم فعلاً — تغيير تسمية عربية لا يكلّف شيئاً.")}
        </p>
      </section>

      {versions.length > 1 && (
        <section className="section">
          <h3>{t("النسخ السابقة")}</h3>
          <table className="table">
            <thead><tr>
              <th>{t("النسخة")}</th><th>{t("الحالة")}</th><th>{t("مصدرها")}</th>
              <th>{t("إصدار التقييم")}</th><th>{t("فُعّلت")}</th>
            </tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.version}>
                  <td>v{v.version}</td>
                  <td>{v.status}</td>
                  <td>{v.source}</td>
                  <td><code>{v.policy_version}</code></td>
                  <td>{v.activated_at ? new Date(v.activated_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
