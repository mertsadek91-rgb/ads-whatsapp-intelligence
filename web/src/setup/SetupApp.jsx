// The installation wizard.
//
// One rule drives the whole state machine: a step cannot be saved until its
// connection test has actually passed. That is enforced on the server too —
// this is only the honest version of it in the UI, so nobody reaches the end of
// setup with a credential nobody ever proved works.
//
// Resumability comes entirely from the server: /status returns which steps are
// done plus the saved non-secret values, with secrets masked. Nothing about the
// install is kept in browser storage.
import { useEffect, useState } from "react";
import setupApi, { setInstallToken, setClaimId } from "./setupApi.js";
import { Field, TestResult, StepActions } from "./SetupUI.jsx";
import ProfileReview from "./ProfileReview.jsx";

const STEP_TITLES = {
  db: ["قاعدة البيانات", "Database"],
  meta: ["حساب إعلانات Meta", "Meta Ads"],
  wati: ["واتساب عبر Wati", "WhatsApp via Wati"],
  ai: ["الذكاء الاصطناعي", "AI"],
  business: ["تعريف النشاط", "Your business"],
  finish: ["حساب المدير", "Administrator"],
};
const ORDER = ["db", "meta", "wati", "ai", "business", "finish"];

export default function SetupApp() {
  const [lang, setLang] = useState("ar");
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState("db");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [tested, setTested] = useState({});
  const [done, setDone] = useState([]);
  const [tokenPrompt, setTokenPrompt] = useState(false);
  const [gen, setGen] = useState(null);      // the generated profile under review
  const [genBusy, setGenBusy] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [form, setForm] = useState({
    db: { host: "127.0.0.1", port: 3306, user: "", password: "", database: "" },
    meta: { appId: "", appSecret: "", token: "", accountId: "", apiVersion: "v21.0" },
    wati: { endpoint: "", token: "" },
    ai: { apiKey: "", baseUrl: "https://api.deepseek.com", model: "", dailyBudgetUsd: 10 },
    business: { websiteUrl: "", description: "", language: "ar" },
    finish: { email: "", password: "" },
  });

  const t = (ar, en) => (lang === "en" ? en : ar);
  const set = (s, k, v) => setForm((f) => ({ ...f, [s]: { ...f[s], [k]: v } }));

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  async function refresh() {
    const { data } = await setupApi.status();
    setStatus(data);
    if (data.installed) return;
    setDone(data.completedSteps || []);
    setStep(data.currentStep || "db");
    // Re-populate what is safe to show, so a closed browser does not mean
    // starting over. Secrets come back masked and are never pre-filled.
    if (data.saved?.mysql) {
      setForm((f) => ({ ...f, db: { ...f.db, ...data.saved.mysql, password: "" } }));
    }
    setForm((f) => ({
      ...f,
      meta: { ...f.meta, appId: data.saved?.meta?.appId || f.meta.appId,
        accountId: data.saved?.meta?.accountId || f.meta.accountId,
        apiVersion: data.saved?.meta?.apiVersion || f.meta.apiVersion },
      wati: { ...f.wati, endpoint: data.saved?.wati?.endpoint || f.wati.endpoint },
      ai: { ...f.ai, baseUrl: data.saved?.ai?.baseUrl || f.ai.baseUrl,
        model: data.saved?.ai?.model || f.ai.model },
    }));
  }

  useEffect(() => { refresh(); }, []);

  async function claimIfNeeded() {
    const r = await setupApi.claim();
    if (r.status === 401) { setTokenPrompt(true); return false; }
    if (r.status === 409) {
      setResult({ ok: false, ar: `شخص آخر بدأ التنصيب من ${r.data.claimedFrom}`,
        en: `Someone else started the installer from ${r.data.claimedFrom}` });
      return false;
    }
    if (r.data?.claimId) setClaimId(r.data.claimId);
    return true;
  }

  async function runTest() {
    setBusy(true); setResult(null);
    try {
      if (!(await claimIfNeeded())) return;
      const { data } = await setupApi.test(step, form[step]);
      setResult(data);
      setTested((x) => ({ ...x, [step]: !!data.ok }));
      // The Meta test returns the ad accounts it can see; pre-select when
      // there is only one, so the common case needs no decision.
      if (step === "meta" && data.ok && data.details?.adAccounts?.length === 1 && !form.meta.accountId) {
        set("meta", "accountId", data.details.adAccounts[0].id);
        setTested((x) => ({ ...x, meta: false })); // re-test with the account chosen
      }
      if (step === "ai" && data.ok && data.details?.model && !form.ai.model) {
        set("ai", "model", data.details.model);
      }
    } finally { setBusy(false); }
  }

  async function runSave() {
    setBusy(true); setResult(null);
    try {
      if (!(await claimIfNeeded())) return;
      const { data, ok } = await setupApi.save(step, form[step]);
      setResult(data);
      if (!ok) return;
      if (step === "db") {
        // Create every table before moving on, so a failure here is attached to
        // the database step where the operator can still fix the grant.
        const m = await setupApi.migrate();
        if (!m.ok) { setResult(m.data); return; }
        setResult({ ok: true, warnings: [
          t(`تم إنشاء ${m.data.tables.length} جدولاً`, `Created ${m.data.tables.length} tables`)] });
      }
      await refresh();
      const next = ORDER[ORDER.indexOf(step) + 1];
      if (next) { setStep(next); setResult(null); }
    } finally { setBusy(false); }
  }

  /**
   * Read the company's site and build the vocabulary the evaluator will use.
   * Slow (three AI calls), so the button says so rather than appearing hung.
   */
  async function generateProfile() {
    setGenBusy(true); setResult(null);
    try {
      if (!(await claimIfNeeded())) return;
      const { data, ok } = await setupApi.generateProfile(form.business);
      if (!ok) { setResult({ ok: false, ar: data.detail, en: data.detail }); return; }
      setGen(data);
    } finally { setGenBusy(false); }
  }

  /** Approve the reviewed draft and make it the live vocabulary. */
  async function approveProfile() {
    setGenBusy(true); setResult(null);
    try {
      const { data, ok } = await setupApi.approveProfile(gen.profile);
      if (!ok) { setResult({ ok: false, ar: data.detail, en: data.detail }); return; }
      setTested((x) => ({ ...x, business: true }));
      setResult({ ok: true, warnings: [t("تم تفعيل ملف نشاطك", "Your business profile is live")] });
    } finally { setGenBusy(false); }
  }

  async function createDb() {
    setBusy(true);
    try {
      const { data } = await setupApi.createDatabase(form.db);
      setResult(data);
      if (data.ok) await runTest();
    } finally { setBusy(false); }
  }

  async function finish() {
    setBusy(true); setResult(null);
    try {
      if (!(await claimIfNeeded())) return;
      const { data, ok } = await setupApi.finish(form.finish);
      if (!ok) { setResult({ ok: false, ar: data.detail, en: data.detail }); return; }
      window.location.href = "/";
    } finally { setBusy(false); }
  }

  if (status?.installed) {
    window.location.href = "/";
    return null;
  }
  if (!status) return <div className="setup-loading">{t("جارٍ التحميل…", "Loading…")}</div>;

  const canSave = !!tested[step] || done.includes(step);

  return (
    <div className="setup-shell">
      <aside className="setup-rail">
        <h1>{t("تنصيب النظام", "Installation")}</h1>
        <p className="setup-sub">
          {t("خمس خطوات، كل واحدة تُختبر فعلياً قبل الحفظ.",
             "Five steps, each verified against the real service before it is saved.")}
        </p>
        <ol className="setup-steps">
          {ORDER.map((s, i) => (
            <li key={s}
              className={[
                s === step ? "current" : "",
                done.includes(s) ? "done" : "",
                !done.includes(s) && s !== step ? "locked" : "",
              ].join(" ").trim()}>
              <span className="n">{done.includes(s) ? "✓" : i + 1}</span>
              <span>{lang === "en" ? STEP_TITLES[s][1] : STEP_TITLES[s][0]}</span>
            </li>
          ))}
        </ol>
        <button className="btn ghost sm" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
          {lang === "ar" ? "English" : "العربية"}
        </button>
      </aside>

      <main className="setup-main">
        <h2>{lang === "en" ? STEP_TITLES[step][1] : STEP_TITLES[step][0]}</h2>

        {tokenPrompt && (
          <div className="setup-result err">
            <strong>{t("مطلوب رمز التنصيب", "Install token required")}</strong>
            <p>{t("انسخ الرمز المطبوع في سجلّ الخادم عند أول تشغيل.",
                  "Copy the token printed in the server log on first start.")}</p>
            <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
              placeholder="install token" />
            <button className="btn" onClick={() => { setInstallToken(tokenInput); setTokenPrompt(false); }}>
              {t("متابعة", "Continue")}
            </button>
          </div>
        )}

        {step === "db" && (
          <>
            {status.lockedByEnv?.mysql && (
              <p className="setup-locked">
                {t("قاعدة البيانات مضبوطة عبر متغيّر البيئة MYSQL_URL — تُدار من نشر التطبيق.",
                   "The database is set through the MYSQL_URL environment variable and is managed by your deployment.")}
              </p>
            )}
            <Field field="db.host" lang={lang} value={form.db.host}
              onChange={(v) => set("db", "host", v)} disabled={status.lockedByEnv?.mysql} />
            <div className="setup-field">
              <label>{t("المنفذ", "Port")}</label>
              <input type="number" value={form.db.port} onChange={(e) => set("db", "port", e.target.value)} />
            </div>
            <Field field="db.user" lang={lang} value={form.db.user} onChange={(v) => set("db", "user", v)} />
            <div className="setup-field">
              <label>{t("كلمة المرور", "Password")}</label>
              <input type="password" autoComplete="new-password" value={form.db.password}
                onChange={(e) => set("db", "password", e.target.value)} />
            </div>
            <Field field="db.database" lang={lang} value={form.db.database}
              onChange={(v) => set("db", "database", v)} />
          </>
        )}

        {step === "meta" && (
          <>
            <Field field="meta.appId" lang={lang} value={form.meta.appId} onChange={(v) => set("meta", "appId", v)} />
            <Field field="meta.appSecret" lang={lang} value={form.meta.appSecret} onChange={(v) => set("meta", "appSecret", v)} />
            <Field field="meta.token" lang={lang} value={form.meta.token} onChange={(v) => set("meta", "token", v)} />
            <p className="setup-note">
              {t("رابط إعادة التوجيه المطلوب تسجيله في تطبيق Meta:",
                 "The redirect URI you must register in your Meta app:")}
              <code>{status.redirectUri}</code>
            </p>
            <Field field="meta.accountId" lang={lang} value={form.meta.accountId}
              onChange={(v) => set("meta", "accountId", v)}>
              {result?.details?.adAccounts?.length ? (
                <select value={form.meta.accountId} onChange={(e) => { set("meta", "accountId", e.target.value); setTested((x) => ({ ...x, meta: false })); }}>
                  <option value="">{t("— اختر حساباً —", "— pick an account —")}</option>
                  {result.details.adAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.id} · {a.currency}{a.active ? "" : t(" (موقوف)", " (inactive)")}
                    </option>
                  ))}
                </select>
              ) : null}
            </Field>
            {result?.details?.campaigns?.length > 0 && (
              <p className="setup-note">
                {t(`وجدنا ${result.details.campaigns.length} حملة في هذا الحساب.`,
                   `Found ${result.details.campaigns.length} campaigns in this account.`)}
              </p>
            )}
          </>
        )}

        {step === "wati" && (
          <>
            <Field field="wati.endpoint" lang={lang} value={form.wati.endpoint} onChange={(v) => set("wati", "endpoint", v)} />
            <Field field="wati.token" lang={lang} value={form.wati.token} onChange={(v) => set("wati", "token", v)} />
            {result?.ok && (
              <p className="setup-note">
                {t("العنوان بعد التصحيح:", "Resolved endpoint:")} <code>{result.details.resolvedEndpoint}</code><br />
                {t("عدد جهات الاتصال:", "Contacts:")} {result.details.contactCount ?? "—"}<br />
                {t("أرقام واتساب المتصلة:", "Connected WhatsApp numbers:")} {result.details.channels?.join("، ") || "—"}
              </p>
            )}
          </>
        )}

        {step === "ai" && (
          <>
            <Field field="ai.apiKey" lang={lang} value={form.ai.apiKey} onChange={(v) => set("ai", "apiKey", v)} />
            <div className="setup-field">
              <label>{t("النموذج", "Model")}</label>
              <select value={form.ai.model} onChange={(e) => set("ai", "model", e.target.value)}>
                <option value="">{t("— اختبر الاتصال أولاً —", "— test the connection first —")}</option>
                {(result?.details?.models || []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <Field field="ai.dailyBudgetUsd" lang={lang} value={form.ai.dailyBudgetUsd}
              onChange={(v) => set("ai", "dailyBudgetUsd", v)} type="number" />
            {result?.ok && result.details?.estimatedCostUsd != null && (
              <p className="setup-note">
                {t("تكلفة نداء اختباري:", "Cost of the test call:")} ${result.details.estimatedCostUsd.toFixed(6)}
              </p>
            )}
          </>
        )}

        {step === "business" && (
          <>
            <Field field="business.websiteUrl" lang={lang} value={form.business.websiteUrl}
              onChange={(v) => set("business", "websiteUrl", v)} placeholder="https://example.com" />
            <Field field="business.description" lang={lang} value={form.business.description}
              onChange={(v) => set("business", "description", v)} textarea />
            {result?.ok && result.details && (
              <p className="setup-note">
                {result.details.readable
                  ? t(`قرأنا ${result.details.pagesRead} صفحة من موقعك.`,
                       `Read ${result.details.pagesRead} pages from your site.`)
                  : t("تعذّرت قراءة الموقع — سنعتمد على وصفك وحده.",
                       "Could not read the site — we will rely on your description alone.")}
              </p>
            )}

            {!gen && (
              <div className="setup-actions">
                <button type="button" className="btn primary" disabled={genBusy || !tested.business}
                  onClick={generateProfile}>
                  {genBusy
                    ? t("جارٍ القراءة والتحليل… قد يستغرق دقيقة", "Reading and analysing… this can take a minute")
                    : t("حلّل نشاطي وابنِ ملف التقييم", "Analyse my business and build the profile")}
                </button>
                {!tested.business && (
                  <span className="setup-gate-note">
                    {t("اختبر الاتصال بالموقع أولاً", "Check the website first")}
                  </span>
                )}
              </div>
            )}

            {gen && (
              <>
                <ProfileReview
                  profile={gen.profile} summary={gen.summary}
                  warnings={gen.warnings} repairs={gen.repairs} lang={lang}
                  onChange={(p) => setGen((g) => ({ ...g, profile: p }))} />
                <div className="setup-actions">
                  <button type="button" className="btn ghost" disabled={genBusy}
                    onClick={() => setGen(null)}>
                    {t("أعِد التحليل من جديد", "Analyse again")}
                  </button>
                  <button type="button" className="btn primary" disabled={genBusy}
                    onClick={approveProfile}>
                    {t("أوافق — فعّل هذا الملف", "Approve and activate")}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {step === "finish" && (
          <>
            <p className="setup-note">
              {t("آخر خطوة: أنشئ حساب المدير الأول.", "Last step: create the first administrator account.")}
            </p>
            <Field field="admin.email" lang={lang} value={form.finish.email}
              onChange={(v) => set("finish", "email", v)} type="email" />
            <Field field="admin.password" lang={lang} value={form.finish.password}
              onChange={(v) => set("finish", "password", v)} type="password" />
          </>
        )}

        <TestResult result={result} lang={lang} onAction={(a) => a === "create_database" && createDb()} />

        {step === "finish" ? (
          <div className="setup-actions">
            <button className="btn ghost" disabled={busy}
              onClick={() => setStep(ORDER[ORDER.indexOf(step) - 1])}>{t("رجوع", "Back")}</button>
            <button className="btn primary" onClick={finish}
              disabled={busy || !form.finish.email || !form.finish.password}>
              {busy ? t("جارٍ الإنهاء…", "Finishing…") : t("إنهاء التنصيب", "Finish installation")}
            </button>
          </div>
        ) : (
          <StepActions lang={lang} status={step} busy={busy} canSave={canSave}
            onTest={runTest} onSave={runSave}
            onBack={ORDER.indexOf(step) > 0 ? () => { setStep(ORDER[ORDER.indexOf(step) - 1]); setResult(null); } : null} />
        )}
      </main>
    </div>
  );
}
