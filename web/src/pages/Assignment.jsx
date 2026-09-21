// Customers & assignment — every contact with its owner, phone-derived
// country and conversation state, filterable and paginated over the full
// table. Rows are multi-selectable (including "select all matching the
// filter") in preparation for bulk re-assignment; this batch is read-only,
// so the selection is shown and counted but not yet acted on.
import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import { useI18n } from "../i18n.jsx";

const PAGE = 50;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

export default function Assignment() {
  const { t, lang } = useI18n();
  const [facets, setFacets] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState(() => new Set());
  // Deep-linkable: /assignment?owner=__unhandled__ arrives pre-filtered from
  // the coverage-gap alert on the sales board.
  const [f, setF] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return { owner: p.get("owner") || "", country: p.get("country") || "",
      state: p.get("state") || "", chat: p.get("chat") || "", campaign: "", q: "" };
  });
  const [target, setTarget] = useState("");     // employee to assign to
  const [preview, setPreview] = useState(null); // dry-run result -> confirm modal
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);   // last execute result (offers undo)

  const [breakdown, setBreakdown] = useState([]);

  useEffect(() => { api.get("/assignment/facets").then(setFacets).catch((e) => setErr(e.message)); }, []);

  // Country split of whatever is currently filtered — answers "where are the
  // unassigned ones?" without leaving the page.
  const qsOf = useCallback((extra = {}) => new URLSearchParams({
    ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), ...extra,
  }).toString(), [f]);
  useEffect(() => {
    api.get(`/assignment/breakdown?${qsOf()}`).then((b) => setBreakdown(b.countries || [])).catch(() => setBreakdown([]));
  }, [qsOf]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)),
        limit: String(PAGE), offset: String(offset) }).toString();
      setData(await api.get(`/assignment/contacts?${qs}`));
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [f, offset]);
  useEffect(() => { load(); }, [load]);

  // Changing a filter must reset paging AND the selection — otherwise you can
  // act on rows that are no longer part of what you're looking at.
  function setFilter(patch) { setF((p) => ({ ...p, ...patch })); setOffset(0); setSel(new Set()); }

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const pageIds = rows.map((r) => r.wa_id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => sel.has(id));

  function toggle(id) {
    setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function togglePage() {
    setSel((prev) => {
      const n = new Set(prev);
      if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id));
      return n;
    });
  }
  async function selectAllMatching() {
    try {
      const qs = new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v))).toString();
      const r = await api.get(`/assignment/contacts/ids?${qs}`);
      setSel(new Set(r.ids));
      if (r.capped) setErr(t("تم تحديد أول دفعة فقط (حدّ أقصى للحماية) — ضيّق الفلتر."));
    } catch (e) { setErr(e.message); }
  }

  // --- reassignment: preview (no writes) -> confirm -> execute -> undo ---
  async function doPreview() {
    setBusy("preview"); setErr(""); setResult(null);
    try { setPreview(await api.post("/assignment/preview", { waIds: [...sel], toOwner: target })); }
    catch (e) { setErr(e.message); } finally { setBusy(""); }
  }
  async function doExecute() {
    setBusy("execute"); setErr("");
    try {
      const ids = [...sel];
      const r = await api.post("/assignment/execute", { waIds: ids, toOwner: target, confirm: true, expected: ids.length });
      setResult(r); setPreview(null); setSel(new Set()); await load();
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  }
  async function doUndo(batchId) {
    if (!window.confirm(t("إعادة كل محادثات هذه العملية إلى أصحابها السابقين؟"))) return;
    setBusy("undo"); setErr("");
    try { const u = await api.post(`/assignment/undo/${batchId}`, {}); setResult({ ...result, undone: u }); await load(); }
    catch (e) { setErr(e.message); } finally { setBusy(""); }
  }

  const cName = (c) => (lang === "en" ? c.en : c.ar);
  const assignable = (facets?.employees || []).filter((e) => e.assignable);
  const fromLabel = (k) => (k === "__unassigned__" ? t("غير مُسند") : k);

  return (
    <>
      <div className="topbar">
        <h2>{t("العملاء وإسناد المحادثات")}</h2>
        {sel.size > 0 && <span className="badge b-active">{t("محدَّد")}: {sel.size}</span>}
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t("ابحث وفلتر العملاء حسب البلد أو الموظف أو حالة التواصل. البلد مُشتقّ من رمز هاتف العميل.")}
      </p>

      {facets && (
        <div className="kpis">
          {/* the first three are shortcuts: click to filter to that bucket */}
          <button className="kpi" style={{ textAlign: "start", cursor: "pointer" }} onClick={() => setFilter({ owner: "" })}>
            <div className="label">{t("إجمالي العملاء")}</div>
            <div className="val">{facets.counts.total.toLocaleString("en-US")}</div>
          </button>
          <button className="kpi" style={{ textAlign: "start", cursor: "pointer",
            borderColor: f.owner === "__unassigned__" ? "var(--primary)" : undefined }}
            onClick={() => setFilter({ owner: "__unassigned__" })}>
            <div className="label">{t("غير مُسند")} ←</div>
            <div className="val bad">{facets.counts.unassigned.toLocaleString("en-US")}</div>
          </button>
          <button className="kpi" style={{ textAlign: "start", cursor: "pointer",
            borderColor: f.owner === "__bot__" ? "var(--primary)" : undefined }}
            onClick={() => setFilter({ owner: "__bot__" })}>
            <div className="label">{t("مملوك للبوت")} ←</div>
            <div className="val">{facets.counts.bot.toLocaleString("en-US")}</div>
          </button>
          <button className="kpi" style={{ textAlign: "start", cursor: "pointer",
            borderColor: f.chat === "open" ? "var(--primary)" : undefined }}
            onClick={() => setFilter({ chat: "open" })} title={t("الشات المفتوح فقط هو ما يقبل Wati إسناده")}>
            <div className="label">{t("شات مفتوح")} ←</div>
            <div className="val good">{(facets.counts.open_chats ?? 0).toLocaleString("en-US")}</div>
          </button>
          <div className="kpi"><div className="label">{t("نتائج الفلتر")}</div><div className="val">{total.toLocaleString("en-US")}</div></div>
        </div>
      )}

      <div className="filterbar">
        <input placeholder={t("بحث بالاسم أو الرقم…")} value={f.q}
          onChange={(e) => setFilter({ q: e.target.value })} style={{ minWidth: 200 }} />
        <select value={f.owner} onChange={(e) => setFilter({ owner: e.target.value })}>
          <option value="">{t("كل الموظفين")}</option>
          <option value="__unhandled__">{t("غير مُسند أو بوت")}</option>
          <option value="__unassigned__">{t("غير مُسند فقط")}</option>
          <option value="__bot__">{t("البوت فقط")}</option>
          {(facets?.owners || []).map((o) => <option key={o.owner} value={o.owner}>{o.owner} ({o.n})</option>)}
        </select>
        <select value={f.country} onChange={(e) => setFilter({ country: e.target.value })}>
          <option value="">{t("كل البلدان")}</option>
          {(facets?.countries || []).map((c) => (
            <option key={c.iso2} value={c.iso2}>{c.flag} {cName(c)} ({c.n})</option>
          ))}
        </select>
        <select value={f.state} onChange={(e) => setFilter({ state: e.target.value })}>
          <option value="">{t("كل الحالات")}</option>
          <option value="contacted">{t("تم التواصل")}</option>
          <option value="not_contacted">{t("لم يتم التواصل")}</option>
          <option value="bot_only">{t("بوت فقط")}</option>
        </select>
        {/* chat status is its own axis so it can be combined with the above */}
        <select value={f.chat} onChange={(e) => setFilter({ chat: e.target.value })}
          title={t("الشات المفتوح فقط هو ما يقبل Wati إسناده")}>
          <option value="">{t("حالة الشات: الكل")}</option>
          <option value="open">{t("مفتوح (قابل للإسناد)")}</option>
          <option value="closed">{t("مغلق (منتهي)")}</option>
        </select>
        <select value={f.campaign} onChange={(e) => setFilter({ campaign: e.target.value })}>
          <option value="">{t("كل الحملات")}</option>
          {(facets?.campaigns || []).map((c) => (
            <option key={c.id} value={c.id}>{(c.name || c.id).slice(0, 40)} ({c.n})</option>
          ))}
        </select>
        <div className="spacer" />
        {sel.size > 0 && <button className="btn ghost sm" onClick={() => setSel(new Set())}>{t("إلغاء التحديد")}</button>}
        {total > rows.length && (
          <button className="btn ghost sm" onClick={selectAllMatching}>{t("تحديد كل النتائج")} ({total})</button>
        )}
        <a className="btn ghost sm" href={`/api/assignment/export.csv?${qsOf()}&lang=${lang}`}>{t("تصدير CSV")}</a>
      </div>

      {/* where the currently-filtered conversations actually are */}
      {breakdown.length > 0 && (
        <div className="presets" style={{ marginBottom: 14 }}>
          <span className="muted" style={{ alignSelf: "center" }}>{t("حسب الدولة")}:</span>
          {breakdown.map((c) => (
            <button key={c.iso2 || "?"} className={`chip ${f.country === c.iso2 ? "active" : ""}`}
              onClick={() => setFilter({ country: f.country === c.iso2 ? "" : (c.iso2 || "") })}
              disabled={!c.iso2}>
              {c.flag} {cName(c)} <b>{c.n.toLocaleString("en-US")}</b>
            </button>
          ))}
        </div>
      )}

      {/* assign bar — appears once rows are selected */}
      {sel.size > 0 && (
        <div className="filterbar" style={{ borderColor: "var(--primary)", background: "var(--primary-tint)" }}>
          <b>{t("إسناد")} {sel.size} {t("محادثة إلى")}:</b>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t("اختر الموظف")}…</option>
            {assignable.map((e) => (
              <option key={e.owner_name} value={e.owner_name}>{e.full_name || e.owner_name}</option>
            ))}
          </select>
          <button className="btn" disabled={!target || busy === "preview"} onClick={doPreview}>
            {busy === "preview" ? t("جارٍ التحميل…") : t("معاينة ثم إسناد")}
          </button>
          {(facets?.employees || []).some((e) => !e.assignable) && (
            <span className="muted">
              {t("موظفون بلا إيميل Wati لا يظهرون هنا")}
            </span>
          )}
        </div>
      )}

      {/* outcome of the last run, with undo */}
      {result && (
        <div className={`note ${result.failed ? "bad" : "ok"}`}>
          <b>{t("تم الإسناد")}:</b> {result.sent} {t("نجحت")} · {result.failed} {t("فشلت")} · {result.skipped} {t("تخطّي")}
          {!result.undone && result.sent > 0 && (
            <button className="btn ghost sm" style={{ marginInlineStart: 12 }}
              disabled={busy === "undo"} onClick={() => doUndo(result.batchId)}>{t("تراجع")}</button>
          )}
          {result.undone && <span> — {t("تمّ التراجع")}: {result.undone.restored} {t("أُعيدت")}
            {result.undone.not_undoable?.length ? `، ${result.undone.not_undoable.length} ${t("تعذّر إرجاعها (كانت غير مُسندة)")}` : ""}</span>}
        </div>
      )}

      {err && <p className="err">{err}</p>}
      {loading && !data && <p>{t("جارٍ التحميل…")}</p>}

      {/* mandatory confirmation: shows exactly what will change */}
      {preview && (
        <div className="modal-bg" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t("تأكيد الإسناد")}</h3>
            <p className="muted" style={{ marginBottom: 12 }}>
              {t("سيتم نقل المحادثات التالية في Wati إلى")} <b>{preview.toOwner}</b> <span dir="ltr">({preview.toEmail})</span>
            </p>
            <div className="kpis" style={{ marginBottom: 12 }}>
              <div className="kpi"><div className="label">{t("سيتم نقلها")}</div><div className="val good">{preview.will_move}</div></div>
              <div className="kpi"><div className="label">{t("نافذة منتهية")}</div><div className="val bad">{preview.expired ?? 0}</div></div>
              <div className="kpi"><div className="label">{t("مملوكة له أصلاً")}</div><div className="val">{preview.already_owned}</div></div>
            </div>
            {preview.expired > 0 && (
              <p className="note bad" style={{ fontSize: 12 }}>
                <b>{preview.expired}</b> {t("محادثة تجاوزت نافذة الـ24 ساعة — يرفض Wati إسنادها وسيتم تخطّيها. تُسنَد فقط بعد أن يراسلك العميل من جديد.")}
              </p>
            )}
            {Object.keys(preview.from_counts || {}).length > 0 && (
              <div className="d-block">
                <h4>{t("من")}</h4>
                {Object.entries(preview.from_counts).map(([k, n]) => (
                  <div className="d-row" key={k}><span>{fromLabel(k)}</span><span>{n}</span></div>
                ))}
              </div>
            )}
            {preview.unlinked_channel > 0 && (
              <p className="note bad" style={{ fontSize: 12 }}>
                {preview.unlinked_channel} {t("منها على رقم واتساب غير مرتبط — قد يفشل إسنادها.")}
              </p>
            )}
            {preview.missing?.length > 0 && (
              <p className="muted">{preview.missing.length} {t("معرّفاً غير موجود وسيُتجاهل.")}</p>
            )}
            {preview.will_move === 0
              ? <p className="note">{t("لا شيء لنقله — الجميع مملوك لهذا الموظف أصلاً.")}</p>
              : <p className="muted" style={{ fontSize: 12 }}>{t("هذا إجراء يكتب في Wati مباشرة. يمكن التراجع عنه بعد التنفيذ.")}</p>}
            <div className="row-actions" style={{ justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setPreview(null)}>{t("إلغاء")}</button>
              <button className="btn" disabled={busy === "execute" || preview.will_move === 0} onClick={doExecute}>
                {busy === "execute" ? t("جارٍ التنفيذ…") : `${t("تأكيد ونقل")} ${preview.will_move}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {data && (
        <div className="section" style={{ padding: 0, overflow: "hidden" }}>
          <div className="scroll" style={{ maxHeight: "62vh", border: 0, borderRadius: 0 }}>
            <table>
              <thead><tr>
                <th style={{ width: 36, cursor: "default" }}>
                  <input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label={t("تحديد الصفحة")} />
                </th>
                <th>{t("العميل")}</th><th>{t("الهاتف")}</th><th>{t("الدولة")}</th>
                <th>{t("الموظف الحالي")}</th><th>{t("الحالة")}</th><th>{t("نافذة واتساب")}</th>
                <th>{t("الرسائل")}</th><th>{t("آخر نشاط")}</th><th>{t("الحملة")}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.wa_id} style={sel.has(r.wa_id) ? { background: "var(--primary-tint)" } : undefined}>
                    <td><input type="checkbox" checked={sel.has(r.wa_id)} onChange={() => toggle(r.wa_id)}
                      aria-label={r.full_name || r.wa_id} /></td>
                    <td className="nm">{r.full_name || "—"}</td>
                    <td><span dir="ltr">{r.phone || r.wa_id}</span></td>
                    <td>{r.flag} {r.country_iso2 || "—"}</td>
                    <td>{r.contact_owner
                      ? r.contact_owner
                      : <span className="badge b-issue">{t("غير مُسند")}</span>}</td>
                    <td>{r.msg_unavailable === 1
                      ? <span className="badge b-unknown">{t("رقم غير مرتبط")}</span>
                      : r.contacted
                        ? <span className="badge b-active">{t("تم التواصل")}</span>
                        : <span className="badge b-issue">{t("لم يتم التواصل")}</span>}</td>
                    <td>{r.window_open
                      ? <span className="badge b-active">{t("مفتوح")}</span>
                      : <span className="badge b-cold" title={t("لا يقبل Wati إسناد تذكرة منتهية")}>{t("مغلق")}</span>}</td>
                    <td>{r.num_messages ?? 0}</td>
                    <td><span dir="ltr">{fmtDate(r.last_message_at)}</span></td>
                    <td className="muted">{(r.campaign_name || "—").slice(0, 28)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={10} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    {t("لا نتائج مطابقة للفلتر.")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
            <button className="btn ghost sm" disabled={offset === 0}
              onClick={() => { setOffset(Math.max(0, offset - PAGE)); }}>{t("السابق")}</button>
            <span className="muted">
              {total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE, total)}`} / {total.toLocaleString("en-US")}
            </span>
            <button className="btn ghost sm" disabled={offset + PAGE >= total}
              onClick={() => { setOffset(offset + PAGE); }}>{t("التالي")}</button>
            {loading && <span className="muted">{t("جارٍ التحميل…")}</span>}
          </div>
        </div>
      )}
    </>
  );
}
