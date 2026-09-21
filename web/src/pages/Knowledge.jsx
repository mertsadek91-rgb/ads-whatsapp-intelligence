// Knowledge Base: review and curate the Q&A pairs distilled from real customer
// conversations (AI) or hand-written. Approve drafts, edit answers, delete
// noise, or generate a fresh batch from recent conversations. The approved set
// is what will later train an AI chatbot.
import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import { useI18n } from "../i18n.jsx";

const CAT_LABEL = {
  deposit: "الإيداع", withdrawal: "السحب", account: "الحساب", risk: "المخاطر",
  fees: "الرسوم", platform: "المنصّة", regulation: "التنظيم", general: "عام",
};

export default function Knowledge() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState({ status: "", category: "", q: "" });
  const [editing, setEditing] = useState(null); // {id, answer, category, status} | "new"

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
      setData(await api.get(`/knowledge${qs ? "?" + qs : ""}`));
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function generate() {
    setBusy("generate"); setError("");
    try {
      const r = await api.post("/knowledge/generate", {});
      await load();
      setBusy(`تم توليد ${r.upserted} زوجاً من ${r.sampled} محادثة`);
      setTimeout(() => setBusy(""), 4000);
    } catch (e) { setError(e.message); setBusy(""); }
  }

  async function saveEdit(row) {
    setBusy("save"); setError("");
    try {
      if (row.id === "new") await api.post("/knowledge", { question: row.question, answer: row.answer, category: row.category, lang: row.lang || "ar" });
      else await api.patch(`/knowledge/${row.id}`, { question: row.question, answer: row.answer, category: row.category });
      setEditing(null); await load();
    } catch (e) { setError(e.message); } finally { setBusy(""); }
  }

  async function setStatus(id, status) {
    await api.patch(`/knowledge/${id}`, { status }).catch((e) => setError(e.message));
    await load();
  }
  async function remove(id) {
    if (!window.confirm(t("حذف هذا الزوج نهائياً؟"))) return;
    await api.del(`/knowledge/${id}`).catch((e) => setError(e.message));
    await load();
  }

  const stats = data?.stats;
  const items = data?.items || [];
  const cats = data?.categories || [];

  return (
    <>
      <div className="topbar">
        <h2>{t("قاعدة المعرفة — أسئلة العملاء وأجوبتها")}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setEditing({ id: "new", question: "", answer: "", category: "general", lang: "ar" })}>
            {t("إضافة يدوية")}
          </button>
          <button className="btn primary" onClick={generate} disabled={busy === "generate" || !data?.aiAvailable}>
            {busy === "generate" ? t("جارٍ التوليد…") : t("توليد/تحديث من المحادثات")}
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t("تُستخرَج الأزواج تلقائياً من محادثات العملاء الحقيقية بالذكاء الاصطناعي (مسوّدات)، ثم تراجعها وتعتمدها. المجموعة المعتمدة ستُدرّب روبوت الدردشة لاحقاً.")}
      </p>

      {busy && busy !== "generate" && busy !== "save" && <p className="ok">{busy}</p>}
      {error && <p className="err">{error}</p>}
      {!data?.aiAvailable && <p className="muted" style={{ fontSize: 12 }}>{t("التوليد التلقائي معطّل — أضِف مفتاح DEEPSEEK_API_KEY.")}</p>}

      {stats && (
        <div className="kpis" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="label">{t("الإجمالي")}</div><div className="val">{stats.total}</div></div>
          <div className="kpi"><div className="label">{t("معتمدة")}</div><div className="val" style={{ color: "var(--green)" }}>{stats.approved}</div></div>
          <div className="kpi"><div className="label">{t("مسوّدات")}</div><div className="val">{stats.draft}</div></div>
          <div className="kpi"><div className="label">{t("بالذكاء الاصطناعي")}</div><div className="val">{stats.ai}</div></div>
        </div>
      )}

      <div className="filters" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">{t("كل الحالات")}</option>
          <option value="draft">{t("مسوّدات")}</option>
          <option value="approved">{t("معتمدة")}</option>
        </select>
        <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
          <option value="">{t("كل الفئات")}</option>
          {cats.map((c) => <option key={c} value={c}>{t(CAT_LABEL[c] || c)}</option>)}
        </select>
        <input placeholder={t("بحث…")} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
      </div>

      {loading && <p>{t("جارٍ التحميل…")}</p>}
      {!loading && items.length === 0 && <p className="muted">{t("لا توجد أزواج بعد. اضغط «توليد من المحادثات» للبدء.")}</p>}

      <div className="kb-list" style={{ display: "grid", gap: 10 }}>
        {items.map((it) => (
          <div key={it.id} className="card" style={{ padding: 12, borderInlineStart: `3px solid ${it.status === "approved" ? "var(--green)" : "var(--orange, #FF7A59)"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>
                  <span dir={it.lang === "en" ? "ltr" : "rtl"}>{it.question}</span>
                </div>
                <div className="muted" style={{ marginTop: 4, whiteSpace: "pre-wrap" }} dir={it.lang === "en" ? "ltr" : "rtl"}>{it.answer}</div>
                <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
                  <span className="badge">{t(CAT_LABEL[it.category] || it.category)}</span>
                  <span className="badge">{it.lang.toUpperCase()}</span>
                  <span className="badge">{it.source === "ai" ? t("ذكاء اصطناعي") : t("يدوي")}</span>
                  <span className="badge">{t("تكرار")}: {it.times_seen}</span>
                  <span className={`badge ${it.status === "approved" ? "b-active" : "b-paused"}`}>{it.status === "approved" ? t("معتمد") : t("مسوّدة")}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {it.status !== "approved"
                  ? <button className="btn primary" onClick={() => setStatus(it.id, "approved")}>{t("اعتماد")}</button>
                  : <button className="btn" onClick={() => setStatus(it.id, "draft")}>{t("إلغاء الاعتماد")}</button>}
                <button className="btn" onClick={() => setEditing({ id: it.id, question: it.question, answer: it.answer, category: it.category, lang: it.lang })}>{t("تعديل")}</button>
                <button className="btn danger" onClick={() => remove(it.id)}>{t("حذف")}</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h3>{editing.id === "new" ? t("إضافة زوج يدوي") : t("تعديل الزوج")}</h3>
            <label>{t("السؤال")}</label>
            <input value={editing.question} onChange={(e) => setEditing({ ...editing, question: e.target.value })} style={{ width: "100%" }} />
            <label>{t("الإجابة")}</label>
            <textarea value={editing.answer} onChange={(e) => setEditing({ ...editing, answer: e.target.value })} rows={5} style={{ width: "100%" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {cats.map((c) => <option key={c} value={c}>{t(CAT_LABEL[c] || c)}</option>)}
              </select>
              {editing.id === "new" && (
                <select value={editing.lang} onChange={(e) => setEditing({ ...editing, lang: e.target.value })}>
                  <option value="ar">AR</option><option value="en">EN</option>
                </select>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setEditing(null)}>{t("إلغاء")}</button>
              <button className="btn primary" onClick={() => saveEdit(editing)} disabled={busy === "save"}>{t("حفظ")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
