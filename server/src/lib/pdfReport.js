// Professional per-employee PDF report. Two concerns kept deliberately
// separate: buildReportHtml() is a pure function (fully testable without a
// browser) that turns already-aggregated employee data into a self-contained
// HTML document; htmlToPdf() drives a real headless Chromium (via
// puppeteer-core, no bundled download) to render that HTML to a PDF buffer —
// using an actual browser engine is what makes Arabic/RTL shaping, ligatures,
// and print-CSS pagination come out correct, which is exactly what a
// hand-rolled PDF library (PDFKit et al.) struggles with for Arabic text.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { patternLabel } from "./businessKnowledge.js";
import { enumLabel, agentLabel } from "./reportI18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The Cairo Arabic subset (regular + bold) is embedded as base64 so the PDF
// is fully self-contained — no reliance on the container having internet
// access or any particular system font installed, and it visually matches
// the web app's brand font exactly instead of falling back to a generic one.
let fontCache = null;
function loadFonts() {
  if (fontCache) return fontCache;
  const base = join(__dirname, "..", "..", "node_modules", "@fontsource", "cairo", "files");
  const b64 = (file) => readFileSync(join(base, file)).toString("base64");
  fontCache = { regular: b64("cairo-arabic-400-normal.woff2"), bold: b64("cairo-arabic-700-normal.woff2") };
  return fontCache;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt1 = (n) => (n == null ? "—" : Number(n).toFixed(1));
const fmt0 = (n) => (n == null ? "—" : String(Math.round(n)));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("en-GB") : "—");

const L = {
  ar: {
    title: "تقرير أداء الموظف", period: "الفترة", from: "من", to: "إلى", generatedAt: "تاريخ الإنشاء",
    overallScore: "نسبة الأداء العام", conversations: "عدد المحادثات المحلّلة", avgConvScore: "متوسط جودة المحادثة",
    avgFollowUp: "متوسط زمن المتابعة (دقيقة)", wrongPersuasion: "حالات إقناع خاطئ", intentBreakdown: "توزيع نيّة العملاء",
    hot: "ساخن", warm: "دافئ", cold: "بارد", coachingTitle: "نقاط ضعف مرصودة (افتتاح/انقطاع)",
    openingSection: "ضعف في افتتاح المحادثة", dropoutSection: "نقاط انقطاع العميل", usedWith: "استُخدم مع",
    customersLabel: "عميل", smartReply: "الرد الذكي المقترح", noPatterns: "لا أنماط ضعف مرصودة في هذه الفترة.",
    aiNotesTitle: "ملاحظات وتوجيهات AI", summary: "تقييم عام", problems: "مشاكل يجب معالجتها",
    improvements: "تحسينات مقترحة", commitments: "توجيهات الالتزام بالعمل", positives: "نقاط القوة",
    notGenerated: "لم تُولَّد ملاحظات AI لهذه الفترة.", convTableTitle: "تفاصيل المحادثات ونتائجها",
    customer: "العميل", phone: "الهاتف", date: "التاريخ", agentScore: "درجة الأداء", convScore: "جودة المحادثة",
    intent: "النيّة", result: "النتيجة", followUp: "المتابعة (د)", yes: "نعم ⚠", no: "لا",
    measured: "قِيس {n} من إجمالي {m} محادثة لنقاط الافتتاح/الانقطاع",
    confidential: "تقرير داخلي — سرّي، لا يُشارَك خارج الشركة", noConversations: "لا توجد محادثات في هذه الفترة.",
  },
  en: {
    title: "Employee Performance Report", period: "Period", from: "From", to: "To", generatedAt: "Generated",
    overallScore: "Overall performance score", conversations: "Analyzed conversations", avgConvScore: "Avg conversation quality",
    avgFollowUp: "Avg follow-up time (min)", wrongPersuasion: "Wrong-persuasion cases", intentBreakdown: "Customer intent breakdown",
    hot: "Hot", warm: "Warm", cold: "Cold", coachingTitle: "Detected weaknesses (opening/dropout)",
    openingSection: "Weak conversation openings", dropoutSection: "Customer dropout points", usedWith: "Used with",
    customersLabel: "customer(s)", smartReply: "Suggested smart reply", noPatterns: "No weak patterns detected in this period.",
    aiNotesTitle: "AI notes & guidance", summary: "Overall assessment", problems: "Problems to address",
    improvements: "Suggested improvements", commitments: "Work-discipline guidance", positives: "Strengths",
    notGenerated: "No AI notes generated for this period.", convTableTitle: "Conversation details & results",
    customer: "Customer", phone: "Phone", date: "Date", agentScore: "Agent score", convScore: "Conv. quality",
    intent: "Intent", result: "Result", followUp: "Follow-up (min)", yes: "Yes ⚠", no: "No",
    measured: "{n} of {m} conversations measured for opening/dropout points",
    confidential: "Internal report — confidential, do not share outside the company", noConversations: "No conversations in this period.",
  },
};

const COLORS = { primary: "#FF7A59", secondary: "#0091AE", ink: "#2D3748", inkMuted: "#6B7280",
  success: "#00BDA5", warning: "#F5C26B", danger: "#F2545B", border: "#DFE3EB", surface: "#F7F7F7" };

function scoreColor(v) { return v >= 60 ? COLORS.success : v >= 40 ? COLORS.warning : COLORS.danger; }
const INTENT_LABEL_KEY = { hot: "hot", warm: "warm", cold: "cold" };

/** A simple ring gauge (0-100) via SVG stroke-dasharray — matches the donut style used elsewhere in this app's reports. */
function gaugeSvg(value, color) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const c = 2 * Math.PI * 42;
  return `<svg viewBox="0 0 100 100" width="118" height="118">
    <circle cx="50" cy="50" r="42" fill="none" stroke="${COLORS.border}" stroke-width="10"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${(v / 100) * c} ${c}" transform="rotate(-90 50 50)"/>
    <text x="50" y="55" text-anchor="middle" font-size="26" font-weight="800" fill="${COLORS.ink}">${fmt0(v)}</text>
  </svg>`;
}

/** Three-segment horizontal bar for hot/warm/cold, proportional to counts. */
function intentBarSvg(intents, t) {
  const total = Math.max(1, (intents.hot || 0) + (intents.warm || 0) + (intents.cold || 0));
  const segs = [
    { n: intents.hot || 0, color: COLORS.success, label: t.hot },
    { n: intents.warm || 0, color: COLORS.warning, label: t.warm },
    { n: intents.cold || 0, color: COLORS.inkMuted, label: t.cold },
  ];
  let x = 0;
  const rects = segs.map((s) => {
    const w = (s.n / total) * 400;
    const r = `<rect x="${x}" y="0" width="${Math.max(w, s.n ? 2 : 0)}" height="22" fill="${s.color}" rx="3"/>`;
    x += w;
    return r;
  }).join("");
  const legend = segs.map((s) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-inline-end:16px;font-size:11px;color:${COLORS.inkMuted}">
    <span style="width:9px;height:9px;border-radius:2px;background:${s.color};display:inline-block"></span>${esc(s.label)}: ${s.n}</span>`).join("");
  return `<svg viewBox="0 0 400 22" width="100%" height="22" preserveAspectRatio="none">${rects}</svg><div style="margin-top:6px">${legend}</div>`;
}

function kpiCard(label, value, color) {
  return `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-val" style="${color ? `color:${color}` : ""}">${esc(value)}</div></div>`;
}

function patternCard(g, t) {
  const examples = (g.smart_reply_examples || []).slice(0, 1).map((s) => `<div class="smart-reply">${esc(s)}</div>`).join("");
  return `<div class="pattern-card">
    <div class="pattern-head"><b>${esc(patternLabel(g.pattern_key, t === L.en ? "en" : "ar"))}</b>
      <span class="badge">${esc(t.usedWith)} ${g.count} ${esc(t.customersLabel)}</span></div>
    ${examples ? `<div class="smart-reply-label">${esc(t.smartReply)}:</div>${examples}` : ""}
  </div>`;
}

function noteList(title, items) {
  if (!items || !items.length) return "";
  return `<div class="note-block"><h4>${esc(title)}</h4><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
}

/**
 * @param {object} data - { agent, lang, period:{since,until}, generatedAt, kpis, intents,
 *   opening_patterns, dropout_patterns, measured_conversations, total_conversations,
 *   notes: {summary, problems, improvements, commitments, positives} | null, conversations: [] }
 */
export function buildReportHtml(data) {
  const lang = data.lang === "en" ? "en" : "ar";
  const t = L[lang];
  const dir = lang === "en" ? "ltr" : "rtl";
  const fonts = loadFonts();
  const k = data.kpis || {};

  const patternsHtml = (data.opening_patterns?.length || data.dropout_patterns?.length)
    ? `
      ${data.opening_patterns?.length ? `<h4 class="sub">${esc(t.openingSection)}</h4>${data.opening_patterns.map((g) => patternCard(g, lang === "en" ? L.en : L.ar)).join("")}` : ""}
      ${data.dropout_patterns?.length ? `<h4 class="sub">${esc(t.dropoutSection)}</h4>${data.dropout_patterns.map((g) => patternCard(g, lang === "en" ? L.en : L.ar)).join("")}` : ""}
    `
    : `<p class="muted">${esc(t.noPatterns)}</p>`;

  const notesHtml = data.notes
    ? `
      ${data.notes.summary ? `<div class="note-block"><h4>${esc(t.summary)}</h4><p>${esc(data.notes.summary)}</p></div>` : ""}
      <div class="notes-grid">
        ${noteList(t.problems, data.notes.problems)}
        ${noteList(t.improvements, data.notes.improvements)}
        ${noteList(t.commitments, data.notes.commitments)}
        ${noteList(t.positives, data.notes.positives)}
      </div>
    `
    : `<p class="muted">${esc(t.notGenerated)}</p>`;

  const rows = data.conversations || [];
  const tableHtml = rows.length ? `
    <table class="conv-table">
      <thead><tr>
        <th>${esc(t.customer)}</th><th>${esc(t.phone)}</th><th>${esc(t.date)}</th>
        <th>${esc(t.agentScore)}</th><th>${esc(t.convScore)}</th><th>${esc(t.intent)}</th>
        <th>${esc(t.result)}</th><th>${esc(t.followUp)}</th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td>${esc(r.full_name || r.phone)}</td>
          <td class="ltr">${esc(r.phone)}</td>
          <td class="ltr">${fmtDate(r.date)}</td>
          <td style="color:${scoreColor(r.agent_score)};font-weight:700">${fmt0(r.agent_score)}</td>
          <td>${fmt0(r.conv_score)}</td>
          <td>${esc(t[INTENT_LABEL_KEY[r.lead_intent]] || r.lead_intent || "—")}</td>
          <td>${esc(r.lead_status || "—")}</td>
          <td>${r.follow_up_min != null ? fmt1(r.follow_up_min) : "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : `<p class="muted">${esc(t.noConversations)}</p>`;

  const measuredLine = (data.measured_conversations < data.total_conversations)
    ? `<p class="muted small">${esc(t.measured.replace("{n}", data.measured_conversations).replace("{m}", data.total_conversations))}</p>`
    : "";

  const body = `
  <div class="header">
    <div>
      <div class="brand">IST Markets</div>
      <h1>${esc(t.title)} — ${esc(agentLabel(data.agent, lang))}</h1>
    </div>
    <div class="meta">
      <div>${esc(t.period)}: ${data.period?.since ? fmtDate(data.period.since) : "—"} ${esc(t.to)} ${data.period?.until ? fmtDate(data.period.until) : "—"}</div>
      <div>${esc(t.generatedAt)}: ${fmtDateTime(data.generatedAt)}</div>
    </div>
  </div>

  <div class="top-row">
    ${gaugeSvg(k.avg_agent_score, scoreColor(k.avg_agent_score))}
    <div style="font-size:11px;color:${COLORS.inkMuted};width:80px">${esc(t.overallScore)}</div>
    <div class="kpis">
      ${kpiCard(t.conversations, fmt0(k.conversations))}
      ${kpiCard(t.avgConvScore, fmt1(k.avg_conv_score))}
      ${kpiCard(t.avgFollowUp, k.avg_follow_up_min != null ? fmt1(k.avg_follow_up_min) : "—")}
      ${kpiCard(t.wrongPersuasion, fmt0(k.wrong_persuasion), k.wrong_persuasion ? COLORS.danger : null)}
    </div>
  </div>

  <div class="intent-block">
    <h4>${esc(t.intentBreakdown)}</h4>
    ${intentBarSvg(k.intents || {}, t)}
  </div>

  <h2>${esc(t.coachingTitle)}</h2>
  ${measuredLine}
  ${patternsHtml}

  <h2>${esc(t.aiNotesTitle)}</h2>
  ${notesHtml}

  <h2>${esc(t.convTableTitle)}</h2>
  ${tableHtml}

  <div class="footer-note">${esc(t.confidential)}</div>`;
  return htmlShell(lang, body);
}

/**
 * Shared self-contained HTML document wrapper (embedded Cairo font + the
 * report CSS + RTL/LTR direction). Both the per-employee report and the
 * weekly/campaign report builders render their body markup through this so
 * they look identical and stay in one place.
 */
export function htmlShell(lang, bodyHtml) {
  const dir = lang === "en" ? "ltr" : "rtl";
  const fonts = loadFonts();
  return `<!doctype html>
<html dir="${dir}" lang="${lang === "en" ? "en" : "ar"}">
<head>
<meta charset="utf-8"/>
<style>
  @font-face { font-family:'Cairo'; font-weight:400; src: url(data:font/woff2;base64,${fonts.regular}) format('woff2'); }
  @font-face { font-family:'Cairo'; font-weight:700; src: url(data:font/woff2;base64,${fonts.bold}) format('woff2'); }
  * { box-sizing: border-box; }
  html, body { background:#ffffff; }
  body { font-family:'Cairo', sans-serif; color:${COLORS.ink}; margin:0; padding:28px 34px; font-size:12.5px; line-height:1.6; }
  h1 { font-size:20px; margin:0 0 2px; }
  h2 { font-size:15px; margin:26px 0 10px; border-bottom:2px solid ${COLORS.primary}; padding-bottom:6px; }
  h4.sub { font-size:12.5px; margin:14px 0 8px; color:${COLORS.inkMuted}; }
  h4 { font-size:12.5px; margin:0 0 6px; }
  p { margin:0 0 6px; }
  .muted { color:${COLORS.inkMuted}; }
  .small { font-size:10.5px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid ${COLORS.primary}; padding-bottom:14px; margin-bottom:16px; }
  .header .brand { font-size:12px; color:${COLORS.secondary}; font-weight:700; }
  .header .meta { text-align:${dir === "rtl" ? "left" : "right"}; font-size:11px; color:${COLORS.inkMuted}; }
  .top-row { display:flex; gap:22px; align-items:center; margin-bottom:18px; }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; flex:1; }
  .kpi { background:${COLORS.surface}; border:1px solid ${COLORS.border}; border-radius:8px; padding:8px 10px; }
  .kpi-label { font-size:10px; color:${COLORS.inkMuted}; }
  .kpi-val { font-size:18px; font-weight:800; }
  .intent-block { margin-top:6px; }
  .pattern-card { background:${COLORS.surface}; border:1px solid ${COLORS.border}; border-radius:8px; padding:8px 10px; margin-bottom:8px; page-break-inside:avoid; }
  .pattern-head { display:flex; justify-content:space-between; align-items:center; }
  .badge { background:${COLORS.warning}; color:#5a4300; border-radius:12px; padding:2px 9px; font-size:10.5px; font-weight:700; }
  .smart-reply-label { font-size:10.5px; color:${COLORS.inkMuted}; margin-top:6px; }
  .smart-reply { font-size:11.5px; color:${COLORS.success}; background:#fff; border-radius:6px; padding:6px 8px; margin-top:2px; }
  .notes-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .note-block { margin-bottom:8px; page-break-inside:avoid; }
  .note-block ul { margin:0; padding-inline-start:18px; }
  .note-block li { margin-bottom:3px; }
  .delta-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:6px; }
  .delta { background:${COLORS.surface}; border:1px solid ${COLORS.border}; border-radius:8px; padding:8px 10px; }
  .delta-label { font-size:10px; color:${COLORS.inkMuted}; }
  .delta-val { font-size:16px; font-weight:800; }
  .delta-chg { font-size:11px; font-weight:700; }
  .verdict { display:inline-block; border-radius:12px; padding:3px 12px; font-size:12px; font-weight:800; margin:4px 0 10px; }
  table.rpt { width:100%; border-collapse:collapse; font-size:10.5px; }
  table.rpt thead { display:table-header-group; }
  table.rpt th { background:${COLORS.ink}; color:#fff; text-align:${dir === "rtl" ? "right" : "left"}; padding:6px 7px; }
  table.rpt td { padding:5px 7px; border-bottom:1px solid ${COLORS.border}; }
  table.rpt tr:nth-child(even) td { background:${COLORS.surface}; }
  table.conv-table { width:100%; border-collapse:collapse; font-size:10.5px; }
  table.conv-table thead { display:table-header-group; }
  table.conv-table th { background:${COLORS.ink}; color:#fff; text-align:${dir === "rtl" ? "right" : "left"}; padding:6px 7px; }
  table.conv-table td { padding:5px 7px; border-bottom:1px solid ${COLORS.border}; }
  table.conv-table tr:nth-child(even) td { background:${COLORS.surface}; }
  .ltr { direction:ltr; text-align:${dir === "rtl" ? "right" : "left"}; }
  .footer-note { margin-top:18px; font-size:10px; color:${COLORS.inkMuted}; text-align:center; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

// Palette + small formatters shared with the sibling report builders.
export const REPORT_COLORS = COLORS;
export const reportEsc = esc;
export const reportFmt = { fmt0, fmt1, fmtDate, fmtDateTime };

const WL = {
  ar: {
    title: "التقرير الأسبوعي للموظف", thisWeek: "هذا الأسبوع", prevWeek: "الأسبوع السابق",
    comparison: "مقارنة الأداء بالأسبوع السابق", verdictTitle: "الخلاصة",
    improved: "تحسّن ↑", declined: "تراجع ↓", steady: "مستقرّ →",
    conversations: "المحادثات", avgScore: "متوسط الأداء", convQuality: "جودة المحادثة", wrongPersuasion: "إقناع خاطئ",
    tips: "نصائح تسويقية للأسبوع القادم", mistakes: "أخطاء يجب تجنّبها", noAi: "لم يتوفّر تحليل AI لهذا الأسبوع.",
    coachingTitle: "نقاط ضعف مرصودة (افتتاح/انقطاع)", convTableTitle: "محادثات هذا الأسبوع",
    customer: "العميل", phone: "الهاتف", date: "التاريخ", agentScore: "الأداء", intent: "النيّة", result: "النتيجة",
    generatedAt: "تاريخ الإنشاء", to: "إلى", confidential: "تقرير داخلي — سرّي، لا يُشارَك خارج الشركة",
    noConversations: "لا محادثات هذا الأسبوع.", noPatterns: "لا أنماط ضعف مرصودة هذا الأسبوع.",
    contactTitle: "التواصل مع العملاء وتكلفتهم", leadsReceived: "ليدز مُستلمة", contacted: "تم التواصل",
    notContacted: "لم يُتواصَل", interestedLbl: "مهتمّون", afterHours: "خارج الدوام", negligence: "إهمال",
    costContacted: "تكلفة المُتواصَل معهم", costNotContacted: "تكلفة غير المُتواصَل معهم", aed: "د.إ",
    contactNote: "«خارج الدوام» = وصل العميل وانتهت نافذة واتساب خارج ساعات العمل (لا يوم عمل)؛ «إهمال» = فُوِّت خلال ساعات العمل. التكلفة تقديرية = إنفاق إعلان الليد.",
  },
  en: {
    title: "Weekly Employee Report", thisWeek: "This week", prevWeek: "Previous week",
    comparison: "Performance vs previous week", verdictTitle: "Verdict",
    improved: "Improved ↑", declined: "Declined ↓", steady: "Steady →",
    conversations: "Conversations", avgScore: "Avg score", convQuality: "Conv. quality", wrongPersuasion: "Wrong persuasion",
    tips: "Marketing tips for next week", mistakes: "Mistakes to avoid", noAi: "No AI analysis available this week.",
    coachingTitle: "Detected weaknesses (opening/dropout)", convTableTitle: "This week's conversations",
    customer: "Customer", phone: "Phone", date: "Date", agentScore: "Score", intent: "Intent", result: "Result",
    generatedAt: "Generated", to: "to", confidential: "Internal report — confidential, do not share outside the company",
    noConversations: "No conversations this week.", noPatterns: "No weak patterns detected this week.",
    contactTitle: "Customer contact & cost", leadsReceived: "Leads received", contacted: "Contacted",
    notContacted: "Not contacted", interestedLbl: "Interested", afterHours: "After-hours", negligence: "Negligence",
    costContacted: "Cost of contacted", costNotContacted: "Cost of not-contacted", aed: "AED",
    contactNote: "\"After-hours\" = the lead arrived and its WhatsApp window expired outside working hours (no workday); \"Negligence\" = missed during working hours. Cost is estimated = the lead's ad spend.",
  },
};

function deltaCard(label, cur, prev, higherIsBetter = true) {
  const c = Number(cur) || 0, p = Number(prev) || 0;
  const diff = c - p;
  const pct = p ? Math.round((diff / p) * 100) : (c ? 100 : 0);
  const up = diff > 0, flat = diff === 0;
  const good = flat ? null : (higherIsBetter ? up : !up);
  const color = good == null ? COLORS.inkMuted : good ? COLORS.success : COLORS.danger;
  const arrow = flat ? "→" : up ? "▲" : "▼";
  return `<div class="delta">
    <div class="delta-label">${esc(label)}</div>
    <div class="delta-val">${fmt1(c)}</div>
    <div class="delta-chg" style="color:${color}">${arrow} ${Math.abs(pct)}% <span class="muted">(${fmt1(p)})</span></div>
  </div>`;
}

/**
 * Contact-cost block shared by the weekly and monthly employee reports: how
 * many of the leads THIS employee received got a human reply vs not, the
 * not-contacted split (after-hours vs negligence), and the ad-spend cost of
 * contacted vs not-contacted leads. `t` is the WL/ML labels dict for the lang.
 */
function contactCostBlock(c, t) {
  if (!c || !c.leads) return "";
  const cur = t.aed;
  const cell = (label, value, color) =>
    `<div class="delta"><div class="delta-label">${esc(label)}</div><div class="delta-val" style="${color ? `color:${color}` : ""}">${esc(value)}</div></div>`;
  return `
  <h2>${esc(t.contactTitle)}</h2>
  <div class="delta-grid">
    ${cell(t.leadsReceived, fmt0(c.leads))}
    ${cell(t.contacted, `${fmt0(c.contacted)} (${fmt1(c.contact_rate_pct)}%)`, COLORS.success)}
    ${cell(t.notContacted, fmt0(c.not_contacted), c.not_contacted ? COLORS.danger : null)}
    ${cell(t.interestedLbl, fmt0(c.interested), COLORS.secondary)}
  </div>
  <div class="delta-grid">
    ${cell(t.afterHours, fmt0(c.after_hours))}
    ${cell(t.negligence, fmt0(c.negligence), c.negligence ? COLORS.danger : null)}
    ${cell(t.costContacted, `${fmt0(c.cost_contacted)} ${cur}`)}
    ${cell(t.costNotContacted, `${fmt0(c.cost_not_contacted)} ${cur}`, c.cost_not_contacted ? COLORS.danger : null)}
  </div>
  <p class="muted small">${esc(t.contactNote)}</p>`;
}

/**
 * Weekly per-employee report with a this-week-vs-previous-week comparison,
 * an AI verdict (improved/declined/steady) + marketing tips + mistakes, then
 * the standard coaching patterns and this-week conversation table.
 * @param {object} data - { agent, lang, period, prevPeriod, generatedAt,
 *   cur:{kpis}, prev:{kpis}, ai:{verdict, narrative, tips[], mistakes[]}|null,
 *   opening_patterns, dropout_patterns, conversations[] }
 */
export function buildEmployeeWeeklyHtml(data) {
  const lang = data.lang === "en" ? "en" : "ar";
  const t = WL[lang];
  const cur = data.cur?.kpis || {}, prev = data.prev?.kpis || {};
  const ai = data.ai;

  const verdictKey = ai?.verdict === "improved" ? "improved" : ai?.verdict === "declined" ? "declined" : "steady";
  const verdictColor = verdictKey === "improved" ? COLORS.success : verdictKey === "declined" ? COLORS.danger : COLORS.inkMuted;

  const patternsHtml = (data.opening_patterns?.length || data.dropout_patterns?.length)
    ? `${(data.opening_patterns || []).map((g) => patternCard(g, lang === "en" ? L.en : L.ar)).join("")}
       ${(data.dropout_patterns || []).map((g) => patternCard(g, lang === "en" ? L.en : L.ar)).join("")}`
    : `<p class="muted">${esc(t.noPatterns)}</p>`;

  const rows = data.conversations || [];
  const tableHtml = rows.length ? `
    <table class="rpt"><thead><tr>
      <th>${esc(t.customer)}</th><th>${esc(t.phone)}</th><th>${esc(t.date)}</th>
      <th>${esc(t.agentScore)}</th><th>${esc(t.intent)}</th><th>${esc(t.result)}</th>
    </tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <td>${esc(r.full_name || r.phone)}</td><td class="ltr">${esc(r.phone)}</td>
        <td class="ltr">${fmtDate(r.date || r.last_message_at)}</td>
        <td style="color:${scoreColor(r.agent_score)};font-weight:700">${fmt0(r.agent_score)}</td>
        <td>${esc(enumLabel("lead_intent", r.lead_intent, lang) || "—")}</td>
        <td>${esc(r.lead_status || "—")}</td>
      </tr>`).join("")}
    </tbody></table>` : `<p class="muted">${esc(t.noConversations)}</p>`;

  const list = (title, items) => (!items || !items.length) ? "" :
    `<div class="note-block"><h4>${esc(title)}</h4><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;

  const body = `
  <div class="header">
    <div><div class="brand">IST Markets</div><h1>${esc(t.title)} — ${esc(agentLabel(data.agent, lang))}</h1></div>
    <div class="meta">
      <div>${esc(t.thisWeek)}: ${fmtDate(data.period?.since)} ${esc(t.to)} ${fmtDate(data.period?.until)}</div>
      <div>${esc(t.generatedAt)}: ${fmtDateTime(data.generatedAt)}</div>
    </div>
  </div>

  <h2>${esc(t.comparison)}</h2>
  <div class="delta-grid">
    ${deltaCard(t.conversations, cur.conversations, prev.conversations, true)}
    ${deltaCard(t.avgScore, cur.avg_agent_score, prev.avg_agent_score, true)}
    ${deltaCard(t.convQuality, cur.avg_conv_score, prev.avg_conv_score, true)}
    ${deltaCard(t.wrongPersuasion, cur.wrong_persuasion, prev.wrong_persuasion, false)}
  </div>

  <h2>${esc(t.verdictTitle)}</h2>
  ${ai ? `
    <span class="verdict" style="background:${verdictColor};color:#fff">${esc(t[verdictKey])}</span>
    <p>${esc(ai.narrative || "")}</p>
    <div class="notes-grid">
      ${list(t.tips, ai.tips)}
      ${list(t.mistakes, ai.mistakes)}
    </div>` : `<p class="muted">${esc(t.noAi)}</p>`}

  ${contactCostBlock(data.contacts, t)}

  <h2>${esc(t.coachingTitle)}</h2>
  ${patternsHtml}

  <h2>${esc(t.convTableTitle)}</h2>
  ${tableHtml}

  <div class="footer-note">${esc(t.confidential)}</div>`;
  return htmlShell(lang, body);
}

const ML = {
  ar: {
    title: "التقرير الشهري للموظف", month: "الشهر", generatedAt: "تاريخ الإنشاء",
    progression: "تطوّر الأداء أسبوعاً بأسبوع", week: "الأسبوع", conversations: "المحادثات",
    avgScore: "متوسط الأداء", convQuality: "جودة المحادثة", wrongPersuasion: "إقناع خاطئ",
    resolved: "نقاط حُلّت ✓", newPoints: "نقاط جديدة", persisting: "أخطاء مستمرّة",
    monthVsMonth: "الشهر الحالي مقابل الشهر السابق", verdictTitle: "الخلاصة",
    improved: "تحسّن ↑", declined: "تراجع ↓", steady: "مستقرّ →",
    weekNote: "* الأسبوع الأول يُقارَن بآخر أسبوع من الشهر السابق.",
    noAi: "لم يتوفّر تحليل AI لهذا الشهر.", confidential: "تقرير داخلي — سرّي، لا يُشارَك خارج الشركة",
    contactTitle: "التواصل مع العملاء وتكلفتهم", leadsReceived: "ليدز مُستلمة", contacted: "تم التواصل",
    notContacted: "لم يُتواصَل", interestedLbl: "مهتمّون", afterHours: "خارج الدوام", negligence: "إهمال",
    costContacted: "تكلفة المُتواصَل معهم", costNotContacted: "تكلفة غير المُتواصَل معهم", aed: "د.إ",
    contactNote: "«خارج الدوام» = وصل العميل وانتهت نافذة واتساب خارج ساعات العمل (لا يوم عمل)؛ «إهمال» = فُوِّت خلال ساعات العمل. التكلفة تقديرية = إنفاق إعلان الليد.",
  },
  en: {
    title: "Monthly Employee Report", month: "Month", generatedAt: "Generated",
    progression: "Week-by-week progression", week: "Week", conversations: "Conversations",
    avgScore: "Avg score", convQuality: "Conv. quality", wrongPersuasion: "Wrong persuasion",
    resolved: "Resolved ✓", newPoints: "New points", persisting: "Persisting mistakes",
    monthVsMonth: "This month vs previous month", verdictTitle: "Verdict",
    improved: "Improved ↑", declined: "Declined ↓", steady: "Steady →",
    weekNote: "* Week 1 is compared against the last week of the previous month.",
    noAi: "No AI analysis available this month.", confidential: "Internal report — confidential, do not share outside the company",
    contactTitle: "Customer contact & cost", leadsReceived: "Leads received", contacted: "Contacted",
    notContacted: "Not contacted", interestedLbl: "Interested", afterHours: "After-hours", negligence: "Negligence",
    costContacted: "Cost of contacted", costNotContacted: "Cost of not-contacted", aed: "AED",
    contactNote: "\"After-hours\" = the lead arrived and its WhatsApp window expired outside working hours (no workday); \"Negligence\" = missed during working hours. Cost is estimated = the lead's ad spend.",
  },
};

/**
 * Monthly employee package: (A) week-by-week progression inside the completed
 * month with resolved/new/persisting points, (B) month-vs-month comparison.
 * @param {object} data - { agent, lang, monthKey, month, generatedAt, week0,
 *   weeks:[{isoWeek,kpis}], cur:{kpis}, prev:{kpis}, ai:{weekly_narrative,
 *   resolved[], new_points[], persisting[], month_narrative, verdict}|null }
 */
export function buildEmployeeMonthlyHtml(data) {
  const lang = data.lang === "en" ? "en" : "ar";
  const t = ML[lang];
  const ai = data.ai;
  const cur = data.cur?.kpis || {}, prev = data.prev?.kpis || {};
  const allWeeks = [data.week0, ...(data.weeks || [])].filter(Boolean);

  const weekRows = allWeeks.map((s, i) => {
    const k = s.kpis || {};
    const label = i === 0 ? `${esc(s.isoWeek)} *` : esc(s.isoWeek);
    return `<tr>
      <td>${label}</td><td>${fmt0(k.conversations)}</td><td>${fmt1(k.avg_agent_score)}</td>
      <td>${fmt1(k.avg_conv_score)}</td><td>${fmt0(k.wrong_persuasion)}</td></tr>`;
  }).join("");

  const list = (title, items, color) => (!items || !items.length) ? "" :
    `<div class="note-block"><h4 style="${color ? `color:${color}` : ""}">${esc(title)}</h4><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;

  const verdictKey = ai?.verdict === "improved" ? "improved" : ai?.verdict === "declined" ? "declined" : "steady";
  const verdictColor = verdictKey === "improved" ? COLORS.success : verdictKey === "declined" ? COLORS.danger : COLORS.inkMuted;

  const body = `
  <div class="header">
    <div><div class="brand">IST Markets</div><h1>${esc(t.title)} — ${esc(agentLabel(data.agent, lang))}</h1></div>
    <div class="meta">
      <div>${esc(t.month)}: ${esc(data.monthKey)} (${fmtDate(data.month?.since)} ${lang === "en" ? "to" : "إلى"} ${fmtDate(data.month?.until)})</div>
      <div>${esc(t.generatedAt)}: ${fmtDateTime(data.generatedAt)}</div>
    </div>
  </div>

  <h2>${esc(t.progression)}</h2>
  <table class="rpt"><thead><tr>
    <th>${esc(t.week)}</th><th>${esc(t.conversations)}</th><th>${esc(t.avgScore)}</th>
    <th>${esc(t.convQuality)}</th><th>${esc(t.wrongPersuasion)}</th>
  </tr></thead><tbody>${weekRows}</tbody></table>
  <p class="muted small">${esc(t.weekNote)}</p>
  ${ai ? `<p>${esc(ai.weekly_narrative || "")}</p>
    <div class="notes-grid">
      ${list(t.resolved, ai.resolved, COLORS.success)}
      ${list(t.newPoints, ai.new_points, COLORS.secondary)}
      ${list(t.persisting, ai.persisting, COLORS.danger)}
    </div>` : `<p class="muted">${esc(t.noAi)}</p>`}

  <h2>${esc(t.monthVsMonth)}</h2>
  <div class="delta-grid">
    ${deltaCard(t.conversations, cur.conversations, prev.conversations, true)}
    ${deltaCard(t.avgScore, cur.avg_agent_score, prev.avg_agent_score, true)}
    ${deltaCard(t.convQuality, cur.avg_conv_score, prev.avg_conv_score, true)}
    ${deltaCard(t.wrongPersuasion, cur.wrong_persuasion, prev.wrong_persuasion, false)}
  </div>
  ${ai ? `<span class="verdict" style="background:${verdictColor};color:#fff">${esc(t[verdictKey])}</span>
    <p>${esc(ai.month_narrative || "")}</p>` : ""}

  ${contactCostBlock(data.contacts, t)}

  <div class="footer-note">${esc(t.confidential)}</div>`;
  return htmlShell(lang, body);
}

let browserPromise = null;

export function resolveExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    "/usr/bin/chromium-browser", "/usr/bin/chromium", // Alpine (Docker runtime image)
    "C:/Program Files/Google/Chrome/Application/chrome.exe", // local Windows dev
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  for (const p of candidates) {
    try { readFileSync(p); return p; } catch { /* try next */ }
  }
  return null;
}

async function getBrowser() {
  if (browserPromise) return browserPromise;
  const executablePath = resolveExecutablePath();
  if (!executablePath) {
    throw new Error("No Chromium available on the server to render PDFs — set PUPPETEER_EXECUTABLE_PATH. "
      + "/ لا يوجد متصفح Chromium متاح على الخادم لإنشاء PDF. اضبط PUPPETEER_EXECUTABLE_PATH.");
  }
  const puppeteer = await import("puppeteer-core");
  browserPromise = puppeteer.launch({
    executablePath, headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  }).catch((e) => { browserPromise = null; throw e; });
  return browserPromise;
}

/** Renders HTML to a PDF Buffer using a lazily-launched, reused headless
 *  browser. `opts.landscape` renders A4 landscape (wider tables read clearer). */
export async function htmlToPdf(html, opts = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const bytes = await page.pdf({
      format: "A4", printBackground: true, landscape: !!opts.landscape,
      margin: { top: "10mm", bottom: "14mm", left: "10mm", right: "10mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-size:9px;width:100%;text-align:center;color:#6B7280">
        <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
    // Newer Puppeteer versions return a Uint8Array, not a Node Buffer.
    // Express's res.send() only recognizes a real Buffer as binary
    // (Buffer.isBuffer() is false for a plain Uint8Array even though Buffer
    // extends it) — anything else silently falls through to res.json(),
    // JSON-stringifying every byte into a "{0:37,1:80,...}" text blob that
    // looks like a huge, corrupted PDF to the browser. Wrapping here once
    // means every caller always gets a real Buffer, regardless of the
    // installed Puppeteer version's return type.
    return Buffer.from(bytes);
  } finally {
    await page.close();
  }
}

/** For graceful shutdown / test cleanup — not called during normal request handling. */
export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => {});
}

export default { buildReportHtml, htmlToPdf, closeBrowser, resolveExecutablePath };
