// Management review of AI compliance findings — the counterpart to the wall
// board. Everything the screen deliberately withholds lives here: the exact
// employee quote, the surrounding conversation, and the confirm/reject decision.
//
// The queue is ordered by severity, because a pending CRITICAL finding is what
// caps someone's score once confirmed, so it is the one a supervisor must see
// first. Nothing is decided automatically.
import { useEffect, useState, useCallback } from "react";
import api from "../api.js";
import { useI18n } from "../i18n.jsx";
import { fmt0 } from "../components/useFetch.js";

const SEV_CLS = {
  critical: "b-issue", major: "b-issue", moderate: "b-warm", minor: "b-cold", informational: "b-cold",
};
const SEV_AR = {
  critical: "حرجة", major: "كبيرة", moderate: "متوسطة", minor: "صغيرة", informational: "للعلم",
};

function Bubble({ m, t }) {
  const who = m.dir === "in" ? t("العميل")
    : /^bot$/i.test(String(m.sender || "")) ? t("رد آلي (بوت)") : (m.sender || t("الموظف"));
  return (
    <div className={`bubble ${m.dir === "in" ? "in" : "out"} ${m.flagged ? "flagged" : ""}`}>
      <div className="who">{who}{m.flagged ? ` · ${t("الرسالة المرصودة")}` : ""}</div>
      <div>{m.body}</div>
      {m.ts && <div className="tm">{new Date(m.ts).toLocaleString("en-GB")}</div>}
    </div>
  );
}

/**
 * Calibration: the eligibility bars, with a dry-run before committing.
 *
 * Preview matters more than the form does — moving "minimum compliance" from 90
 * to 85 is meaningless until you can see WHO becomes eligible, so nothing is
 * saved until the owner has looked at that list.
 */
const FIELDS = [
  ["minSample", "أدنى عدد محادثات مُقيَّمة للترشّح"],
  ["minCompliance", "أدنى درجة التزام"],
  ["minPersuasion", "أدنى درجة إقناع"],
  ["slaMinutes", "هدف زمن أول رد (دقيقة)"],
  ["criticalScoreCap", "سقف الدرجة عند مخالفة حرجة مؤكَّدة"],
];

function Calibration({ t, onSaved }) {
  const [cal, setCal] = useState(null);
  const [draft, setDraft] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/quality/calibration")
      .then((d) => { setCal(d); setDraft({ ...d.thresholds }); })
      .catch((e) => setErr(e.message));
  }, []);

  async function runPreview() {
    setBusy(true); setErr("");
    try { setPreview(await api.post("/quality/calibration/preview", { thresholds: draft, days: 30 })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setErr("");
    try {
      const saved = await api.post("/quality/calibration", { weights: cal.weights, thresholds: draft });
      setCal({ ...cal, ...saved, stored: true }); setPreview(null); onSaved?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // Thresholds are what this whole panel edits — without them there is nothing
  // to show, and reading through them threw and took the page down with it.
  if (!cal?.thresholds) return null;
  const dirty = FIELDS.some(([k]) => Number(draft[k]) !== Number(cal.thresholds[k]));

  return (
    <div className="section">
      <h3>{t("معايرة حدود الترشّح")}</h3>
      <p className="muted" style={{ marginBottom: 10 }}>
        {cal.stored ? t("هذه القيم محفوظة وتُطبَّق على اللوحة.") : t("القيم الافتراضية — لم تُحفظ معايرة بعد.")}
        {" "}{t("عاين قبل الحفظ لترى مَن يصبح مؤهّلاً.")}
      </p>
      <div className="fb" style={{ flexWrap: "wrap" }}>
        {FIELDS.map(([k, label]) => (
          <label key={k} style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 3 }}>
            <span className="muted">{t(label)}</span>
            <input type="number" style={{ width: 120 }} value={draft[k] ?? ""}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            <span className="muted" style={{ fontSize: 10.5 }}>{t("الافتراضي")}: {cal.defaults.thresholds[k]}</span>
          </label>
        ))}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <button className="btn ghost" disabled={busy} onClick={runPreview}>{t("معاينة الأثر")}</button>
          <button className="btn" disabled={busy || !dirty} onClick={save}>{t("حفظ المعايرة")}</button>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      {preview && (
        <div style={{ marginTop: 12 }}>
          <p>
            <b>{t("المؤهّلون")}:</b>{" "}
            {preview.eligible.length ? preview.eligible.join(" · ") : <span className="muted">{t("لا أحد")}</span>}
            {" — "}<b>{t("الأفضل")}:</b>{" "}
            {preview.top_performer || <span className="muted">{t("لا أحد")}</span>}
          </p>
          <div className="scroll" style={{ maxHeight: 220 }}>
            <table>
              <thead><tr><th>{t("الموظف")}</th><th>{t("الكلية")}</th><th>{t("الإقناع")}</th>
                <th>{t("الالتزام")}</th><th>{t("العيّنة")}</th><th>{t("مؤهّل")}</th></tr></thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.name}>
                    <td className="nm">{r.name}</td><td>{r.overall ?? "—"}</td><td>{r.persuasion ?? "—"}</td>
                    <td>{r.compliance ?? "—"}</td><td>{r.sample_size}</td>
                    <td>{r.eligible ? "✓" : <span className="muted">{(r.reasons || []).join(", ")}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The wall-display link for this board.
 *
 * The code is read from the salesboard token endpoint rather than hardcoded:
 * both screens share one kiosk code, so if the owner renames it here the link
 * follows, and a link typed from memory cannot go stale.
 *
 * `days` is part of the link because the TV has no controls — whatever window is
 * chosen when the link is made is the window the screen shows forever.
 */
function ScreenLink({ t }) {
  const [code, setCode] = useState(null);
  const [days, setDays] = useState(30);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get("/salesboard/token").then((r) => setCode(r.code || r.token || null)).catch(() => {});
  }, []);

  // /tv/<code>/quality is the short stable form; ?days= only when it differs
  // from the screen's own default, so the common link stays short.
  const path = code ? `/tv/${encodeURIComponent(code)}/quality${days === 7 ? "" : `?days=${days}`}` : "";
  const url = path ? `${window.location.origin}${path}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* a blocked clipboard is not worth an error banner — the field is selectable */ }
  }

  return (
    <div className="section" style={{ marginBottom: 14 }}>
      <h3>{t("شاشة العرض على تلفاز الفريق")}</h3>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        {t("تعرض هذه اللوحة نفسها على الشاشة الكبيرة: تعمل دون تسجيل دخول، ولا تعرض اسم عميل ولا رقم هاتف. الفترة جزء من الرابط لأن الشاشة بلا أزرار.")}
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>{t("آخر 7 أيام")}</option>
          <option value={30}>{t("آخر 30 يوماً")}</option>
          <option value={90}>{t("آخر 90 يوماً")}</option>
        </select>
        <input readOnly value={url} placeholder={t("جارٍ التحميل…")}
          style={{ flex: 1, minWidth: 300, direction: "ltr", fontWeight: 700 }}
          onFocus={(e) => e.target.select()} />
        <button className="btn" onClick={copy} disabled={!url}>{copied ? t("تم النسخ ✓") : t("نسخ")}</button>
        <a className={`btn primary ${url ? "" : "disabled"}`} href={path || "#"}
          target="_blank" rel="noreferrer">{t("فتح الشاشة")}</a>
      </div>
      {!code && (
        <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          {t("يُنشَأ رمز الكشك تلقائياً عند أول فتح لصفحة لوحة المبيعات، ويمكن تغييره من هناك.")}
        </p>
      )}
    </div>
  );
}

/**
 * Point the evaluator at a specific period.
 *
 * The nightly job only ever looks at the trailing window, which is right for
 * routine scoring but useless when the question is "what did we sound like last
 * March". Two dates answer that. It shows what is still unscored BEFORE running,
 * because the run costs AI budget and takes ~20s per conversation — the owner
 * should see the size of the job first.
 */
function PeriodScan({ t }) {
  const [range, setRange] = useState({ since: "", until: "" });
  const [status, setStatus] = useState(null);
  const [started, setStarted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (range.since) qs.set("since", range.since);
    if (range.until) qs.set("until", range.until);
    if (!range.since) qs.set("days", "30");
    try { setStatus(await api.get(`/salesboard/quality/status?${qs}`)); setErr(""); }
    catch (e) { setErr(e.message); }
  }, [range.since, range.until]);

  useEffect(() => { load(); }, [load]);
  // While a run is in flight the pending count is the only progress signal there is.
  useEffect(() => {
    if (!status?.running) return undefined;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [status?.running, load]);

  async function run() {
    setBusy(true); setErr("");
    try {
      setStarted(await api.post("/salesboard/quality/backfill", {
        since: range.since || null, until: range.until || null, days: 30, limit: 2000,
      }));
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const win = status?.window;
  const pending = status?.pending ?? null;
  // ~23s per conversation and ~$0.0037, measured over the 921-conversation backfill.
  const mins = pending ? Math.round((pending * 23) / 60) : 0;
  const cost = pending ? (pending * 0.0037).toFixed(2) : "0.00";

  return (
    <div className="section">
      <h3>{t("فحص فترة محدّدة بالذكاء الاصطناعي")}</h3>
      <p className="muted" style={{ marginBottom: 10 }}>
        {t("اتركها فارغة لفحص آخر 30 يوماً، أو حدّد تاريخين لفحص فترة بعينها. لا يُعاد تقييم محادثة مُقيَّمة بنفس نسخة السياسة، فالتشغيل مرّتين لا يكلّف مرّتين.")}
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
          {status?.running ? t("الفحص قيد التشغيل…") : t("ابدأ الفحص")}
        </button>
      </div>

      {err && <p className="err">{err}</p>}

      {status && (
        <>
          <div className="id-detail"><span>{t("الفترة المفحوصة")}</span>
            <b dir="ltr">{win ? `${win.since} → ${win.until}` : "—"}</b></div>
          <div className="id-detail"><span>{t("محادثات بلا تقييم في هذه الفترة")}</span><b>{fmt0(pending)}</b></div>
          <div className="id-detail"><span>{t("الزمن والتكلفة المتوقّعة")}</span>
            <b>{pending ? `~${mins} ${t("دقيقة")} · ~$${cost}` : t("لا شيء متبقٍّ — الفترة مُقيَّمة بالكامل")}</b></div>
          <div className="id-detail"><span>{t("ميزانية الذكاء الاصطناعي المتبقية اليوم")}</span>
            <b>{status.budget_remaining_usd == null ? t("بلا حد") : `$${Number(status.budget_remaining_usd).toFixed(2)}`}</b></div>
          <div className="id-detail"><span>{t("نسخة السياسة")}</span><b dir="ltr">{status.policy_version}</b></div>
        </>
      )}

      {started && (
        <p className="muted" style={{ marginTop: 8 }}>
          {t("بدأ الفحص في الخلفية")} — <b dir="ltr">{started.window?.since} → {started.window?.until}</b>.{" "}
          {t("يمكن إغلاق الصفحة؛ يتوقّف تلقائياً عند نفاد ميزانية اليوم ويكمل عند التشغيل التالي.")}
        </p>
      )}
    </div>
  );
}

export default function QualityReview() {
  const { t, lang } = useI18n();
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState({ status: "pending", severity: "", type: "", days: 30 });
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);       // the issue being reviewed
  const [ctx, setCtx] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [training, setTraining] = useState(null);

  const loadSummary = useCallback(() => {
    api.get(`/quality/summary?days=${filters.days}`).then(setSummary).catch((e) => setMsg(e.message));
  }, [filters.days]);

  const loadList = useCallback(() => {
    const qs = new URLSearchParams({ status: filters.status, days: String(filters.days) });
    if (filters.severity) qs.set("severity", filters.severity);
    if (filters.type) qs.set("type", filters.type);
    api.get(`/quality/issues?${qs}`).then(setList).catch((e) => setMsg(e.message));
  }, [filters]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    api.get(`/quality/training?days=${filters.days}`).then(setTraining).catch(() => {});
  }, [filters.days]);

  async function openIssue(row) {
    setOpen(row); setCtx(null); setNote(row.reviewer_note || "");
    try { setCtx(await api.get(`/quality/issues/${row.id}/context`)); }
    catch (e) { setMsg(e.message); }
  }

  async function decide(action, severity) {
    if (!open) return;
    setBusy(true); setMsg("");
    try {
      await api.post(`/quality/issues/${open.id}/review`, { action, severity, note });
      setOpen(null); setCtx(null); setNote("");
      loadList(); loadSummary();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  const sevLabel = (s) => (lang === "en" ? s : (SEV_AR[s] || s));

  return (
    <>
      <div className="topbar"><h2>{t("مراجعة جودة والتزام المحادثات")}</h2></div>

      <p className="muted" style={{ marginBottom: 12 }}>
        {t("الذكاء الاصطناعي يرصد، والمشرف يقرّر. المخالفة المرفوضة لا تخصم شيئاً، والحرجة لا تُقيّد الدرجة إلا بعد تأكيدها.")}
      </p>

      <ScreenLink t={t} />

      {summary && (
        <div className="kpis" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="label">{t("قيد المراجعة")}</div><div className="val">{fmt0(summary.pending)}</div></div>
          <div className="kpi"><div className="label">{t("حرجة قيد المراجعة")}</div>
            <div className="val" style={{ color: summary.critical_pending ? "var(--danger)" : undefined }}>{fmt0(summary.critical_pending)}</div></div>
          <div className="kpi"><div className="label">{t("مؤكَّدة")}</div><div className="val">{fmt0(summary.confirmed)}</div></div>
          <div className="kpi"><div className="label">{t("مرفوضة")}</div><div className="val">{fmt0(summary.rejected)}</div></div>
        </div>
      )}

      {summary?.company && (
        <div className="section">
          <h3>{t("حقائق الترخيص المعتمدة")}</h3>
          <p className="muted" style={{ marginBottom: 10 }}>
            {t("هذه الحقائق هي مرجع الذكاء الاصطناعي عند تقييم أي ادّعاء تنظيمي — أي جهة أخرى تُذكر تُرصد كمخالفة.")}
          </p>
          <div className="id-detail"><span>{t("الكيان القانوني")}</span><b>{summary.company.legal_entity}</b></div>
          <div className="id-detail"><span>{t("الجهة المنظِّمة")}</span><b>{summary.company.regulator}</b></div>
          <div className="id-detail"><span>{t("رقم الترخيص")}</span><b dir="ltr">{summary.company.licence_number}</b></div>
          <div className="id-detail"><span>{t("دول غير مخدومة")}</span><b>{(summary.company.restricted_countries || []).join(", ")}</b></div>
        </div>
      )}

      <div className="fb" style={{ marginBottom: 14 }}>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="pending">{t("قيد المراجعة")}</option>
          <option value="confirmed">{t("مؤكَّدة")}</option>
          <option value="rejected">{t("مرفوضة")}</option>
          <option value="all">{t("الكل")}</option>
        </select>
        <select value={filters.severity} onChange={(e) => setFilters({ ...filters, severity: e.target.value })}>
          <option value="">{t("كل الخطورات")}</option>
          {(summary?.severities || []).map((s) => <option key={s} value={s}>{sevLabel(s)}</option>)}
        </select>
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
          <option value="">{t("كل الأنواع")}</option>
          {(summary?.types || []).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <select value={filters.days} onChange={(e) => setFilters({ ...filters, days: Number(e.target.value) })}>
          <option value={7}>{t("آخر 7 أيام")}</option>
          <option value={30}>{t("آخر 30 يوماً")}</option>
          <option value={90}>{t("آخر 90 يوماً")}</option>
        </select>
      </div>

      {msg && <p className="err">{msg}</p>}

      <div className="section">
        <h3>{t("قائمة المخالفات")} {list ? <span className="muted">· {fmt0(list.total)}</span> : null}</h3>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>{t("الخطورة")}</th><th>{t("النوع")}</th><th>{t("الموظف")}</th>
                <th>{t("العميل")}</th><th>{t("ثقة AI")}</th><th>{t("الأثر")}</th>
                <th>{t("الحالة")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {/* `list?.rows` and not `list.rows`: an error-shaped payload has no
                  rows array, and reading .length off it threw during render and
                  took the whole page down instead of showing an empty table. */}
              {list && (list.rows?.length ?? 0) === 0 && <tr><td colSpan={8} className="muted">{t("لا مخالفات مطابقة")}</td></tr>}
              {(list?.rows || []).map((r) => (
                <tr key={r.id}>
                  <td><span className={`badge ${SEV_CLS[r.severity] || ""}`}>{sevLabel(r.severity)}</span></td>
                  <td className="nm">{r.type_label}</td>
                  <td>{r.owner_label}</td>
                  <td>{r.customer || "—"}</td>
                  <td>{(r.confidence * 100).toFixed(0)}%</td>
                  <td>
                    {r.scoring === "not_scored" ? <span className="muted">{t("لا يخصم (ثقة منخفضة)")}</span>
                      : r.scoring === "dismissed" ? <span className="muted">{t("مُلغاة")}</span>
                      : <span>{t("يخصم")}</span>}
                  </td>
                  <td>{r.review_status === "pending" ? t("قيد المراجعة")
                    : r.review_status === "confirmed" ? t("مؤكَّدة") : t("مرفوضة")}
                    {r.reviewed_by && <div className="muted" style={{ fontSize: 11 }}>{r.reviewed_by}</div>}</td>
                  <td><button className="btn ghost sm" onClick={() => openIssue(r)}>{t("مراجعة")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PeriodScan t={t} />

      <Calibration t={t} onSaved={() => { loadSummary(); loadList(); }} />

      {training && training.length > 0 && (
        <div className="section">
          <h3>{t("ما يجب تدريبه — الأنماط المتكرّرة")}</h3>
          <p className="muted" style={{ marginBottom: 10 }}>{t("المخالفات المرفوضة مستثناة، فلا يُبنى تدريب على ما رفضه المشرف.")}</p>
          <div className="grid2">
            {training.map((e) => (
              <div key={e.owner} className="d-block">
                <h4>{e.owner_label} <span className="muted">· {fmt0(e.total)}</span></h4>
                <ul style={{ paddingInlineStart: 18, margin: 0 }}>
                  {e.patterns.map((p) => (
                    <li key={p.type} style={{ marginBottom: 4 }}>
                      {p.type_label} — <b>{p.count}</b>
                      {p.confirmed ? <span className="muted"> ({fmt0(p.confirmed)} {t("مؤكَّدة")})</span> : null}
                      {p.example && <div className="muted" style={{ fontSize: 12 }}>{t("البديل المقترح")}: {p.example}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {open && (
        <div className="modal-bg" onClick={() => setOpen(null)}>
          <div className="modal" style={{ width: 760 }} onClick={(e) => e.stopPropagation()}>
            <h3>{open.type_label} <span className={`badge ${SEV_CLS[open.severity] || ""}`}>{sevLabel(open.severity)}</span></h3>

            {/* Who the customer actually was. A supervisor deciding whether to
                hold someone to a critical finding should not have to leave the
                popup to find the number, the campaign that produced the lead, or
                how the conversation was read. */}
            <div className="tg-facts">
              <div><span>{t("الموظف")}</span><b>{open.owner_label}</b></div>
              <div><span>{t("العميل")}</span><b>{ctx?.customer || <span className="muted">—</span>}</b></div>
              <div><span>{t("الهاتف")}</span><b dir="ltr">{ctx?.phone || "—"}</b></div>
              <div><span>{t("الدولة")}</span>
                <b>{ctx?.contact?.country ? `${ctx.contact.country.flag} ${lang === "en" ? ctx.contact.country.en : ctx.contact.country.ar}` : "—"}</b></div>
              <div><span>{t("ثقة AI")}</span><b>{(open.confidence * 100).toFixed(0)}%</b></div>
              <div><span>{t("المرحلة")}</span><b>{ctx?.contact?.stage || "—"}</b></div>
              <div><span>{t("الرسائل")}</span>
                <b>{ctx?.contact ? `${fmt0(ctx.contact.messages)} · ${t("عميل")} ${fmt0(ctx.contact.customer_msgs)} · ${t("موظف")} ${fmt0(ctx.contact.agent_msgs)}` : "—"}</b></div>
              <div><span>{t("زمن أول رد")}</span>
                <b>{ctx?.contact?.first_human_response_min == null ? "—" : `${ctx.contact.first_human_response_min} ${t("دقيقة")}`}</b></div>
              <div><span>{t("وصل العميل يوم")}</span>
                <b dir="ltr">{ctx?.contact?.created_date ? String(ctx.contact.created_date).slice(0, 10) : "—"}</b></div>
              <div><span>{t("آخر نشاط")}</span>
                <b dir="ltr">{ctx?.contact?.last_message_at ? String(ctx.contact.last_message_at).replace("T", " ").slice(0, 16) : "—"}</b></div>
              <div><span>{t("قراءة الذكاء الاصطناعي")}</span>
                <b>{ctx?.contact?.lead_intent || "—"}
                  {ctx?.contact?.conv_score != null ? ` · ${ctx.contact.conv_score}/100` : ""}
                  {ctx?.contact?.qualification_score != null ? ` · ${t("تأهيل")} ${ctx.contact.qualification_score}` : ""}</b></div>
              <div><span>{t("ردّ بعد الموظف")}</span>
                <b>{ctx?.contact ? (ctx.contact.replied_after_agent ? t("نعم") : t("لا — اختفى")) : "—"}</b></div>
            </div>

            {ctx?.contact?.campaign && (
              <div className="id-detail"><span>{t("الحملة / الإعلان")}</span>
                <b>{ctx.contact.campaign}{ctx.contact.ad ? ` — ${ctx.contact.ad}` : ""}</b></div>
            )}
            {ctx?.contact?.lead_status && (
              <div className="id-detail"><span>{t("حالة العميل كما قرأها الذكاء الاصطناعي")}</span>
                <b>{ctx.contact.lead_status}</b></div>
            )}

            <div className="d-block">
              <h4>{t("الدليل — اقتباس حرفي من رسالة الموظف")}</h4>
              <div className="smart-reply" style={{ background: "var(--danger-tint)", color: "var(--danger)" }}>{open.evidence}</div>
            </div>
            {open.context_explanation && (
              <div className="d-block"><h4>{t("سبب التصنيف")}</h4><div style={{ fontSize: 13 }}>{open.context_explanation}</div></div>
            )}
            {open.recommended_alternative && (
              <div className="d-block"><h4>{t("الصياغة البديلة المتوافقة")}</h4>
                <div className="smart-reply">{open.recommended_alternative}</div></div>
            )}

            <div className="d-block">
              <h4>{t("سياق المحادثة")}</h4>
              {!ctx && <p className="muted">{t("جارٍ التحميل…")}</p>}
              {ctx && !ctx.evidence_found && (
                <p className="muted">{t("لم يُعثَر على الاقتباس في النص المحفوظ — تُعرض آخر الرسائل.")}</p>
              )}
              {ctx && (
                <div className="thread" style={{ maxHeight: 240, overflow: "auto" }}>
                  {ctx.messages.map((m) => <Bubble key={m.i} m={m} t={t} />)}
                </div>
              )}
            </div>

            <div className="field">
              <label>{t("ملاحظة المشرف (تُحفَظ مع القرار)")}</label>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} style={{ width: "100%" }} />
            </div>

            <div className="row-actions">
              <button className="btn" disabled={busy} onClick={() => decide("confirm")}>{t("تأكيد المخالفة")}</button>
              <button className="btn ghost" disabled={busy} onClick={() => decide("reject")}>{t("رفض — ليست مخالفة")}</button>
              <select disabled={busy} defaultValue="" onChange={(e) => e.target.value && decide("severity", e.target.value)}>
                <option value="">{t("تغيير الخطورة…")}</option>
                {(summary?.severities || []).map((s) => <option key={s} value={s}>{sevLabel(s)}</option>)}
              </select>
              <button className="btn ghost" disabled={busy} onClick={() => setOpen(null)}>{t("إغلاق")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
