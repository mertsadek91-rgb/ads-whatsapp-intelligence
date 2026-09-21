// Per-employee full performance report: analyzed-conversation KPIs and
// details for a chosen period, aggregated problems/strengths, and AI-generated
// coaching notes (in the current UI language).
import { useEffect, useState } from "react";
import { useFetch, fmt0, fmt2 } from "../components/useFetch.js";
import DataTable from "../components/DataTable.jsx";
import { PRESETS } from "../components/DateRangeContext.jsx";
import { useI18n } from "../i18n.jsx";
import api from "../api.js";

const INTENT = { hot: "ساخن", warm: "دافئ", cold: "بارد" };

function Kpi({ label, val, color }) {
  return <div className="kpi"><div className="label">{label}</div><div className="val" style={color ? { color } : null}>{val}</div></div>;
}

export default function Employees() {
  const { t, lang } = useI18n();
  const employees = useFetch("/report/employees");
  const [agent, setAgent] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [preset, setPreset] = useState("all");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState(null);
  const [genBusy, setGenBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(null); // conversation detail modal
  const [coaching, setCoaching] = useState(null);
  const [scripts, setScripts] = useState({}); // pattern_key -> generated script payload
  const [scriptBusy, setScriptBusy] = useState({}); // pattern_key -> bool
  const [patModal, setPatModal] = useState(null); // { title, customers } for the affected-customers list

  useEffect(() => {
    if (!agent) { setReport(null); setNotes(null); setCoaching(null); setScripts({}); return; }
    setLoading(true); setErr("");
    const p = new URLSearchParams();
    if (since) p.set("since", since);
    if (until) p.set("until", until);
    api.get(`/report/employee/${encodeURIComponent(agent)}?${p}`)
      .then(setReport).catch((e) => setErr(e.message)).finally(() => setLoading(false));
    api.get(`/report/employee/${encodeURIComponent(agent)}/notes?lang=${lang}`)
      .then((n) => setNotes(n.generated ? n : null)).catch(() => setNotes(null));
    api.get(`/report/employee/${encodeURIComponent(agent)}/coaching?${p}`)
      .then((c) => { setCoaching(c); setScripts({}); })
      .catch(() => setCoaching(null));
  }, [agent, since, until, lang]);

  // Once the detected patterns are known, check for already-cached scripts
  // (avoids a blind AI call for a pattern someone already generated before).
  useEffect(() => {
    if (!coaching) return;
    const keys = [...new Set([...coaching.opening_patterns, ...coaching.dropout_patterns].map((g) => g.pattern_key))];
    keys.forEach((k) => {
      api.get(`/report/employee/${encodeURIComponent(agent)}/coaching-script?pattern_key=${k}&lang=${lang}`)
        .then((s) => { if (s.generated) setScripts((prev) => ({ ...prev, [k]: s })); })
        .catch(() => {});
    });
  }, [coaching, agent, lang]);

  async function generateNotes() {
    setGenBusy(true); setErr("");
    try {
      const n = await api.post(`/report/employee/${encodeURIComponent(agent)}/notes`, { since, until, lang });
      setNotes(n);
    } catch (e) { setErr(e.message); }
    setGenBusy(false);
  }

  async function generateScript(patternKey) {
    setScriptBusy((prev) => ({ ...prev, [patternKey]: true })); setErr("");
    try {
      const s = await api.post(`/report/employee/${encodeURIComponent(agent)}/coaching-script`, { since, until, pattern_key: patternKey, lang });
      setScripts((prev) => ({ ...prev, [patternKey]: s }));
    } catch (e) { setErr(e.message); }
    setScriptBusy((prev) => ({ ...prev, [patternKey]: false }));
  }

  // The coaching endpoint's customer entries only carry a subset of fields —
  // resolve the full record from report.conversations so ConvModal (which
  // expects conv_score/summary/etc.) gets everything it needs.
  function openCoachingCustomer(c) {
    const full = report?.conversations?.find((x) => x.wa_id === c.wa_id);
    setPatModal(null);
    setSel(full || c);
  }

  const k = report?.kpis;
  const scoreColor = (v) => (v >= 60 ? "var(--green)" : v >= 40 ? "var(--orange)" : "var(--red)");

  const cols = [
    { key: "full_name", label: t("العميل"), render: (r) => r.full_name || r.phone },
    { key: "date", label: t("التاريخ"), render: (r) => (r.date ? new Date(r.date).toLocaleDateString("en-GB") : "—") },
    { key: "agent_score", label: t("درجة الأداء"), num: true, render: (r) => <b style={{ color: scoreColor(r.agent_score) }}>{r.agent_score ?? "—"}</b> },
    { key: "conv_score", label: t("جودة المحادثة"), num: true, render: (r) => r.conv_score ?? "—" },
    { key: "lead_intent", label: t("النيّة"), render: (r) => INTENT[r.lead_intent] ? t(INTENT[r.lead_intent]) : (r.lead_intent || "—") },
    { key: "lead_status", label: t("النتيجة"), render: (r) => r.lead_status || "—" },
    { key: "wrong_persuasion", label: t("إقناع خاطئ"), render: (r) => (r.wrong_persuasion ? <span className="tag warn">{t("نعم ⚠")}</span> : <span className="tag good">{t("لا")}</span>) },
    { key: "follow_up_min", label: t("متابعة (د)"), num: true, render: (r) => (r.follow_up_min != null ? fmt2(r.follow_up_min) : "—") },
    { key: "wa_id", label: "", filter: false, render: (r) => <button className="btn ghost" onClick={() => setSel(r)}>{t("عرض")}</button> },
  ];

  return (
    <>
      <div className="topbar">
        <h2>{t("تقارير الموظفين — الأداء التفصيلي")}</h2>
        {agent && report?.kpis?.conversations > 0 && (
          <div style={{ display: "flex", gap: 8 }}>
            <a className="btn ghost" href={`/api/report/employee/${encodeURIComponent(agent)}/export.csv?${new URLSearchParams({ ...(since && { since }), ...(until && { until }), lang })}`}>
              {t("تصدير CSV")}
            </a>
            <a className="btn orange" href={`/api/report/employee/${encodeURIComponent(agent)}/pdf?${new URLSearchParams({ ...(since && { since }), ...(until && { until }), lang })}`}>
              {t("تصدير PDF")}
            </a>
          </div>
        )}
      </div>

      <div className="filterbar">
        <select value={agent} onChange={(e) => setAgent(e.target.value)} style={{ minWidth: 220 }}>
          <option value="">{t("اختر الموظف")}</option>
          {(employees.data || []).map((e) => (
            <option key={e.agent} value={e.agent}>{e.agent_label || e.agent} ({e.conversations})</option>
          ))}
        </select>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.key} className={`chip ${preset === p.key ? "active" : ""}`}
              onClick={() => { const r = p.range(); setSince(r.since); setUntil(r.until); setPreset(p.key); }}>
              {t(p.label)}
            </button>
          ))}
        </div>
        <div className="daterange">
          <label>{t("من")}</label>
          <input type="date" value={since} onChange={(e) => { setSince(e.target.value); setPreset("custom"); }} />
          <label>{t("إلى")}</label>
          <input type="date" value={until} onChange={(e) => { setUntil(e.target.value); setPreset("custom"); }} />
        </div>
      </div>

      {err && <p className="err">{err}</p>}
      {!agent && <div className="note">{t("اختر موظفاً لعرض تقريره الكامل خلال الفترة المحدّدة.")}</div>}
      {loading && <p>{t("جارٍ التحميل…")}</p>}

      {report && !loading && (
        report.kpis.conversations === 0 ? (
          <div className="note">{t("لا توجد محادثات محلّلة لهذا الموظف في الفترة المحدّدة.")}</div>
        ) : (
          <>
            <div className="kpis">
              <Kpi label={t("عدد المحادثات المحلّلة")} val={fmt0(k.conversations)} />
              <Kpi label={t("متوسط أداء الموظف")} val={fmt2(k.avg_agent_score)} color={scoreColor(k.avg_agent_score)} />
              <Kpi label={t("متوسط جودة المحادثة")} val={fmt2(k.avg_conv_score)} />
              <Kpi label={t("متوسط زمن المتابعة (د)")} val={k.avg_follow_up_min != null ? fmt2(k.avg_follow_up_min) : "—"} />
              <Kpi label={t("حالات إقناع خاطئ")} val={fmt0(k.wrong_persuasion)} color={k.wrong_persuasion ? "var(--red)" : undefined} />
              <Kpi label={t("ساخن")} val={fmt0(k.intents.hot)} color="var(--green)" />
              <Kpi label={t("دافئ")} val={fmt0(k.intents.warm)} color="var(--orange)" />
              <Kpi label={t("بارد")} val={fmt0(k.intents.cold)} color="var(--gray)" />
            </div>

            {/* AI coaching notes */}
            <div className="section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>{t("🤖 ملاحظات وتوجيهات AI للموظف")}</h3>
                <button className="btn orange" disabled={genBusy} onClick={generateNotes}>
                  {genBusy ? t("جارٍ توليد الملاحظات…") : t("توليد الملاحظات")}
                </button>
              </div>
              {!notes ? (
                <p className="muted">{t("لم تُولَّد ملاحظات بعد لهذه الفترة. اضغط «توليد الملاحظات».")}</p>
              ) : (
                <>
                  {notes.summary && (
                    <div className="d-block"><h4>{t("تقييم عام")}</h4><div style={{ fontSize: 13 }}>{notes.summary}</div></div>
                  )}
                  <div className="grid2">
                    <NoteList title={t("مشاكل يجب معالجتها")} items={notes.problems} color="var(--red)" />
                    <NoteList title={t("تحسينات مقترحة")} items={notes.improvements} />
                    <NoteList title={t("توجيهات الالتزام بالعمل")} items={notes.commitments} />
                    <NoteList title={t("نقاط القوة")} items={notes.positives} color="var(--green)" />
                  </div>
                  {notes.generated_at && <p className="muted" style={{ marginTop: 8 }}>{t("آخر توليد")}: {new Date(notes.generated_at).toLocaleString("en-GB")}</p>}
                </>
              )}
            </div>

            {/* conversation coaching: opening/dropout pattern comparison */}
            {coaching && (
              <div className="section">
                <h3>{t("🎯 تدريب على المحادثات")}</h3>
                {coaching.measured_conversations < coaching.total_conversations && (
                  <p className="muted" style={{ marginBottom: 10 }}>
                    {t("قِيس {n} من إجمالي {m} محادثة لنقاط الافتتاح/الانقطاع (البقية أُحلِّلت قبل هذه الميزة).",
                      { n: coaching.measured_conversations, m: coaching.total_conversations })}
                  </p>
                )}
                {coaching.opening_patterns.length === 0 && coaching.dropout_patterns.length === 0 ? (
                  <p className="muted">{t("لا أنماط ضعف مرصودة لهذا الموظف في هذه الفترة.")}</p>
                ) : (
                  <>
                    {coaching.opening_patterns.length > 0 && (
                      <div className="d-block">
                        <h4>{t("ضعف في افتتاح المحادثة")}</h4>
                        {coaching.opening_patterns.map((g) => (
                          <PatternCard key={g.pattern_key} group={g} script={scripts[g.pattern_key]}
                            busy={!!scriptBusy[g.pattern_key]} onGenerate={() => generateScript(g.pattern_key)}
                            onViewCustomers={() => setPatModal({ title: g.pattern_label, customers: g.customers })} />
                        ))}
                      </div>
                    )}
                    {coaching.dropout_patterns.length > 0 && (
                      <div className="d-block">
                        <h4>{t("نقاط انقطاع العميل")}</h4>
                        {coaching.dropout_patterns.map((g) => (
                          <PatternCard key={g.pattern_key} group={g} script={scripts[g.pattern_key]}
                            busy={!!scriptBusy[g.pattern_key]} onGenerate={() => generateScript(g.pattern_key)}
                            onViewCustomers={() => setPatModal({ title: g.pattern_label, customers: g.customers })} />
                        ))}
                      </div>
                    )}
                  </>
                )}
                <div className="d-block" style={{ marginTop: 12, borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
                  <h4>{t("دليل الترحيب والاستكشاف")}</h4>
                  <ul className="list-tight">
                    {DISCOVERY_PLAYBOOK.map((line, i) => <li key={i}>{t(line)}</li>)}
                  </ul>
                </div>
              </div>
            )}

            {/* aggregated themes */}
            {(report.themes.improvements.length > 0 || report.themes.mistakes.length > 0 || report.themes.strengths.length > 0) && (
              <div className="section">
                <h3>{t("المشاكل والتحسينات المطلوبة")}</h3>
                <div className="grid2">
                  <NoteList title={t("أبرز المشاكل المتكرّرة")} items={report.themes.mistakes.map((x) => `${x.text}${x.count > 1 ? ` (×${x.count})` : ""}`)} color="var(--red)" />
                  <NoteList title={t("أبرز نصائح التحسين")} items={report.themes.improvements.map((x) => `${x.text}${x.count > 1 ? ` (×${x.count})` : ""}`)} />
                  <NoteList title={t("أبرز نقاط القوة")} items={report.themes.strengths.map((x) => `${x.text}${x.count > 1 ? ` (×${x.count})` : ""}`)} color="var(--green)" />
                </div>
              </div>
            )}

            {/* conversation details */}
            <div className="section">
              <h3>{t("تفاصيل المحادثات ونتائجها")}</h3>
              <DataTable columns={cols} rows={report.conversations} initialSort={{ key: "date", dir: "desc" }} />
            </div>
          </>
        )
      )}

      {sel && <ConvModal conv={sel} onClose={() => setSel(null)} />}

      {patModal && (
        <div className="modal-bg" onClick={() => setPatModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{patModal.title}</h3>
            <ul className="list-tight">
              {patModal.customers.map((c) => (
                <li key={c.wa_id}>
                  <button className="btn ghost" style={{ padding: "2px 8px" }} onClick={() => openCoachingCustomer(c)}>
                    {c.full_name || c.phone} — <span dir="ltr">{c.phone}</span>
                    {c.date ? ` (${new Date(c.date).toLocaleDateString("en-GB")})` : ""}
                  </button>
                  {c.excerpt && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("الرد الفعلي المُرسَل")}: “{c.excerpt}”</div>}
                </li>
              ))}
            </ul>
            <div className="row-actions" style={{ marginTop: 12 }}>
              <button className="btn ghost" onClick={() => setPatModal(null)}>{t("إغلاق")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const DISCOVERY_PLAYBOOK = [
  "ابدأ بتحية دافئة تسأل عن هدف العميل الحقيقي، لا برسالة تسجيل جاهزة.",
  "اسأل: هل تبحث عن تعلّم التداول، أم البدء بالتداول مباشرة، أم فتح حساب فقط؟",
  "اسأل عن خبرته السابقة بالتداول (مبتدئ/له تجربة) لتخصيص الشرح.",
  "اشرح أن الدروس والمواد التعليمية متاحة داخل المنصة بعد فتح حساب (تجريبي أو حقيقي).",
  "اذكر المخاطر وأنواع التداول المتاحة بوضوح، بدون أي وعد أو ضمان أرباح.",
  "اختم بسؤال متابعة يبني الحوار (مثال: أي الأسواق يهمّك أكثر؟) لا برابط تسجيل فقط.",
];

function PatternCard({ group, script, busy, onGenerate, onViewCustomers }) {
  const { t } = useI18n();
  return (
    <div className="d-block" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div><b>{group.pattern_label}</b> <span className="tag warn">×{group.count}</span></div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn ghost" onClick={onViewCustomers}>{t("عرض العملاء")}</button>
          <button className="btn orange" disabled={busy} onClick={onGenerate}>
            {busy ? t("جارٍ التوليد…") : t("توليد رد ذكي")}
          </button>
        </div>
      </div>
      {script && (
        <div style={{ marginTop: 8 }}>
          {script.diagnosis && <div style={{ fontSize: 13, marginBottom: 6 }}><b>{t("التشخيص")}:</b> {script.diagnosis}</div>}
          {script.smart_script && <NoteList title={t("الرد الذكي المقترح")} items={[script.smart_script]} color="var(--green)" />}
          {script.discovery_questions?.length > 0 && <NoteList title={t("أسئلة استكشاف مقترحة")} items={script.discovery_questions} />}
        </div>
      )}
    </div>
  );
}

function NoteList({ title, items, color }) {
  if (!items || !items.length) return null;
  return (
    <div className="d-block">
      <h4 style={color ? { color } : null}>{title}</h4>
      <ul className="list-tight" style={color ? { color } : null}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

function ConvModal({ conv, onClose }) {
  const { t } = useI18n();
  const [transcript, setTranscript] = useState(null); // null = not fetched, {available,messages} once fetched
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  async function loadTranscript() {
    setLoadingTranscript(true);
    try {
      const r = await api.get(`/report/conversation/${encodeURIComponent(conv.wa_id)}/transcript`);
      setTranscript(r);
    } catch {
      setTranscript({ available: false });
    }
    setLoadingTranscript(false);
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t("تفاصيل المحادثة")} — {conv.full_name || conv.phone}</h3>
        <div className="d-row"><span>{t("الهاتف")}</span><b dir="ltr">{conv.phone}</b></div>
        <div className="d-row"><span>{t("التاريخ")}</span><b>{conv.date ? new Date(conv.date).toLocaleString("en-GB") : "—"}</b></div>
        <div className="d-row"><span>{t("درجة الأداء")}</span><b>{conv.agent_score ?? "—"}/100</b></div>
        <div className="d-row"><span>{t("جودة المحادثة")}</span><b>{conv.conv_score ?? "—"}/100</b></div>
        <div className="d-row"><span>{t("النيّة")}</span><b>{INTENT[conv.lead_intent] ? t(INTENT[conv.lead_intent]) : (conv.lead_intent || "—")}</b></div>
        <div className="d-row"><span>{t("النتيجة")}</span><b>{conv.lead_status || "—"}</b></div>
        <div className="d-row"><span>{t("إقناع خاطئ؟")}</span>{conv.wrong_persuasion ? <span className="tag warn">{t("نعم ⚠")}</span> : <span className="tag good">{t("لا")}</span>}</div>
        {conv.summary && (
          <div className="d-block" style={{ marginTop: 12 }}>
            <h4>{t("ملخّص المحادثة")}</h4>
            <div style={{ fontSize: 12.5 }}>{conv.summary}</div>
          </div>
        )}

        {conv.wa_id && !transcript && (
          <button className="btn ghost" style={{ marginTop: 12 }} disabled={loadingTranscript} onClick={loadTranscript}>
            {loadingTranscript ? t("جارٍ التحميل…") : t("عرض المحادثة الكاملة")}
          </button>
        )}
        {transcript && !transcript.available && (
          <p className="muted" style={{ marginTop: 12 }}>{t("نص المحادثة غير متاح (لم تُحلَّل المحادثة بعد هذه الميزة).")}</p>
        )}
        {transcript?.available && (
          <div className="thread" style={{ maxHeight: 320, overflowY: "auto", marginTop: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
            {transcript.messages.map((m, i) => (
              <div key={i} className={`bubble ${m.dir}`}>
                <div className="who">{m.dir === "out" ? `${t("الموظف")} · ${m.sender}` : t("العميل")}</div>
                {m.body}
                <div className="tm">{m.ts ? new Date(m.ts).toLocaleString("en-GB") : ""}</div>
              </div>
            ))}
          </div>
        )}

        <div className="row-actions" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={onClose}>{t("إغلاق")}</button>
        </div>
      </div>
    </div>
  );
}
