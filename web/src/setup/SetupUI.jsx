// Shared pieces every wizard step is built from.
//
// The one non-obvious rule here: a field's "where do I get this?" panel is part
// of the field, not a link to documentation somewhere else. An operator who has
// to leave the installer to find out what an App Secret is will not come back.
import { useState } from "react";
import { helpFor } from "./setupHelp.js";

export function HelpPanel({ field, lang }) {
  const [open, setOpen] = useState(false);
  const h = helpFor(field, lang);
  if (!h) return null;
  return (
    <div className="setup-help">
      <button type="button" className="setup-help-toggle" onClick={() => setOpen((v) => !v)}
        aria-expanded={open}>
        {open
          ? (lang === "en" ? "Hide instructions" : "إخفاء الشرح")
          : (lang === "en" ? "Where do I get this?" : "من أين أحصل على هذا؟")}
      </button>
      {open && (
        <div className="setup-help-body">
          {h.why && <p className="setup-help-why">{h.why}</p>}
          {h.steps?.length > 0 && (
            <ol>{h.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          )}
          {h.example && (
            <p className="setup-help-example">
              <span>{lang === "en" ? "Example" : "مثال"}:</span> <code>{h.example}</code>
            </p>
          )}
          {h.docUrl && (
            <p>
              <a href={h.docUrl} target="_blank" rel="noopener noreferrer">
                {lang === "en" ? "Official documentation ↗" : "التوثيق الرسمي ↗"}
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function Field({ field, lang, value, onChange, type, placeholder, disabled, textarea, children }) {
  const h = helpFor(field, lang);
  const inputType = type || (h?.secret ? "password" : "text");
  return (
    <div className="setup-field">
      <label>{h?.label || field}</label>
      {textarea ? (
        <textarea rows={5} value={value ?? ""} disabled={disabled} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      ) : children || (
        <input type={inputType} value={value ?? ""} disabled={disabled} placeholder={placeholder}
          autoComplete={h?.secret ? "new-password" : "off"}
          onChange={(e) => onChange(e.target.value)} />
      )}
      <HelpPanel field={field} lang={lang} />
    </div>
  );
}

/**
 * The result of a connection test. A failure is not an error page — it is the
 * most useful screen in the installer, so it gets the bilingual explanation,
 * the exact fix where one exists, and the documentation link.
 */
export function TestResult({ result, lang, onAction }) {
  if (!result) return null;
  const t = (ar, en) => (lang === "en" ? en : ar);

  if (result.ok) {
    return (
      <div className="setup-result ok">
        <strong>{t("نجح الاتصال", "Connected")}</strong>
        {result.warnings?.length > 0 && (
          <ul className="setup-warnings">
            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="setup-result err">
      <strong>{t("فشل الاتصال", "Could not connect")}</strong>
      {/* Fall back to whatever the server did send. A response shape we did not
          anticipate must still show the operator something, not an empty box. */}
      <p>{(lang === "en" ? result.en : result.ar) || result.message || result.error
          || t("خطأ غير متوقّع", "Unexpected error")}</p>
      {result.fix && <pre className="setup-fix">{result.fix}</pre>}
      {result.detail && <p className="setup-detail"><code>{result.detail}</code></p>}
      {result.docUrl && (
        <p><a href={result.docUrl} target="_blank" rel="noopener noreferrer">
          {t("التوثيق الرسمي ↗", "Official documentation ↗")}
        </a></p>
      )}
      {result.action === "create_database" && (
        <button type="button" className="btn" onClick={() => onAction?.("create_database")}>
          {t("أنشئ قاعدة البيانات لي", "Create the database for me")}
        </button>
      )}
      {result.action === "choose_ssl_mode" && (
        <button type="button" className="btn" onClick={() => onAction?.("choose_ssl_mode")}>
          {t("فعّل التشفير بدون تحقّق وأعِد المحاولة", "Turn on encryption without verification and retry")}
        </button>
      )}
    </div>
  );
}

export function StepActions({ lang, status, onTest, onSave, onBack, canSave, busy }) {
  const t = (ar, en) => (lang === "en" ? en : ar);
  return (
    <div className="setup-actions">
      {onBack && (
        <button type="button" className="btn ghost" onClick={onBack} disabled={busy}>
          {t("رجوع", "Back")}
        </button>
      )}
      <button type="button" className="btn" onClick={onTest} disabled={busy}>
        {busy ? t("جارٍ الاختبار…", "Testing…") : t("اختبار الاتصال", "Test connection")}
      </button>
      <button type="button" className="btn primary" onClick={onSave} disabled={busy || !canSave}>
        {t("حفظ ومتابعة", "Save and continue")}
      </button>
      {!canSave && status !== "saved" && (
        <span className="setup-gate-note">
          {t("اختبر الاتصال بنجاح أولاً", "A successful test is required first")}
        </span>
      )}
    </div>
  );
}

export default { Field, HelpPanel, TestResult, StepActions };
