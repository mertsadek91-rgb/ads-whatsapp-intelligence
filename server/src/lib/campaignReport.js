// Daily campaign report: ACTIVE campaigns' last-7-days results vs the prior 7
// days, with a per-campaign AI verdict (keep / watch / close), a concrete
// adjustment, and a warning. Rendered through the shared report shell so it
// matches the employee report's look and stays self-contained (embedded font).
import { htmlShell, REPORT_COLORS as C, reportEsc as esc, reportFmt as F } from "./pdfReport.js";

const L = {
  ar: {
    title: "تقرير الحملات الإعلانية", subtitle: "الحملات النشطة — آخر 7 أيام مقابل الأسبوع السابق",
    generatedAt: "تاريخ الإنشاء", to: "إلى", overview: "نظرة عامة",
    campaign: "الحملة", spend: "الإنفاق", results: "النتائج", cpr: "تكلفة النتيجة", trend: "التغيّر", verdict: "التوصية",
    keep: "أبقِ", watch: "راقب", close: "أغلِق", details: "التفاصيل والتوصيات",
    adjustment: "التعديل المقترح", warning: "تحذير", noCampaigns: "لا حملات نشطة حالياً.",
    totalSpend: "إجمالي الإنفاق", totalResults: "إجمالي النتائج", activeCount: "حملات نشطة",
    confidential: "تقرير داخلي — سرّي، لا يُشارَك خارج الشركة", noAi: "لم يتوفّر تحليل AI.",
    hierarchy: "التسلسل الكامل: الحملة ← المجموعة ← الإعلان", contacts: "جهات", qualified: "مؤهّل",
    countries: "تحليل البلدان — مصدر العملاء وأين ننفق", country: "الدولة", leads: "العملاء", interested: "المهتمون",
    qualRate: "نسبة التأهّل", costLead: "تكلفة الليد", staff: "الموظفون", noData: "لا بيانات.",
    countryNote: "الدولة مُشتقّة من رقم هاتف العميل؛ الإنفاق حسب استهداف Meta للجمهور.",
    daily: "يومي", weekly: "أسبوعي", monthly: "شهري", cadenceSub: "مقارنة بالفترة السابقة",
    costTitle: "تكلفة كل شيء حصلنا عليه خلال الفترة",
    reach: "الوصول", impressions: "الظهور/الانتشار", clicks: "النقرات", conversations: "المحادثات",
    newFollowers: "متابعون جدد", cpConversation: "تكلفة المحادثة", cpInterested: "تكلفة المهتم",
    cpClick: "تكلفة النقرة", cpMille: "تكلفة ألف ظهور", cpFollower: "تكلفة متابع جديد",
    followersNote: "«المتابعون الجدد» يحتاجون ربط صفحة Facebook/Instagram (صلاحية Page Insights) — يُضافون لاحقاً.",
    humanContacted: "تواصل بشري",
    staffContact: "تواصل الموظفين مع العملاء", staffMember: "الموظف", sLeads: "عملاء", sContacted: "تم التواصل",
    sNot: "لم يُتواصل", sAfter: "خارج الدوام", sNegl: "إهمال", sRate: "نسبة التواصل",
    sCostC: "تكلفة المُتواصَل", sCostN: "تكلفة غير المُتواصَل",
    contactNote: "«تم التواصل» = ردّ موظف بشري فعلاً (لا البوت). «خارج الدوام» = وصل العميل بعد ساعات العمل.",
  },
  en: {
    title: "Ad Campaigns Report", subtitle: "Active campaigns — last 7 days vs the previous week",
    generatedAt: "Generated", to: "to", overview: "Overview",
    campaign: "Campaign", spend: "Spend", results: "Results", cpr: "Cost / result", trend: "Change", verdict: "Verdict",
    keep: "Keep", watch: "Watch", close: "Close", details: "Details & recommendations",
    adjustment: "Suggested adjustment", warning: "Warning", noCampaigns: "No active campaigns.",
    totalSpend: "Total spend", totalResults: "Total results", activeCount: "Active campaigns",
    confidential: "Internal report — confidential, do not share outside the company", noAi: "No AI analysis available.",
    hierarchy: "Full hierarchy: Campaign → Ad Set → Ad", contacts: "Contacts", qualified: "Qualified",
    countries: "Country analysis — where leads come from & where we spend", country: "Country", leads: "Leads", interested: "Interested",
    qualRate: "Qual. rate", costLead: "Cost / lead", staff: "Staff", noData: "No data.",
    countryNote: "Country is derived from the customer's phone number; spend reflects Meta audience targeting.",
    daily: "Daily", weekly: "Weekly", monthly: "Monthly", cadenceSub: "vs the previous period",
    costTitle: "Cost of everything obtained this period",
    reach: "Reach", impressions: "Impressions", clicks: "Clicks", conversations: "Conversations",
    newFollowers: "New followers", cpConversation: "Cost / conversation", cpInterested: "Cost / interested",
    cpClick: "Cost / click", cpMille: "Cost / 1k impressions", cpFollower: "Cost / new follower",
    followersNote: "“New followers” needs a linked Facebook/Instagram Page (Page Insights permission) — added later.",
    humanContacted: "Human-contacted",
    staffContact: "Staff contact with customers", staffMember: "Employee", sLeads: "Leads", sContacted: "Contacted",
    sNot: "Not contacted", sAfter: "After-hours", sNegl: "Negligence", sRate: "Contact rate",
    sCostC: "Cost (contacted)", sCostN: "Cost (not contacted)",
    contactNote: "“Contacted” = a human employee actually replied (not the bot). “After-hours” = the customer arrived outside working hours.",
  },
};
const VERDICT_COLOR = { keep: C.success, watch: C.warning, close: C.danger };

// Keep only ACTIVE ads and re-roll ad-set/campaign totals from them; drop any
// ad set or campaign left with no active ads.
function activeOnly(tree) {
  const sum = (items) => items.reduce((acc, x) => {
    for (const k of Object.keys(x.metrics)) acc[k] = (acc[k] || 0) + (Number(x.metrics[k]) || 0);
    return acc;
  }, {});
  return tree.map((c) => {
    const adsets = c.adsets.map((s) => {
      const ads = s.ads.filter((a) => a.status === "ACTIVE");
      return ads.length ? { ...s, ads, metrics: sum(ads) } : null;
    }).filter(Boolean);
    return adsets.length ? { ...c, adsets, metrics: sum(adsets) } : null;
  }).filter(Boolean);
}

function pct(cur, prev) {
  const c = Number(cur) || 0, p = Number(prev) || 0;
  if (!p) return c ? 100 : 0;
  return Math.round(((c - p) / p) * 100);
}
function trendCell(cur, prev, higherIsBetter) {
  const d = pct(cur, prev);
  const flat = d === 0, up = d > 0;
  const good = flat ? null : (higherIsBetter ? up : !up);
  const color = good == null ? C.inkMuted : good ? C.success : C.danger;
  return `<span style="color:${color};font-weight:700">${flat ? "→" : up ? "▲" : "▼"} ${Math.abs(d)}%</span>`;
}
const money = (n) => (n == null ? "—" : "AED " + F.fmt0(n));

/**
 * @param {object} data - { lang, period:{since,until}, generatedAt, totals:{spend,results,active},
 *   campaigns: [{ campaign_id, campaign_name, spend, results, cpr, prev_spend, prev_results, prev_cpr,
 *     verdict:'keep'|'watch'|'close', adjustment, warning }] }
 */
export function buildCampaignReportHtml(data) {
  const lang = data.lang === "en" ? "en" : "ar";
  const t = L[lang];
  const camps = data.campaigns || [];
  const tot = data.totals || {};

  const tableHtml = camps.length ? `
    <table class="rpt"><thead><tr>
      <th>${esc(t.campaign)}</th><th>${esc(t.spend)}</th><th>${esc(t.results)}</th>
      <th>${esc(t.cpr)}</th><th>${esc(t.trend)}</th><th>${esc(t.verdict)}</th>
    </tr></thead><tbody>
      ${camps.map((c) => `<tr>
        <td>${esc(c.campaign_name || c.campaign_id)}</td>
        <td>${money(c.spend)}</td>
        <td>${F.fmt0(c.results)} <span class="muted">(${F.fmt0(c.prev_results)})</span></td>
        <td>${money(c.cpr)}</td>
        <td>${trendCell(c.results, c.prev_results, true)}</td>
        <td><span style="color:${VERDICT_COLOR[c.verdict] || C.inkMuted};font-weight:800">${esc(t[c.verdict] || "—")}</span></td>
      </tr>`).join("")}
    </tbody></table>` : `<p class="muted">${esc(t.noCampaigns)}</p>`;

  const detailsHtml = camps.map((c) => {
    if (!c.adjustment && !c.warning) return "";
    return `<div class="pattern-card">
      <div class="pattern-head"><b>${esc(c.campaign_name || c.campaign_id)}</b>
        <span class="verdict" style="background:${VERDICT_COLOR[c.verdict] || C.inkMuted};color:#fff">${esc(t[c.verdict] || "")}</span></div>
      ${c.adjustment ? `<div class="smart-reply-label">${esc(t.adjustment)}:</div><div>${esc(c.adjustment)}</div>` : ""}
      ${c.warning ? `<div class="smart-reply-label" style="color:${C.danger}">${esc(t.warning)}:</div><div>${esc(c.warning)}</div>` : ""}
    </div>`;
  }).join("");

  // Full Campaign → Ad Set → Ad hierarchy, flattened into one indented table.
  // The PDF shows ONLY currently-ACTIVE ads (paused/campaign-paused ads are
  // noise for a "what's running now" report), and re-sums each ad set/campaign
  // from just those active ads so the totals match what's listed.
  const tree = activeOnly(data.tree || []);
  const treeHtml = tree.length ? `
    <table class="rpt"><thead><tr>
      <th>${esc(t.campaign)} / ${esc(t.hierarchy.split(":").pop().trim())}</th>
      <th>${esc(t.spend)}</th><th>${esc(t.results)}</th><th>${esc(t.contacts)}</th><th>${esc(t.qualified)}</th>
    </tr></thead><tbody>
      ${tree.map((c) => {
        const rows = [`<tr style="background:${C.surface}"><td><b>${esc(c.name || c.campaign_id)}</b></td>
          <td><b>${money(c.metrics.spend_aed)}</b></td><td><b>${F.fmt0(c.metrics.results)}</b></td>
          <td><b>${F.fmt0(c.metrics.contacts)}</b></td><td><b>${F.fmt0(c.metrics.qualified)}</b></td></tr>`];
        for (const s of c.adsets) {
          rows.push(`<tr><td style="padding-inline-start:22px">↳ ${esc(s.name || s.adset_id)}</td>
            <td>${money(s.metrics.spend_aed)}</td><td>${F.fmt0(s.metrics.results)}</td>
            <td>${F.fmt0(s.metrics.contacts)}</td><td>${F.fmt0(s.metrics.qualified)}</td></tr>`);
          for (const a of s.ads) {
            rows.push(`<tr><td style="padding-inline-start:40px;color:${C.inkMuted}">• ${esc(a.name || a.ad_id)}</td>
              <td>${money(a.metrics.spend_aed)}</td><td>${F.fmt0(a.metrics.results)}</td>
              <td>${F.fmt0(a.metrics.contacts)}</td><td>${F.fmt0(a.metrics.qualified)}</td></tr>`);
          }
        }
        return rows.join("");
      }).join("")}
    </tbody></table>` : `<p class="muted">${esc(t.noData)}</p>`;

  // Per-country breakdown.
  const countries = data.countries?.rows || [];
  const countriesHtml = countries.length ? `
    <p class="muted small">${esc(t.countryNote)}</p>
    <table class="rpt"><thead><tr>
      <th>${esc(t.country)}</th><th>${esc(t.leads)}</th><th>${esc(t.humanContacted)}</th><th>${esc(t.interested)}</th>
      <th>${esc(t.qualRate)}</th><th>${esc(t.spend)}</th><th>${esc(t.costLead)}</th>
      <th>${esc(t.staff)}</th><th>${esc(t.verdict)}</th>
    </tr></thead><tbody>
      ${countries.slice(0, 20).map((r) => `<tr>
        <td>${esc(r.flag)} ${esc(lang === "en" ? r.en : r.ar)}</td>
        <td>${F.fmt0(r.contacts)}</td>
        <td>${r.contacted != null ? F.fmt0(r.contacted) : "—"}</td>
        <td>${F.fmt0(r.qualified)}</td>
        <td>${r.qual_rate_pct != null ? r.qual_rate_pct + "%" : "—"}</td>
        <td>${r.spend_aed != null ? money(r.spend_aed) : "—"}</td>
        <td>${r.cost_per_lead != null ? money(r.cost_per_lead) : "—"}</td>
        <td>${(r.employees || []).length ? esc(r.employees.join("، ")) : "—"}</td>
        <td><span style="color:${VERDICT_COLOR[r.verdict] || C.inkMuted};font-weight:800">${esc(t[r.verdict] || "—")}</span></td>
      </tr>`).join("")}
    </tbody></table>` : `<p class="muted">${esc(t.noData)}</p>`;

  // Staff contact table: who contacted the customers, who didn't, and why.
  const staff = data.employeeContacts || [];
  const staffHtml = staff.length ? `
    <p class="muted small">${esc(t.contactNote)}</p>
    <table class="rpt"><thead><tr>
      <th>${esc(t.staffMember)}</th><th>${esc(t.sLeads)}</th><th>${esc(t.sContacted)}</th><th>${esc(t.sNot)}</th>
      <th>${esc(t.sAfter)}</th><th>${esc(t.sNegl)}</th><th>${esc(t.sRate)}</th>
      <th>${esc(t.sCostC)}</th><th>${esc(t.sCostN)}</th>
    </tr></thead><tbody>
      ${staff.map((s) => `<tr>
        <td>${esc(s.key)}</td>
        <td>${F.fmt0(s.leads)}</td>
        <td style="color:${C.success}">${F.fmt0(s.contacted)}</td>
        <td style="color:${s.not_contacted ? C.danger : C.ink}">${F.fmt0(s.not_contacted)}</td>
        <td>${F.fmt0(s.after_hours)}</td>
        <td style="color:${s.negligence ? C.danger : C.ink}">${F.fmt0(s.negligence)}</td>
        <td>${s.contact_rate_pct}%</td>
        <td>${money(s.cost_contacted)}</td>
        <td>${money(s.cost_not_contacted)}</td>
      </tr>`).join("")}
    </tbody></table>` : `<p class="muted">${esc(t.noData)}</p>`;

  // "Cost of everything" block for the selected window.
  const M = data.metrics;
  const costHtml = M ? `
    <div class="delta-grid" style="grid-template-columns:repeat(6,1fr)">
      <div class="delta"><div class="delta-label">${esc(t.spend)}</div><div class="delta-val">${money(M.spend)}</div></div>
      <div class="delta"><div class="delta-label">${esc(t.reach)}</div><div class="delta-val">${M.reach ? F.fmt0(M.reach) : "—"}</div></div>
      <div class="delta"><div class="delta-label">${esc(t.impressions)}</div><div class="delta-val">${F.fmt0(M.impressions)}</div></div>
      <div class="delta"><div class="delta-label">${esc(t.clicks)}</div><div class="delta-val">${F.fmt0(M.clicks)}</div></div>
      <div class="delta"><div class="delta-label">${esc(t.conversations)}</div><div class="delta-val">${F.fmt0(M.conversations)}</div></div>
      <div class="delta"><div class="delta-label">${esc(t.interested)}</div><div class="delta-val">${F.fmt0(M.interested)}</div></div>
    </div>
    <div class="delta-grid" style="grid-template-columns:repeat(6,1fr)">
      <div class="delta"><div class="delta-label">${esc(t.cpConversation)}</div><div class="delta-val">${M.cost_per_conversation != null ? money(M.cost_per_conversation) : "—"}</div></div>
      <div class="delta"><div class="delta-label">${esc(t.cpInterested)}</div><div class="delta-val">${M.cost_per_interested != null ? money(M.cost_per_interested) : "—"}</div></div>
      <div class="delta"><div class="delta-label">${esc(t.cpClick)}</div><div class="delta-val">${M.cost_per_click != null ? money(M.cost_per_click) : "—"}</div></div>
      <div class="delta"><div class="delta-label">${esc(t.cpMille)}</div><div class="delta-val">${M.cost_per_1k_impressions != null ? money(M.cost_per_1k_impressions) : "—"}</div></div>
      <div class="delta"><div class="delta-label">${esc(t.newFollowers)}</div><div class="delta-val">—</div></div>
      <div class="delta"><div class="delta-label">${esc(t.cpFollower)}</div><div class="delta-val">—</div></div>
    </div>
    <p class="muted small">${esc(t.followersNote)}</p>` : "";

  const cadenceLabel = t[data.cadence] || t.weekly;
  const body = `
  <div class="header">
    <div><div class="brand">${esc(data.brand || "")}</div><h1>${esc(t.title)} — ${esc(cadenceLabel)}</h1><p class="muted small">${esc(cadenceLabel)} · ${esc(t.cadenceSub)}</p></div>
    <div class="meta">
      <div>${F.fmtDate(data.period?.since)} ${esc(t.to)} ${F.fmtDate(data.period?.until)}</div>
      <div>${esc(t.generatedAt)}: ${F.fmtDateTime(data.generatedAt)}</div>
    </div>
  </div>

  <h2>${esc(t.costTitle)}</h2>
  ${costHtml || `<p class="muted">${esc(t.noData)}</p>`}

  <div class="delta-grid" style="grid-template-columns:repeat(3,1fr)">
    <div class="delta"><div class="delta-label">${esc(t.activeCount)}</div><div class="delta-val">${F.fmt0(tot.active)}</div></div>
    <div class="delta"><div class="delta-label">${esc(t.totalSpend)}</div><div class="delta-val">${money(tot.spend)}</div></div>
    <div class="delta"><div class="delta-label">${esc(t.totalResults)}</div><div class="delta-val">${F.fmt0(tot.results)}</div></div>
  </div>

  <h2>${esc(t.overview)}</h2>
  ${tableHtml}

  <h2>${esc(t.details)}</h2>
  ${detailsHtml || `<p class="muted">${esc(t.noAi)}</p>`}

  <h2>${esc(t.hierarchy)}</h2>
  ${treeHtml}

  <h2>${esc(t.countries)}</h2>
  ${countriesHtml}

  <h2>${esc(t.staffContact)}</h2>
  ${staffHtml}

  <div class="footer-note">${esc(t.confidential)}</div>`;
  return htmlShell(lang, body);
}

export default { buildCampaignReportHtml };
