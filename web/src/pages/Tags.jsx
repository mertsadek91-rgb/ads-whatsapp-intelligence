// Customer-type tags: browse the taxonomy, then filter customers and employees
// by it.
//
// The taxonomy is 294 tags, which is far too many to scroll, so the page is
// built around narrowing: pick a department or a source, search, click tags to
// build a filter, and the two result tables below answer "who are these
// customers" and "who is handling them".
//
// Every tag pill shows its live count, including the zeros. That is deliberate:
// the most useful thing this page says on day one is WHICH tags will stay empty
// until the trading platform and the compliance system start writing to Wati.
import { useEffect, useState, useCallback, useMemo } from "react";
import api from "../api.js";
import { useI18n } from "../i18n.jsx";
import { fmt0 } from "../components/useFetch.js";

const SRC_CLS = { ai: "b-warm", rule: "b-hot", external: "b-cold", manual: "b-issue" };
const SRC_AR = {
  ai: "ذكاء اصطناعي", rule: "قاعدة محسوبة", external: "نظام آخر", manual: "يدوي",
};
const SRC_EN = { ai: "AI", rule: "Computed rule", external: "Other system", manual: "Manual" };

/** Point the tagger at a period — same contract as the quality scan. */
function RunPanel({ t, onDone }) {
  const [range, setRange] = useState({ since: "", until: "" });
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (range.since) qs.set("since", range.since);
    if (range.until) qs.set("until", range.until);
    if (!range.since) qs.set("days", "30");
    try { setStatus(await api.get(`/tags/status?${qs}`)); setErr(""); }
    catch (e) { setErr(e.message); }
  }, [range.since, range.until]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!status?.running) return undefined;
    const id = setInterval(() => { load(); onDone?.(); }, 15000);
    return () => clearInterval(id);
  }, [status?.running, load, onDone]);

  async function run() {
    setBusy(true); setErr("");
    try {
      await api.post("/tags/run", { since: range.since || null, until: range.until || null, days: 30, limit: 5000 });
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const pending = status?.pending ?? null;
  // ~9s and ~$0.0015 per conversation, measured on this prompt.
  const mins = pending ? Math.max(1, Math.round((pending * 9) / 60)) : 0;
  const cost = pending ? (pending * 0.0015).toFixed(2) : "0.00";
  const cov = status?.taggable ? Math.round((status.tagged / status.taggable) * 1000) / 10 : null;

  return (
    <div className="section">
      <h3>{t("تشغيل التوسيم على فترة")}</h3>
      <p className="muted" style={{ marginBottom: 10 }}>
        {t("يقرأ الذكاء الاصطناعي نصّ المحادثة المحفوظ لدينا — لا يُعاد جلبها من واتساب — فيبقى الاقتباس المرفق بكل وسم مطابقاً للنص الذي يراه المراجع.")}
      </p>
      <div className="fb" style={{ marginBottom: 10 }}>
        <label className="field" style={{ margin: 0 }}>
          <span>{t("من تاريخ")}</span>
          <input type="date" value={range.since} max={range.until || undefined}
            onChange={(e) => setRange({ ...range, since: e.target.value })} />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span>{t("إلى تاريخ")}</span>
          <input type="date" value={range.until} min={range.since || undefined}
            onChange={(e) => setRange({ ...range, until: e.target.value })} />
        </label>
        <button className="btn" disabled={busy || status?.running || !pending} onClick={run}>
          {status?.running ? t("التوسيم قيد التشغيل…") : t("ابدأ التوسيم")}
        </button>
      </div>
      {err && <p className="err">{err}</p>}
      {status && (
        <>
          <div className="id-detail"><span>{t("الفترة")}</span>
            <b dir="ltr">{status.window ? `${status.window.since} → ${status.window.until}` : "—"}</b></div>
          <div className="id-detail"><span>{t("محادثات قابلة للتوسيم")}</span>
            <b>{fmt0(status.tagged)} / {fmt0(status.taggable)}{cov != null ? ` · ${cov}%` : ""}</b></div>
          <div className="id-detail"><span>{t("متبقٍّ بلا وسوم")}</span><b>{fmt0(pending)}</b></div>
          <div className="id-detail"><span>{t("الزمن والتكلفة المتوقّعة")}</span>
            <b>{pending ? `~${mins} ${t("دقيقة")} · ~$${cost}` : t("لا شيء متبقٍّ — الفترة مُقيَّمة بالكامل")}</b></div>
          <div className="id-detail"><span>{t("نسخة الوسوم")}</span><b dir="ltr">{status.tag_version}</b></div>
        </>
      )}
    </div>
  );
}

/**
 * One customer's tags with the evidence behind each, and confirm/reject.
 *
 * Laid out as a card per tag rather than a table on purpose. A table needs five
 * columns, and the widest of them holds an Arabic sentence of unpredictable
 * length — which forced a horizontal scroll that pushed the tag name itself out
 * of view and let the status text collide with the evidence. Cards have no
 * columns to fight over: the evidence gets the full width it needs, and the tag
 * name is never the thing that scrolls away.
 */
function Drill({ waId, t, lang, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api.get(`/tags/customer/${encodeURIComponent(waId)}`).then(setData).catch((e) => setErr(e.message));
  }, [waId]);
  useEffect(() => { load(); }, [load]);

  async function review(tag, action) {
    setBusy(true); setErr("");
    try { setData(await api.post(`/tags/customer/${encodeURIComponent(waId)}/review`, { tag, action })); onChanged?.(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function retag() {
    setBusy(true); setErr("");
    try { setData(await api.post(`/tags/customer/${encodeURIComponent(waId)}/retag`, {})); onChanged?.(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // Grouped by category so a customer with fifteen tags reads as a profile
  // rather than as a flat list.
  const groups = [];
  for (const x of data?.tags || []) {
    const g = groups.find((y) => y.key === x.category);
    if (g) g.tags.push(x); else groups.push({ key: x.category, label: x.category_label, tags: [x] });
  }
  const counts = (data?.tags || []).reduce((a, x) => {
    a[x.source] = (a[x.source] || 0) + 1;
    if (x.review_status === "rejected") a.rejected = (a.rejected || 0) + 1;
    return a;
  }, {});

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>{data?.customer?.name || waId}</h3>

        {data?.customer && (
          <div className="tg-facts">
            <div><span>{t("الرقم")}</span><b dir="ltr">{data.customer.phone || "—"}</b></div>
            <div><span>{t("الموظف")}</span><b>{data.customer.owner_label || "—"}</b></div>
            {data.run && (
              <div><span>{t("آخر توسيم")}</span>
                <b dir="ltr">{data.run.tag_version} · {new Date(data.run.tagged_at).toLocaleString("en-GB")}</b></div>
            )}
            <div><span>{t("عدد الوسوم")}</span>
              <b>{fmt0(data.tags.length)}
                {counts.ai ? ` · ${counts.ai} ${lang === "en" ? SRC_EN.ai : SRC_AR.ai}` : ""}
                {counts.rejected ? ` · ${counts.rejected} ${t("مرفوضة")}` : ""}</b></div>
          </div>
        )}

        {err && <p className="err">{err}</p>}
        {!data && <p className="muted">{t("جارٍ التحميل…")}</p>}
        {data && data.tags.length === 0 && <p className="muted">{t("لا وسوم لهذا العميل بعد")}</p>}

        <div className="tg-body">
          {groups.map((g) => (
            <div className="tg-group" key={g.key}>
              <h4>{g.label} <span className="muted">· {g.tags.length}</span></h4>
              {g.tags.map((x) => (
                <div className={`tg-card ${x.review_status}`} key={x.tag}>
                  <div className="tg-head">
                    <b className="tg-name">{x.label}</b>
                    <code dir="ltr">{x.tag}</code>
                    <span className={`badge ${SRC_CLS[x.source] || ""}`}>
                      {lang === "en" ? SRC_EN[x.source] : SRC_AR[x.source]}
                    </span>
                    <span className="badge b-cold">
                      {x.confidence == null ? t("قيمة مؤكَّدة") : `${t("ثقة")} ${Math.round(x.confidence * 100)}%`}
                    </span>
                    {x.review_status !== "auto" && (
                      <span className={`badge ${x.review_status === "confirmed" ? "b-active" : "b-issue"}`}>
                        {x.review_status === "confirmed" ? t("مؤكَّدة") : t("مرفوضة")}
                        {x.reviewed_by ? ` · ${x.reviewed_by}` : ""}
                      </span>
                    )}
                    {/* A computed rule tag has nothing to review — it is not an
                        opinion, so confirming it would be meaningless. */}
                    <div className="tg-actions">
                      {x.source === "rule"
                        ? <span className="muted">{t("محسوب — لا يحتاج مراجعة")}</span>
                        : (
                          <>
                            <button className="btn ghost sm" disabled={busy}
                              onClick={() => review(x.tag, x.review_status === "confirmed" ? "reset" : "confirm")}>
                              ✓ {t("تأكيد")}
                            </button>
                            <button className="btn ghost sm" disabled={busy}
                              onClick={() => review(x.tag, x.review_status === "rejected" ? "reset" : "reject")}>
                              ✕ {t("رفض")}
                            </button>
                          </>
                        )}
                    </div>
                  </div>
                  {x.evidence && <p className="tg-ev">{x.evidence}</p>}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="row-actions" style={{ marginTop: 14 }}>
          <button className="btn ghost" disabled={busy} onClick={retag}>{t("إعادة التوسيم بالذكاء الاصطناعي")}</button>
          <button className="btn ghost" onClick={onClose}>{t("إغلاق")}</button>
        </div>
      </div>
    </div>
  );
}

export default function Tags() {
  const { t, lang } = useI18n();
  const [catalog, setCatalog] = useState(null);
  const [dept, setDept] = useState("");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState([]);
  const [match, setMatch] = useState("any");
  const [view, setView] = useState("customers");
  const [customers, setCustomers] = useState(null);
  const [employees, setEmployees] = useState(null);
  const [page, setPage] = useState(1);
  const [drill, setDrill] = useState(null);
  const [err, setErr] = useState("");

  const loadCatalog = useCallback(() => {
    api.get("/tags/catalog").then(setCatalog).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const loadResults = useCallback(() => {
    const qs = new URLSearchParams({ match });
    if (picked.length) qs.set("tags", picked.join(","));
    if (view === "customers") {
      qs.set("page", String(page));
      api.get(`/tags/customers?${qs}`).then(setCustomers).catch((e) => setErr(e.message));
    } else {
      api.get(`/tags/employees?${qs}`).then(setEmployees).catch((e) => setErr(e.message));
    }
  }, [picked, match, view, page]);
  useEffect(() => { loadResults(); }, [loadResults]);
  useEffect(() => { setPage(1); }, [picked, match]);

  const toggle = (tag) => setPicked((p) => (p.includes(tag) ? p.filter((x) => x !== tag) : [...p, tag]));

  // Filtering happens client-side: the whole taxonomy is 294 rows, so a round
  // trip per keystroke would be slower than the search itself.
  const shown = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return catalog.categories
      .filter((c) => (!dept || c.dept === dept))
      .map((c) => ({
        ...c,
        tags: c.tags.filter((x) => (!source || x.source === source)
          && (!q || x.tag.toLowerCase().includes(q) || x.en.toLowerCase().includes(q) || x.ar.includes(search.trim()))),
      }))
      .filter((c) => c.tags.length > 0);
  }, [catalog, dept, source, search]);

  const label = (x) => (lang === "en" ? x.en : x.ar);
  const catName = (c) => (lang === "en" ? c.name_en : c.name_ar);

  return (
    <>
      <div className="topbar"><h2>{t("وسوم العملاء")}</h2></div>

      <p className="muted" style={{ marginBottom: 12 }}>
        {t("تصنيف نمط العميل وحالته من محادثاته. الوسم لا يُخمَّن: ما يمكن حسابه من بياناتنا يُحسب، وما يظهر في كلام العميل يستنتجه الذكاء الاصطناعي مع اقتباس يبرّره، وما مصدره منصّة التداول أو نظام الالتزام لا نكتبه من هنا أبداً.")}
      </p>

      {catalog && (
        <div className="kpis" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="label">{t("وسوم التصنيف")}</div><div className="val">{fmt0(catalog.totals.tags)}</div></div>
          <div className="kpi"><div className="label">{t("وسوم مستخدَمة فعلاً")}</div><div className="val">{fmt0(catalog.totals.tags_in_use)}</div></div>
          <div className="kpi"><div className="label">{t("عملاء مُوسَّمون")}</div><div className="val">{fmt0(catalog.totals.customers_tagged)}</div></div>
          <div className="kpi"><div className="label">{t("إسنادات الوسوم")}</div><div className="val">{fmt0(catalog.totals.assignments)}</div></div>
        </div>
      )}

      {err && <p className="err">{err}</p>}

      <div className="fb" style={{ marginBottom: 12 }}>
        <select value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">{t("كل الأقسام")}</option>
          {catalog && Object.entries(catalog.departments).map(([k, v]) =>
            <option key={k} value={k}>{lang === "en" ? v.en : v.ar}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">{t("كل المصادر")}</option>
          <option value="ai">{lang === "en" ? SRC_EN.ai : SRC_AR.ai}</option>
          <option value="rule">{lang === "en" ? SRC_EN.rule : SRC_AR.rule}</option>
          <option value="external">{lang === "en" ? SRC_EN.external : SRC_AR.external}</option>
        </select>
        <input type="search" placeholder={t("ابحث عن وسم…")} value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 200 }} />
        <select value={match} onChange={(e) => setMatch(e.target.value)}>
          <option value="any">{t("مطابقة: أيّ وسم")}</option>
          <option value="all">{t("مطابقة: كل الوسوم")}</option>
        </select>
        {picked.length > 0 && <button className="btn ghost" onClick={() => setPicked([])}>{t("مسح الاختيار")}</button>}
      </div>

      {picked.length > 0 && (
        <div className="section" style={{ marginBottom: 12 }}>
          <h3>{t("الوسوم المختارة")} <span className="muted">· {picked.length}</span></h3>
          <div className="tag-wrap">
            {picked.map((tag) => (
              <button key={tag} className="tag-pill on" onClick={() => toggle(tag)}>
                {catalog ? (() => {
                  for (const c of catalog.categories) {
                    const f = c.tags.find((x) => x.tag === tag);
                    if (f) return label(f);
                  }
                  return tag;
                })() : tag} ✕
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h3>{t("شجرة الوسوم")} <span className="muted">· {shown.length} {t("مجموعة")}</span></h3>
        <div className="grid2">
          {shown.map((c) => (
            <div key={c.key} className="d-block">
              <h4>
                {catName(c)}{" "}
                <span className={`badge ${SRC_CLS[c.source] || ""}`}>
                  {lang === "en" ? SRC_EN[c.source] : SRC_AR[c.source]}
                </span>{" "}
                <span className="muted">· {fmt0(c.tagged)}</span>
              </h4>
              {c.why_ar && lang !== "en" && <p className="muted" style={{ fontSize: 12, margin: "0 0 6px" }}>{c.why_ar}</p>}
              <div className="tag-wrap">
                {c.tags.map((x) => (
                  <button key={x.tag} className={`tag-pill ${picked.includes(x.tag) ? "on" : ""} ${x.count ? "" : "zero"}`}
                    onClick={() => toggle(x.tag)}
                    // A tag this app added on top of the owner's sheet does not
                    // exist in Wati yet; the tooltip says so rather than letting
                    // the pill imply it does.
                    title={x.added ? `${x.tag} — ${t("مُضاف فوق الشيت — غير موجود في Wati بعد")}` : x.tag}>
                    {label(x)}{x.added ? <i className="tg-new">+</i> : null} <b>{fmt0(x.count)}</b>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {shown.length === 0 && <p className="muted">{t("لا وسوم مطابقة")}</p>}
        </div>
      </div>

      <div className="fb" style={{ margin: "14px 0" }}>
        <button className={`btn ${view === "customers" ? "" : "ghost"}`} onClick={() => setView("customers")}>
          {t("العملاء")}
        </button>
        <button className={`btn ${view === "employees" ? "" : "ghost"}`} onClick={() => setView("employees")}>
          {t("الموظفون")}
        </button>
      </div>

      {view === "customers" && (
        <div className="section">
          <h3>{t("العملاء المطابقون")} {customers ? <span className="muted">· {fmt0(customers.total)}</span> : null}</h3>
          <div className="scroll">
            <table>
              <thead><tr>
                <th>{t("العميل")}</th><th>{t("الموظف")}</th><th>{t("المرحلة")}</th>
                <th>{t("الرسائل")}</th><th>{t("الوسوم")}</th><th></th>
              </tr></thead>
              <tbody>
                {customers && customers.rows.length === 0 && (
                  <tr><td colSpan={6} className="muted">{t("لا عملاء مطابقون")}</td></tr>
                )}
                {(customers?.rows || []).map((r) => (
                  <tr key={r.wa_id}>
                    <td className="nm">{r.name || r.wa_id}</td>
                    <td>{r.owner_label || "—"}</td>
                    <td>{r.stage || "—"}</td>
                    <td>{fmt0(r.messages)}</td>
                    <td>
                      <div className="tag-wrap">
                        {r.tags.slice(0, 6).map((x) => <span key={x.tag} className="tag-pill sm">{x.label}</span>)}
                        {r.tags.length > 6 && <span className="muted">+{r.tags.length - 6}</span>}
                      </div>
                    </td>
                    <td><button className="btn ghost sm" onClick={() => setDrill(r.wa_id)}>{t("تفاصيل")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {customers && customers.total > customers.page_size && (
            <div className="row-actions" style={{ marginTop: 10 }}>
              <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("السابق")}</button>
              <span className="muted">{page} / {Math.ceil(customers.total / customers.page_size)}</span>
              <button className="btn ghost sm" disabled={page >= Math.ceil(customers.total / customers.page_size)}
                onClick={() => setPage(page + 1)}>{t("التالي")}</button>
            </div>
          )}
        </div>
      )}

      {view === "employees" && (
        <div className="section">
          <h3>{t("الموظفون حسب وسوم عملائهم")}</h3>
          <p className="muted" style={{ marginBottom: 10 }}>
            {t("النسبة محسوبة من عملاء الموظف نفسه، لا من كل العملاء — فمقارنة 6 عملاء ساخنين من 12 بـ40 من 900 لا تعني شيئاً.")}
          </p>
          <div className="scroll">
            <table>
              <thead><tr>
                <th>{t("الموظف")}</th><th>{t("عملاؤه")}</th><th>{t("المطابقون")}</th>
                <th>{t("النسبة")}</th><th>{t("أكثر وسوم عملائه")}</th>
              </tr></thead>
              <tbody>
                {employees && employees.length === 0 && <tr><td colSpan={5} className="muted">{t("لا بيانات")}</td></tr>}
                {(employees || []).map((e) => (
                  <tr key={e.owner}>
                    <td className="nm">{e.owner_label}</td>
                    <td>{fmt0(e.customers)}</td>
                    <td>{fmt0(e.matched)}</td>
                    <td>{e.share_pct == null ? <span className="muted">—</span> : `${e.share_pct}%`}</td>
                    <td>
                      <div className="tag-wrap">
                        {e.top_tags.map((x) => (
                          <span key={x.tag} className="tag-pill sm">{x.label} <b>{fmt0(x.count)}</b></span>
                        ))}
                        {e.top_tags.length === 0 && <span className="muted">{t("لم تُوسَّم محادثاته بعد")}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <RunPanel t={t} onDone={() => { loadCatalog(); loadResults(); }} />

      {drill && (
        <Drill waId={drill} t={t} lang={lang} onClose={() => setDrill(null)}
          onChanged={() => { loadCatalog(); loadResults(); }} />
      )}
    </>
  );
}
