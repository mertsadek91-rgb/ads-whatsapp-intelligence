// Reviewing the AI-generated business profile.
//
// The generated document decides how every future conversation is judged, so it
// cannot go live unread. Three parts need a human most, and they get real
// editing here rather than a summary:
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
//   Tags — the part the operator knows better than the generator does, because
//   it has to match the words their own CRM writes. Fully editable; see
//   TagEditor below for why it is built the way it is.
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

  const tagCount = (profile.tags?.categories || [])
    .reduce((n, c) => n + (c.tags?.length || 0), 0);
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

      <Section id="tags" title={t("وسوم العملاء", "Customer tags")}
        count={`${tagCount} ${t("وسم", "tags")}`}>
        <TagEditor profile={profile} lang={lang} patch={patch} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Defining the vocabulary by hand.
//
// The generator writes a first draft, but the operator knows the words their
// own CRM actually writes and the distinctions their team actually makes, so
// every tag has to be reachable: renamed, re-coded, deleted, added.
//
// The rule that shapes this screen is the duplicate. A code claimed by two
// categories is dropped from the second by the schema — deterministic and
// correct, and completely invisible to someone typing into a form. So a clash
// is shown HERE, on the row, while it can still be fixed, instead of being
// reported afterwards as something that already happened to a document the
// operator believed they had written.
const TAG_RE = /^[A-Z][A-Z0-9_%]{1,47}$/;
const CAT_KEY_RE = /^[a-z][a-z0-9_]{2,47}$/;

// Which system owns a category is the most consequential choice on this screen
// and the least self-explanatory, so each option carries its own justification
// rather than being three bare words in a dropdown.
const SOURCE_COPY = {
  ai: {
    ar: ["يستنتجه الذكاء الاصطناعي",
         "المعلومة موجودة في المحادثة ولا مكان آخر: ما يريده العميل، وما اعترض عليه، ولماذا انصرف."],
    en: ["Inferred by AI",
         "It lives in the conversation and nowhere else: what the customer wants, what they objected to, why they left."],
  },
  rule: {
    ar: ["محسوب بدقّة من بياناتنا",
         "لدينا القيمة فعلاً — التاريخ، الدولة، مصدر الإعلان — فتخمينها أسوأ من حسابها."],
    en: ["Computed exactly from data we hold",
         "We already have the value — the date, the country, the ad source — so guessing it is strictly worse."],
  },
  external: {
    ar: ["نظام آخر يملكها — لا تُخمَّن أبداً",
         "حالة موعد أو دفعة مخمَّنة تبدو تماماً كحالة حقيقية، ولا أحد يستطيع التمييز بينهما بعدها."],
    en: ["Owned by another system — never guessed",
         "A guessed appointment or payment status looks exactly like a real one, and nobody can tell them apart afterwards."],
  },
};

function TagEditor({ profile, lang, patch }) {
  const t = (ar, en) => (lang === "en" ? en : ar);
  const copy = (src) => (SOURCE_COPY[src] || SOURCE_COPY.ai)[lang === "en" ? "en" : "ar"];
  const [openCat, setOpenCat] = useState("");
  const cats = profile.tags?.categories || [];

  // Codes appearing more than once, over the WHOLE document — that is the scope
  // the schema de-duplicates over, so it is the scope to warn over.
  const seen = new Map();
  for (const c of cats) {
    for (const tag of c.tags || []) {
      const code = (tag[0] || "").trim();
      if (code) seen.set(code, (seen.get(code) || 0) + 1);
    }
  }

  const setCell = (ci, ti, col, value) => patch((p) => {
    p.tags.categories[ci].tags[ti][col] =
      col === 0 ? value.toUpperCase().replace(/[^A-Z0-9_%]/g, "") : value;
  });

  const addTag = (ci) => patch((p) => { p.tags.categories[ci].tags.push(["", "", ""]); });

  // Deleting only removes it from the vocabulary. Retiring it — so an old board
  // row carrying the code still renders a name instead of a bare CODE_LIKE_THIS
  // — happens on activation, which is the one place that sees both the old and
  // the new document. Doing it here as well would strand an entry the moment
  // someone deleted a tag and added it back before saving.
  const removeTag = (ci, ti) => patch((p) => { p.tags.categories[ci].tags.splice(ti, 1); });

  const addCategory = () => patch((p) => {
    p.tags.categories.push({
      key: "", source: "ai", name_ar: "", name_en: "", dept: "auto",
      platform: "", why_ar: "", exclusive: null, tags: [],
    });
  });

  const removeCategory = (ci) => patch((p) => { p.tags.categories.splice(ci, 1); });

  return (
    <>
      <p className="setup-note">
        {t("الرمز هو ما يُخزَّن فعلاً مع كل محادثة؛ التسميتان للعرض فقط. تعديل تسمية لا يكلّف شيئاً، أمّا تغيير الرمز فيعني وسماً جديداً مختلفاً.",
           "The code is what is actually stored against each conversation; the two labels are for display only. Renaming a label costs nothing; changing a code means a different tag.")}
      </p>

      {cats.map((c, ci) => {
        const badKey = c.key && !CAT_KEY_RE.test(c.key);
        const isOpen = openCat === String(ci);
        return (
          <div key={ci} className="setup-review-section">
            <button type="button" className="setup-review-head"
              onClick={() => setOpenCat(isOpen ? "" : String(ci))}>
              <span>
                {(lang === "en" ? c.name_en : c.name_ar) || c.key || t("فئة بلا اسم", "unnamed category")}
                {" "}
                <span className={`setup-badge ${c.source}`}>{copy(c.source)[0]}</span>
              </span>
              <span className="setup-review-count">{c.tags?.length || 0}</span>
            </button>

            {isOpen && (
              <div className="setup-review-body">
                <label>{t("الاسم بالعربية", "Arabic name")}</label>
                <input value={c.name_ar || ""}
                  onChange={(e) => patch((p) => { p.tags.categories[ci].name_ar = e.target.value; })} />
                <label>{t("الاسم بالإنجليزية", "English name")}</label>
                <input value={c.name_en || ""} dir="ltr"
                  onChange={(e) => patch((p) => { p.tags.categories[ci].name_en = e.target.value; })} />
                <label>{t("مفتاح الفئة (حروف إنجليزية صغيرة وشرطة سفلية)", "Category key (lowercase, underscores)")}</label>
                <input value={c.key || ""} dir="ltr"
                  onChange={(e) => patch((p) => {
                    p.tags.categories[ci].key = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_");
                  })} />
                {badKey && (
                  <p className="setup-locked">
                    {t("يبدأ بحرف إنجليزي صغير، وطوله من 3 إلى 48 حرفاً أو رقماً أو شرطة سفلية.",
                       "Starts with a lowercase letter, 3–48 letters, digits or underscores.")}
                  </p>
                )}

                <label>{t("من يُسنِد هذه الوسوم؟", "Who assigns these tags?")}</label>
                {["ai", "rule", "external"].map((src) => (
                  <label key={src} className="setup-source-card">
                    <input type="radio" name={`tagsrc-${ci}`} checked={c.source === src}
                      onChange={() => patch((p) => { p.tags.categories[ci].source = src; })} />
                    <span>
                      <strong>{copy(src)[0]}</strong>
                      <em>{copy(src)[1]}</em>
                    </span>
                  </label>
                ))}

                <table className="table setup-tagtable">
                  <thead><tr>
                    <th>{t("الرمز", "Code")}</th>
                    <th>{t("بالعربية", "Arabic")}</th>
                    <th>{t("بالإنجليزية", "English")}</th>
                    <th />
                  </tr></thead>
                  <tbody>
                    {(c.tags || []).map((tag, ti) => {
                      const code = (tag[0] || "").trim();
                      const dup = !!code && seen.get(code) > 1;
                      const malformed = !!code && !TAG_RE.test(code);
                      return (
                        <tr key={ti} className={dup || malformed ? "tag-bad" : ""}>
                          <td>
                            <input value={tag[0] || ""} dir="ltr"
                              onChange={(e) => setCell(ci, ti, 0, e.target.value)} />
                            {dup && (
                              <span className="setup-key bad">
                                {t("هذا الرمز مستعمَل في فئة أخرى. سيبقى في الفئة الأولى ويُحذف من هنا.",
                                   "This code is already used in another category. It stays in the first one and is dropped here.")}
                              </span>
                            )}
                            {malformed && !dup && (
                              <span className="setup-key bad">
                                {t("حروف إنجليزية كبيرة وأرقام وشرطة سفلية، حرفان على الأقل. هذا الوسم سيُهمَل.",
                                   "Capital letters, digits and underscores, at least two characters. This tag will be discarded.")}
                              </span>
                            )}
                          </td>
                          <td><input value={tag[2] || ""} onChange={(e) => setCell(ci, ti, 2, e.target.value)} /></td>
                          <td><input value={tag[1] || ""} dir="ltr" onChange={(e) => setCell(ci, ti, 1, e.target.value)} /></td>
                          <td>
                            <button type="button" className="btn ghost sm" onClick={() => removeTag(ci, ti)}>
                              {t("حذف", "Remove")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="setup-actions">
                  <button type="button" className="btn" onClick={() => addTag(ci)}>
                    {t("أضِف وسماً", "Add a tag")}
                  </button>
                  <button type="button" className="btn ghost"
                    onClick={() => {
                      const n = c.tags?.length || 0;
                      if (window.confirm(t(
                        `ستُحذف هذه الفئة و${n} وسماً معها. المحادثات القديمة تحتفظ بها وتبقى أسماؤها ظاهرة. متابعة؟`,
                        `This removes the category and its ${n} tags. Past conversations keep them and their names still render. Continue?`))) {
                        removeCategory(ci);
                      }
                    }}>
                    {t("احذف الفئة", "Remove category")}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="setup-actions">
        <button type="button" className="btn" onClick={addCategory}>
          {t("أضِف فئة وسوم", "Add a tag category")}
        </button>
      </div>
    </>
  );
}
