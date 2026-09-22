// What is still unconfigured, in the corner, after the install finishes.
//
// Letting steps be skipped is only half the feature. The other half is that a
// skipped step must stay visible, because the consequence of skipping is a board
// that is empty for a reason nobody can see — no ad spend without Meta, no
// scores without an AI key, no conversations at all without Wati. Each item
// therefore says what is missing BECAUSE of it, not just that it is missing.
//
// It reads live configuration, so an item disappears by itself once connected
// from Settings. Dismissal is per-browser and only until the next sign-in: this
// is a to-do, not an error, and not something to nag about every page load.
import { useEffect, useState } from "react";
import api from "../api.js";
import { useI18n } from "../i18n.jsx";

const DISMISS_KEY = "onboarding-dismissed";

export default function OnboardingPanel({ role }) {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    let alive = true;
    api.get("/onboarding")
      .then((d) => { if (alive) setStatus(d); })
      .catch(() => {});   // never let a to-do list break a page
    return () => { alive = false; };
  }, []);

  // Read the list, then decide — rather than trusting `pending` and reaching
  // for `items` afterwards. A response without `items` (a partial payload, an
  // older server, a route that answered {}) made this throw INSIDE the effect's
  // .then, where the catch below cannot see it: an unhandled rejection that
  // took down whatever page the panel was sitting on. A to-do list must never
  // be able to do that, which is what the catch was already there to promise.
  const items = Array.isArray(status?.items) ? status.items : [];
  const pending = items.filter((i) => !i.done);
  if (dismissed || !pending.length) return null;

  const doneCount = items.length - pending.length;
  const label = (i) => (lang === "en" ? i.en : i.ar);
  const why = (i) => (lang === "en" ? i.why_en : i.why_ar);

  function dismiss() {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* private window */ }
  }

  return (
    <aside className={`onboarding ${open ? "open" : "collapsed"}`}
      role="status" aria-label={t("إكمال الإعداد")}>
      <header>
        <button type="button" className="onboarding-toggle" onClick={() => setOpen((v) => !v)}
          aria-expanded={open}>
          <span className="onboarding-count">{pending.length}</span>
          {t("خطوات لم تُكمَل بعد")}
        </button>
        <button type="button" className="onboarding-close" onClick={dismiss}
          aria-label={t("إخفاء")}>×</button>
      </header>

      {open && (
        <div className="onboarding-body">
          <p className="onboarding-progress">
            {t("اكتمل {done} من {total}", { done: doneCount, total: items.length })}
            {" — "}
            {t("التطبيق يعمل، وهذه تزيد ما يمكنه عرضه.",
               "the app works; these widen what it can show you.")}
          </p>

          <ul>
            {pending.map((i) => (
              <li key={i.key}>
                <strong>{label(i)}</strong>
                <span>{why(i)}</span>
                {/* Only an admin can act on any of these, so nobody else is sent
                    to a page that will refuse them. */}
                {role === "admin" && <a href={i.href}>{t("إعداده الآن")}</a>}
              </li>
            ))}
          </ul>

          {doneCount > 0 && (
            <details className="onboarding-done">
              <summary>{t("المكتمل ({n})", { n: doneCount })}</summary>
              <ul>
                {items.filter((i) => i.done).map((i) => (
                  <li key={i.key}><span className="tick">✓</span> {label(i)}</li>
                ))}
              </ul>
            </details>
          )}

          {role !== "admin" && (
            <p className="onboarding-note">
              {t("يحتاج إكمالها حساب مدير.", "An administrator account is needed to complete these.")}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
