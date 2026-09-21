import { useState } from "react";
import api from "../api.js";
import { useI18n } from "../i18n.jsx";

export default function Login({ onLogin }) {
  const { t, lang, setLang } = useI18n();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try { await api.login(email, pw); onLogin(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost lang-switch"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            {lang === "ar" ? "EN" : "عربي"}
          </button>
        </div>
        <h1>IST Markets</h1>
        <p>{t("لوحة الحملات والعملاء")}</p>
        <input type="email" placeholder={t("البريد الإلكتروني")} value={email}
               onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" />
        <input type="password" placeholder={t("كلمة المرور")} value={pw}
               onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
        <button className="btn" disabled={busy}>{busy ? "…" : t("دخول")}</button>
        {err && <div className="err">{err}</div>}
      </form>
    </div>
  );
}
