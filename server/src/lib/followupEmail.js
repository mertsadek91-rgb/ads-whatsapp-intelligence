// Daily per-employee follow-up alert: which of the agent's leads still need a
// human reply before the WhatsApp 24h window closes, which interested leads
// need nurturing, and which were contacted late (cross-day updates from the
// persisted ads_lead_followup snapshot). Sent as an inline HTML email (not a
// PDF) — it's a short, actionable operational alert.
import { query } from "../db.js";
import { gatherContactStatus } from "./contactStatus.js";
import { doNotWhatsapp } from "./tagBoard.js";

const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Actionable follow-up lists for one agent, as of `now`. */
export async function gatherEmployeeFollowup(agent, { now = new Date() } = {}) {
  const until = new Date(now).toISOString().slice(0, 10);
  const since = new Date(new Date(now).getTime() - 3 * 86400000).toISOString().slice(0, 10); // last ~3 days
  const { leads } = await gatherContactStatus(since, until, { now });
  const all = leads.filter((l) => squash(l.owner) === squash(agent));

  // Customers who asked us to stop. This email is a to-do list, and a customer
  // who said "don't message me" must not appear on it — not as urgent, not as
  // interested, not as a missed opportunity. They are listed separately instead
  // of vanishing, so the employee knows why the name is gone and can challenge
  // the tag if the AI misread it.
  const stop = await doNotWhatsapp(all.map((l) => l.wa_id));
  const mine = all.filter((l) => !stop.has(l.wa_id));
  const optedOut = all.filter((l) => stop.has(l.wa_id))
    .map((l) => ({ ...l, ...stop.get(l.wa_id) })).slice(0, 40);

  // Urgent: customer waiting, no human reply yet, 24h window still open.
  const urgent = mine.filter((l) => !l.contacted && l.wa_window_open)
    .sort((a, b) => (a.wa_hours_left ?? 99) - (b.wa_hours_left ?? 99)).slice(0, 40);
  // Interested leads that need nurturing (contacted or not).
  const interested = mine.filter((l) => l.interested).slice(0, 40);
  // Missed: window closed with no human contact. An opted-out customer is not a
  // missed opportunity — nobody failed, the customer left.
  const missed = mine.filter((l) => l.status === "expired_no_contact").slice(0, 40);

  // Cross-day updates: leads this agent contacted LATE (a day+ after arrival),
  // from the persisted snapshot — the "final result changed" the owner asked for.
  const lateRows = await query(
    `select wa_id, created_date, contacted_at from ads_lead_followup
     where owner = ? and contacted = 1 and contacted_at is not null
       and date(contacted_at) > created_date and updated_at >= (now() - interval 2 day)
     order by contacted_at desc limit 40`, [agent]);

  return {
    agent, date: until,
    counts: {
      urgent: urgent.length, interested: interested.length, missed: missed.length,
      late: lateRows.length, opted_out: optedOut.length,
    },
    urgent, interested, missed, late: lateRows, optedOut,
  };
}

const L = {
  ar: { title: "متابعة عملائك اليوم", urgent: "⏰ يجب التواصل قبل إغلاق نافذة واتساب (24 ساعة)",
    interested: "⭐ عملاء مهتمّون يحتاجون متابعة", missed: "❌ فاتت نافذتهم بلا تواصل",
    late: "✅ تحديث: تواصلتَ معهم متأخراً (بعد يوم الوصول)", phone: "الهاتف", left: "المتبقّي", stage: "الحالة",
    hoursLeft: "ساعة", none: "لا شيء", note: "نافذة واتساب API تُغلق بعد 24 ساعة من آخر رسالة للعميل — استغل الوقت.",
    allClear: "لا يوجد عملاء يحتاجون تواصلاً عاجلاً اليوم. أحسنت!",
    optedOut: "🚫 طلبوا عدم التواصل — لا تُراسلهم",
    optedOutNote: "هؤلاء مستبعَدون من قوائم اليوم لأنهم طلبوا إيقاف المراسلة صراحةً. إن كان الرصد خاطئاً، أبلغ المشرف ليرفض الوسم من صفحة وسوم العملاء.",
    reason: "ما قاله العميل", confirmedLbl: "مؤكَّد من المشرف" },
  en: { title: "Your customer follow-ups today", urgent: "⏰ Contact before the WhatsApp 24h window closes",
    interested: "⭐ Interested customers to nurture", missed: "❌ Window closed with no contact",
    late: "✅ Update: contacted late (after arrival day)", phone: "Phone", left: "Left", stage: "Stage",
    hoursLeft: "h", none: "None", note: "The WhatsApp API window closes 24h after the customer's last message — use the time.",
    allClear: "No customers need urgent contact today. Well done!",
    optedOut: "🚫 Asked us to stop — do not message",
    optedOutNote: "These are excluded from today's lists because they explicitly asked us to stop messaging them. If that reading is wrong, tell your supervisor so they can reject the tag on the customer-tags page.",
    reason: "What the customer said", confirmedLbl: "confirmed by supervisor" },
};

function table(rows, cols) {
  if (!rows.length) return "";
  return `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:6px 0 14px">
    <thead><tr>${cols.map((c) => `<th style="text-align:start;background:#2D3748;color:#fff;padding:5px 8px">${esc(c.h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td style="padding:4px 8px;border-bottom:1px solid #DFE3EB">${c.v(r)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/** Inline HTML email body for one agent's follow-up. */
export function buildFollowupEmailHtml(data, lang = "ar") {
  const t = L[lang === "en" ? "en" : "ar"];
  const dir = lang === "en" ? "ltr" : "rtl";
  const optedOut = data.optedOut || [];
  const hasAny = data.urgent.length || data.interested.length || data.missed.length
    || data.late.length || optedOut.length;
  const body = hasAny ? `
    ${data.urgent.length ? `<h3 style="color:#F2545B">${esc(t.urgent)} (${data.urgent.length})</h3>
      ${table(data.urgent, [{ h: t.phone, v: (r) => `<span dir="ltr">${esc(r.wa_id)}</span>` },
        { h: t.left, v: (r) => `<b>${r.wa_hours_left ?? "—"} ${esc(t.hoursLeft)}</b>` },
        { h: t.stage, v: (r) => esc(r.stage || "—") }])}` : ""}
    ${data.interested.length ? `<h3 style="color:#00806e">${esc(t.interested)} (${data.interested.length})</h3>
      ${table(data.interested, [{ h: t.phone, v: (r) => `<span dir="ltr">${esc(r.wa_id)}</span>` },
        { h: t.stage, v: (r) => esc(r.stage || "—") }])}` : ""}
    ${data.late.length ? `<h3 style="color:#00806e">${esc(t.late)} (${data.late.length})</h3>
      ${table(data.late, [{ h: t.phone, v: (r) => `<span dir="ltr">${esc(r.wa_id)}</span>` }])}` : ""}
    ${data.missed.length ? `<h3 style="color:#6B7280">${esc(t.missed)} (${data.missed.length})</h3>
      ${table(data.missed, [{ h: t.phone, v: (r) => `<span dir="ltr">${esc(r.wa_id)}</span>` },
        { h: t.stage, v: (r) => esc(r.stage || "—") }])}` : ""}
    ${optedOut.length ? `<h3 style="color:#B91C1C">${esc(t.optedOut)} (${optedOut.length})</h3>
      <p style="color:#6B7280;font-size:12px;margin:0 0 6px">${esc(t.optedOutNote)}</p>
      ${table(optedOut, [
        { h: t.phone, v: (r) => `<span dir="ltr">${esc(r.wa_id)}</span>` },
        // The quote is what makes this checkable rather than a black box: the
        // employee can see the customer's own words and say if it was misread.
        { h: t.reason, v: (r) => `${esc(r.evidence || "—")}${r.confirmed ? ` <b>(${esc(t.confirmedLbl)})</b>` : ""}` },
      ])}` : ""}
    <p style="color:#6B7280;font-size:12px">${esc(t.note)}</p>`
    : `<p>${esc(t.allClear)}</p>`;
  return `<div dir="${dir}" style="font-family:Arial,sans-serif;color:#2D3748;max-width:720px">
    <h2 style="color:#FF7A59">${esc(t.title)} — ${esc(data.agent)} · ${esc(data.date)}</h2>${body}</div>`;
}

export default { gatherEmployeeFollowup, buildFollowupEmailHtml };
