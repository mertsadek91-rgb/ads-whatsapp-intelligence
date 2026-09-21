// Reviewing the AI-generated business profile.
//
// The generated document decides how every future conversation is judged, so it
// cannot go live unread. Two parts need a human most, and they get real editing
// here rather than a summary:
//
//   Facts — anything the model states about the company is what the evaluator
//   will check an agent's claims against. An invented licence number would make
//   it confidently wrong in both directions, so unverified facts sort to the
//   top, show the quote the model based them on, and must be ticked one at a
//   time. There is deliberately no "verify all".
//
//   Issue types — the compliance vocabulary. Severity drives the score, so it
//   is editable, and the ten universal types are marked and cannot be removed.
//
// Everything else is shown as counts with the detail available, because a
// reviewer who is asked to read 140 tags reads none of them.
import { useState } from "react";

const SEVERITIES = ["informational", "minor", "moderate", "major", "critical"];
const SEV_AR = {
  informational: "للعلم", minor: "بسيطة", moderate: "متوسطة", major: "كبيرة", critical: "حرجة",
};

export default function ProfileReview({ profile, summary, warnings, repairs, lang, onChange }) {
  const [open, setOpen] = useState("facts");
  const t = (ar, en) => (lang === "en" ? en : ar);
  if (!profile) return null;

  const patch = (fn) => {
    const next = JSON.parse(JSON.stringify(profile));
    fn(next);
    onChange(next);
  };

  const facts = profile.identity?.facts || [];
  const unverified = facts.filter((f) => !f.verified_by_human && f.source !== "website").length;
  const sorted = [...facts].sort((a, b) =>
    Number(a.verified_by_human || a.source === "website") - Number(b.verified_by_human || b.source === "website"));

  const Section = ({ id, title, count, children }) => (
    <div className="setup-review-section">
      <button type="button" className="setup-review-head" onClick={() => setOpen(open === id ? "" : id)}>
        <span>{title}</span>
        <span className="setup-review-count">{count}</span>
      </button>
      {open === id && <div className="setup-review-body">{children}</div>}
    </div>
  );

  return (
    <div className="setup-review">
      <h3>{t("راجع ما فهمه الذكاء الاصطناعي عن نشاطك", "Review what the AI understood about your business")}</h3>
      <p className="setup-note">
        {t("هذا الملف يحدّد كيف ستُقيَّم كل محادثة لاحقاً. راجعه قبل التفعيل — يمكنك تعديله لاحقاً في أي وقت.",
           "This profile decides how every future conversation is judged. Review it before activating — you can edit it at any time later.")}
      </p>

      {warnings?.includes("SITE_UNREACHABLE") && (
        <div className="setup-result err">
          <strong>{t("تعذّرت قراءة موقعك", "Your website could not be read")}</strong>
          <p>{t("بُني هذا الملف من وصفك وحده. راجع كل معلومة بعناية أكبر.",
                "This profile was built from your description alone. Check every fact more carefully than usual.")}</p>
        </div>
      )}

      {repairs?.length > 0 && (
        <div className="setup-result err">
          <strong>{t("تعديلات أجريناها على ما اقترحه الذكاء الاصطناعي", "Changes we made to the AI's proposal")}</strong>
          <ul>{repairs.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}

      <Section id="identity" title={t("تعريف النشاط", "What the business does")} count="">
        <label>{t("وصف النشاط", "What you sell")}</label>
        <textarea rows={3} value={profile.identity?.what_we_sell || ""}
          onChange={(e) => patch((p) => { p.identity.what_we_sell = e.target.value; })} />
        <label>{t("اسم الشركة", "Company name")}</label>
        <input value={profile.identity?.company_name || ""}
          onChange={(e) => patch((p) => { p.identity.company_name = e.target.value; })} />
      </Section>

      <Section id="facts"
        title={t("معلومات الشركة المعتمدة", "Verified company facts")}
        count={unverified
          ? t(`${unverified} بحاجة لتأكيدك`, `${unverified} need your confirmation`)
          : t("كلها مؤكّدة", "all confirmed")}>
        <p className="setup-note">
          {t("سيستخدم النظام هذه المعلومات للحكم على صحّة ما يقوله موظفوك. أكّد كل معلومة بنفسك — معلومة خاطئة هنا تجعل التقييم خاطئاً في الاتجاهين.",
             "The system checks what your staff claim against these. Confirm each one yourself — a wrong fact here makes the evaluation wrong in both directions.")}
        </p>
        {!facts.length && <p>{t("لم يستخرج الذكاء الاصطناعي أي معلومات موثّقة. هذا آمن.",
                               "The AI extracted no documented facts. That is the safe outcome.")}</p>}
        {sorted.map((f) => {
          const i = facts.indexOf(f);
          const confirmed = f.verified_by_human || f.source === "website";
          return (
            <div key={f.key + i} className={`setup-fact ${confirmed ? "" : "unverified"}`}>
              <div className="setup-fact-row">
                <strong>{(lang === "en" ? f.label_en : f.label_ar) || f.key}</strong>
                <span className={`setup-badge ${f.source}`}>
                  {f.source === "website" ? t("من موقعك", "from your site")
                    : f.source === "operator" ? t("منك", "from you")
                    : t("غير مؤكَّد", "unverified")}
                </span>
              </div>
              <input value={f.value}
                onChange={(e) => patch((p) => { p.identity.facts[i].value = e.target.value; })} />
              {f.evidence && <p className="setup-evidence">“{f.evidence}”</p>}
              <div className="setup-fact-actions">
                <label>
                  <input type="checkbox" checked={!!f.verified_by_human}
                    onChange={(e) => patch((p) => { p.identity.facts[i].verified_by_human = e.target.checked; })} />
                  {t("أؤكّد صحّة هذه المعلومة", "I confirm this is correct")}
                </label>
                <button type="button" className="btn ghost sm"
                  onClick={() => patch((p) => { p.identity.facts.splice(i, 1); })}>
                  {t("حذف", "Remove")}
                </button>
              </div>
            </div>
          );
        })}
      </Section>

      <Section id="issues" title={t("المخالفات التي سترصد", "Compliance issues to detect")}
        count={summary?.issueTypes ?? profile.issue_types?.length}>
        <p className="setup-note">
          {t("درجة الخطورة تؤثّر مباشرة على تقييم الموظف. الأنواع المعلَّمة «أساسية» تخصّ جودة المحادثة نفسها ولا يمكن حذفها.",
             "Severity directly affects an agent's score. Types marked core are about conversation quality itself and cannot be removed.")}
        </p>
        <table className="table">
          <thead><tr>
            <th>{t("المخالفة", "Issue")}</th><th>{t("الخطورة", "Severity")}</th><th></th>
          </tr></thead>
          <tbody>
            {(profile.issue_types || []).map((it, i) => (
              <tr key={it.key}>
                <td>
                  {(lang === "en" ? it.en : it.ar) || it.key}
                  {it.core && <span className="setup-badge core">{t("أساسية", "core")}</span>}
                  <div className="setup-key">{it.key}</div>
                </td>
                <td>
                  <select value={it.default_severity}
                    onChange={(e) => patch((p) => { p.issue_types[i].default_severity = e.target.value; })}>
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>{lang === "en" ? s : SEV_AR[s]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {!it.core && (
                    <button type="button" className="btn ghost sm"
                      onClick={() => patch((p) => { p.issue_types.splice(i, 1); })}>
                      {t("حذف", "Remove")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="lifecycle" title={t("مراحل العميل", "Customer lifecycle")}
        count={profile.lifecycle?.stages?.length}>
        <p className="setup-note">
          {t("المرحلة المعلَّمة «تحوّل» هي اللحظة التي تعتبر فيها الشخص عميلاً — عليها تُبنى كل نسب التحويل.",
             "The stage marked converted is the moment you consider someone a customer — every conversion rate is built on it.")}
        </p>
        <ul>
          {(profile.lifecycle?.stages || []).map((s) => (
            <li key={s.key}>
              {(lang === "en" ? s.en : s.ar)}
              {s.counts_as_converted && <strong> — {t("تحوّل", "converted")}</strong>}
              {s.counts_as_qualified && !s.counts_as_converted && <span> — {t("مؤهّل", "qualified")}</span>}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="tags" title={t("وسوم العملاء", "Customer tags")} count={summary?.tags}>
        <p className="setup-note">
          {t("الوسوم المعلَّمة «نظام آخر» لن يخمّنها الذكاء الاصطناعي أبداً — لأن قيمة مخمَّنة ستكون غير مميَّزة عن قيمة حقيقية.",
             "Tags marked as owned by another system are never guessed by the AI — a guessed value would be indistinguishable from a real one.")}
        </p>
        {(profile.tags?.categories || []).map((c) => (
          <div key={c.key} className="setup-tagcat">
            <strong>{(lang === "en" ? c.name_en : c.name_ar) || c.key}</strong>
            <span className={`setup-badge ${c.source}`}>
              {c.source === "ai" ? t("يستنتجه الذكاء الاصطناعي", "inferred by AI")
                : c.source === "rule" ? t("محسوب بدقّة", "computed exactly")
                : t("نظام آخر — لا يُخمَّن", "another system — never guessed")}
            </span>
            <span className="setup-review-count">{c.tags?.length || 0}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}
