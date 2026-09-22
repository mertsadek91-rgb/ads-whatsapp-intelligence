import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useFetch } from "../components/useFetch.js";
import { useI18n } from "../i18n.jsx";
import { useCurrency } from "../currency.jsx";
import api from "../api.js";

export default function Settings() {
  const { t } = useI18n();
  const { data, loading, reload } = useFetch("/meta/status");
  const [params, setParams] = useSearchParams();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  const banner = params.get("meta");
  const bannerMsg = params.get("msg");

  async function act(kind, fn) {
    setBusy(kind); setMsg(null);
    try { const r = await fn(); setMsg({ ok: true, text: t("تم بنجاح") }); reload(); return r; }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(""); }
  }
  const clearBanner = () => { params.delete("meta"); params.delete("msg"); setParams(params); };

  const s = data || {};
  const stateColor = s.connected && s.valid !== false ? "good" : "bad";

  return (
    <>
      <div className="topbar"><h2>{t("الإعدادات — اتصال Meta")}</h2></div>

      {banner && (
        <div className={`note ${banner === "connected" ? "ok" : "bad"}`} onClick={clearBanner} style={{ cursor: "pointer" }}>
          {banner === "connected" ? t("✓ تم ربط حساب Meta بنجاح.") : `${t("✗ تعذّر الربط")}: ${bannerMsg || ""}`} {t("(انقر للإخفاء)")}
        </div>
      )}

      <div className="section">
        <h3>{t("حالة الاتصال")}</h3>
        {loading ? <p>{t("جارٍ التحميل…")}</p> : (
          <table style={{ maxWidth: 620 }}>
            <tbody>
              <tr><td className="nm">{t("الحساب الإعلاني")}</td><td dir="ltr">{s.accountId}</td></tr>
              <tr><td className="nm">{t("App ID/Secret مهيّأ؟")}</td><td>{s.appConfigured ? <span className="good">{t("نعم")}</span> : <span className="bad">{t("لا — أضِفهما في .env")}</span>}</td></tr>
              <tr><td className="nm">{t("الحالة")}</td><td className={stateColor}>{s.connected ? (s.valid === false ? t("متّصل لكن التوكن غير صالح") : t("متّصل")) : t("غير متّصل")}</td></tr>
              <tr><td className="nm">{t("صلاحية حتى")}</td><td>{s.expiresAt ? `${new Date(s.expiresAt).toLocaleDateString("en-GB")} (${t("{n} يوم", { n: s.daysLeft })})` : "—"}</td></tr>
              <tr><td className="nm">{t("الصلاحيات")}</td><td dir="ltr" style={{ fontSize: 12 }}>{(s.scopes || []).join(", ") || "—"}</td></tr>
              {s.error && <tr><td className="nm">{t("خطأ")}</td><td className="bad">{s.error}</td></tr>}
            </tbody>
          </table>
        )}
        {msg && <div className={msg.ok ? "good" : "bad"} style={{ marginTop: 10 }}>{msg.text}</div>}
      </div>

      <div className="section">
        <h3>{t("الربط التلقائي (OAuth)")}</h3>
        {s.appConfigured ? (
          <>
            <p className="muted" style={{ marginBottom: 12 }}>
              {t("اضغط للربط بنقرة عبر تسجيل الدخول بحساب Meta. سيحوّل التطبيق التوكن إلى طويل الأمد ويجدّده تلقائياً.")}
            </p>
            <a className="btn orange" href="/api/meta/connect">{t("ربط حساب Meta")}</a>
            <button className="btn ghost" style={{ marginInlineStart: 10 }} disabled={busy === "refresh"}
              onClick={() => act("refresh", () => api.post("/meta/refresh"))}>{t("تجديد التوكن الآن")}</button>
            {s.connected && <button className="btn ghost" style={{ marginInlineStart: 10 }} disabled={busy === "disc"}
              onClick={() => act("disc", () => api.post("/meta/disconnect"))}>{t("فصل")}</button>}
          </>
        ) : (
          <div className="note">
            لتفعيل الربط التلقائي، أضِف في ملف <b>APP/.env</b>:<br />
            <code>META_APP_ID=…</code> · <code>META_APP_SECRET=…</code><br />
            ثم في إعدادات تطبيق Meta أضِف رابط التحويل (Valid OAuth Redirect URI):<br />
            <code dir="ltr">{s.redirectUri}</code><br />
            وأعد تشغيل الخادم.
          </div>
        )}
      </div>

      <div className="section">
        <h3>{t("إدخال توكن يدوياً (بديل)")}</h3>
        <p className="muted" style={{ marginBottom: 10 }}>
          {t("الصق أي توكن Meta (قصير أو طويل). إذا كان App ID/Secret مهيّأ، سيُحوّل تلقائياً إلى طويل الأمد.")}
        </p>
        <textarea rows="3" style={{ width: "100%", maxWidth: 620 }} placeholder="EAA..." value={token}
          onChange={(e) => setToken(e.target.value)} />
        <div style={{ marginTop: 10 }}>
          <button className="btn" disabled={busy === "save" || !token.trim()}
            onClick={() => act("save", async () => { await api.post("/meta/token", { token: token.trim() }); setToken(""); })}>
            {t("حفظ التوكن")}
          </button>
        </div>
      </div>

      <DataRangeSection />
      <CurrencyRatesSection />
      <WorkHoursSection />
    </>
  );
}

// How far back every import reads. Asked once during setup, and changed here
// afterwards — the honest first answer is usually "the last few months", and
// the answer a month later is "actually, everything".
//
// Saving changes nothing already stored: it decides what the NEXT import reads.
// The section says so and offers to run one, because the alternative is an
// operator who saves a wider range, sees the same numbers, and concludes the
// setting is broken.
function DataRangeSection() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useFetch("/settings/data-range");
  const [mode, setMode] = useState(null);      // "default" | "all" | "date"
  const [date, setDate] = useState("");
  const [msgs, setMsgs] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!data) return;
    setMode(data.since === "all" ? "all" : data.since ? "date" : "default");
    setDate(data.since && data.since !== "all" ? data.since : "");
    setMsgs(!!data.watiMessages);
  }, [data]);

  // Never disappear silently. An older server process that predates this route
  // answers 404, and returning null then made the whole setting invisible with
  // nothing on screen to explain why it was missing — which is indistinguishable
  // from never having been built.
  if (loading || error || !data || !mode) {
    return (
      <div className="section" data-section="data-range">
        <h3>{t("مدى البيانات المستوردة")}</h3>
        {loading ? <p className="muted">{t("جارٍ التحميل…")}</p> : (
          <p className="bad">
            {t("تعذّر قراءة هذا الإعداد")}: {error || "—"}
            <br />
            <span className="muted">
              {t("إن كان الخادم يعمل منذ ما قبل هذه الميزة، أعِد تشغيله.")}
            </span>
          </p>
        )}
      </div>
    );
  }

  const since = mode === "all" ? "all" : mode === "date" ? date : "";

  async function run(kind, fn, okText) {
    setBusy(kind); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okText }); reload(); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(""); }
  }

  return (
    <div className="section" data-section="data-range">
      <h3>{t("مدى البيانات المستوردة")}</h3>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t("يحدّد من أي تاريخ يقرأ النظام حملات Meta ومحادثات واتساب. الحالي")}: <b>{data.ar}</b>
      </p>

      <label className="chk">
        <input type="radio" name="dr" checked={mode === "all"} onChange={() => setMode("all")} />
        {t("كل البيانات المتاحة — نحو 37 شهراً من Meta، وكل جهات اتصال واتساب")}
      </label>
      <label className="chk">
        <input type="radio" name="dr" checked={mode === "date"} onChange={() => setMode("date")} />
        {t("من تاريخ محدّد")}
      </label>
      {mode === "date" && (
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          style={{ maxWidth: 200, marginInlineStart: 26 }} />
      )}
      <label className="chk">
        <input type="radio" name="dr" checked={mode === "default"} onChange={() => setMode("default")} />
        {t("النافذة الافتراضية — آخر {n} يوماً", { n: data.lookbackDays })}
      </label>

      <label className="chk" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={msgs} onChange={(e) => setMsgs(e.target.checked)} />
        {t("اسحب نصّ محادثات واتساب (مطلوب للتقييم — وهو الجزء الأبطأ: طلب لكل جهة اتصال)")}
      </label>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn" disabled={busy || (mode === "date" && !date)}
          onClick={() => run("save",
            () => api.post("/settings/data-range", { since, watiMessages: msgs }),
            t("حُفِظ. سيُطبَّق على عملية الاستيراد القادمة."))}>
          {busy === "save" ? "…" : t("حفظ")}
        </button>
        <button className="btn ghost" disabled={busy}
          onClick={() => run("import",
            () => api.post("/settings/data-range/import"),
            t("بدأ الاستيراد في الخلفية — تابِعه من حالة المهام."))}>
          {busy === "import" ? "…" : t("استورد الآن بهذا المدى")}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        {t("الحفظ وحده لا يجلب شيئاً جديداً — شغّل الاستيراد لملء الفترة الإضافية. قد يستغرق ساعات على حساب كبير، ويعمل في الخلفية.")}
      </p>
      {msg && <div className={msg.ok ? "good" : "bad"} style={{ marginTop: 10 }}>{msg.text}</div>}
    </div>
  );
}

// Working hours (Dubai) — used to tell "not contacted because after-hours" from
// "negligence" in the follow-up reports.
const DOW = [["0", "الأحد"], ["1", "الاثنين"], ["2", "الثلاثاء"], ["3", "الأربعاء"], ["4", "الخميس"], ["5", "الجمعة"], ["6", "السبت"]];
function WorkHoursSection() {
  const { t } = useI18n();
  const { data, reload } = useFetch("/settings/work-hours");
  const [wh, setWh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (data) setWh(data); }, [data]);
  if (!wh) return null;
  const toggleDay = (d) => setWh({ ...wh, offDays: wh.offDays.includes(d) ? wh.offDays.filter((x) => x !== d) : [...wh.offDays, d] });
  async function save() {
    setBusy(true); setMsg(null);
    try { const r = await api.post("/settings/work-hours", wh); setWh(r); setMsg({ ok: true, text: t("تم بنجاح") }); reload(); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  }
  return (
    <div className="section">
      <h3>{t("ساعات وأيام الدوام (بتوقيت دبي)")}</h3>
      <p className="muted" style={{ marginBottom: 12 }}>{t("تُستخدم لتمييز «لم يُتواصل بسبب خارج الدوام» عن الإهمال في تقارير المتابعة.")}</p>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <label className="field" style={{ maxWidth: 130 }}>{t("ساعة البدء")}
          <input type="number" min="0" max="23" value={wh.start} onChange={(e) => setWh({ ...wh, start: Number(e.target.value) })} />
        </label>
        <label className="field" style={{ maxWidth: 130 }}>{t("ساعة النهاية")}
          <input type="number" min="1" max="24" value={wh.end} onChange={(e) => setWh({ ...wh, end: Number(e.target.value) })} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className="muted" style={{ alignSelf: "center" }}>{t("أيام العطلة")}:</span>
        {DOW.map(([d, lbl]) => (
          <button key={d} type="button" className={`chip ${wh.offDays.includes(Number(d)) ? "active" : ""}`} onClick={() => toggleDay(Number(d))}>{t(lbl)}</button>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy} onClick={save}>{busy ? "…" : t("حفظ")}</button>
      </div>
      {msg && <div className={msg.ok ? "good" : "bad"} style={{ marginTop: 10 }}>{msg.text}</div>}
    </div>
  );
}

// BUG-022 fix: a manual, admin-edited exchange rate per currency — no live
// FX API. The BASE is whatever the Meta ad account bills in, is always fixed
// at 1, and every other rate answers "how many units of this currency equal 1
// of the base?". It used to be hardcoded as AED here and everywhere else,
// which made every figure on a non-AED account wrong by a factor nobody could
// see.
function CurrencyRatesSection() {
  const { t } = useI18n();
  const { currencies, rates, saveRates, base } = useCurrency();
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { setEdits(rates); }, [rates]);

  async function save() {
    setBusy(true); setMsg(null);
    try { await saveRates(edits); setMsg({ ok: true, text: t("تم بنجاح") }); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  }

  return (
    <div className="section">
      <h3>{t("أسعار تحويل العملات (ثابتة، تُضبَط يدوياً)")}</h3>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t("المبالغ مخزَّنة بعملة حسابك الإعلاني")}: <b>{base}</b>{" — "}
        {t("وهي مثبَّتة على 1. لكل عملة أخرى أدخِل: كم وحدة منها تساوي 1 {base}؟", { base })}
      </p>
      {base !== "AED" && (
        <div className="note" style={{ marginBottom: 12 }}>
          {t("الأسعار الابتدائية في النظام محسوبة على أساس الدرهم، فهي غير صحيحة لحسابك. راجِعها قبل الاعتماد على أي رقم محوَّل.")}
        </div>
      )}
      <div className="grid2" style={{ maxWidth: 520 }}>
        {currencies.filter((c) => c.code !== base).map((c) => (
          <div className="field" key={c.code}>
            <label>{c.symbol} {c.code} — {t(c.name_ar)}</label>
            <input type="number" step="0.001" min="0" value={edits[c.code] ?? ""}
              onChange={(e) => setEdits({ ...edits, [c.code]: e.target.value })} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy} onClick={save}>{busy ? "…" : t("حفظ الأسعار")}</button>
      </div>
      {msg && <div className={msg.ok ? "good" : "bad"} style={{ marginTop: 10 }}>{msg.text}</div>}
    </div>
  );
}
