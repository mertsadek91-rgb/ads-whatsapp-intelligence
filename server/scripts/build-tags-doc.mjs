// Generates docs/tags-reference.html from tagTaxonomy.js.
//
// Generated rather than written by hand for one reason: a tag reference that
// disagrees with the code is worse than none, because someone will trust it.
// Re-run after any change to the taxonomy.
//
//   node scripts/build-tags-doc.mjs
import { writeFileSync } from "fs";
import { CATEGORIES, TAG_INDEX, DEPARTMENTS } from "../src/lib/tagTaxonomy.js";

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const SRC = {
  ai: { ar: "ذكاء اصطناعي", en: "AI", cls: "s-ai" },
  rule: { ar: "قاعدة محسوبة", en: "Computed rule", cls: "s-rule" },
  external: { ar: "نظام آخر", en: "Other system", cls: "s-ext" },
  manual: { ar: "يدوي فقط", en: "Manual only", cls: "s-man" },
};

const added = [...TAG_INDEX.values()].filter((t) => t.added).length;
const sheet = TAG_INDEX.size - added;
const counts = { ai: 0, rule: 0, external: 0, manual: 0 };
for (const t of TAG_INDEX.values()) counts[t.source]++;

const rows = CATEGORIES.map((c) => {
  const tags = c.tags.map(([code, en, ar]) => {
    const t = TAG_INDEX.get(code);
    const s = SRC[t.source];
    // Tags this app added on top of the owner's sheet are marked, because they do
    // not exist in Wati yet — creating them there is the owner's decision.
    const mark = t.added ? ' <span class="pill s-new">مُضاف · added</span>' : "";
    return `<tr><td class="code">${esc(code)}</td><td>${esc(ar)}${mark}</td><td dir="ltr">${esc(en)}</td>
      <td><span class="pill ${s.cls}">${s.ar} · ${s.en}</span></td></tr>`;
  }).join("\n");
  const s = SRC[c.source];
  return `<section>
  <h3>${esc(c.name_ar)} <span dir="ltr">· ${esc(c.name_en)}</span>
    <span class="pill ${s.cls}">${s.ar} · ${s.en}</span>
    <span class="n">${c.tags.length}</span></h3>
  <p class="meta">${esc(DEPARTMENTS[c.dept].ar)} / ${esc(DEPARTMENTS[c.dept].en)} —
     <span dir="ltr">${esc(c.platform)}</span>${c.exclusive === "all" ? " — <b>وسم واحد فقط لكل عميل / one tag per customer</b>" : ""}</p>
  ${c.why_ar ? `<p class="why">${esc(c.why_ar)}</p>` : ""}
  <table><thead><tr><th>الرمز / Code</th><th>عربي</th><th>English</th><th>المصدر / Source</th></tr></thead>
  <tbody>${tags}</tbody></table>
</section>`;
}).join("\n");

const html = `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>وسوم العملاء — المرجع الكامل · Customer Tags Reference</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{--ink:#0F172A;--muted:#64748B;--line:#E2E8F0;--bg:#F8FAFC;--brand:#4F46E5}
  *{box-sizing:border-box}
  body{margin:0;padding:24px;font:14px/1.7 "Segoe UI",Tahoma,system-ui,sans-serif;color:var(--ink);background:var(--bg)}
  .wrap{max-width:1040px;margin:0 auto}
  h1{font-size:24px;margin:0 0 4px} h2{font-size:18px;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--line)}
  h3{font-size:15px;margin:0 0 4px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  h3 span[dir=ltr]{color:var(--muted);font-weight:400}
  .lede{color:var(--muted);margin:0 0 20px}
  section{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:14px}
  .meta{color:var(--muted);font-size:12px;margin:0 0 6px}
  .why{margin:0 0 10px;font-size:13px;background:#F1F5F9;border-radius:6px;padding:8px 10px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:start;padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  th{background:#F1F5F9;font-size:12px;color:var(--muted);font-weight:600}
  td.code{font-family:ui-monospace,Consolas,monospace;font-size:12px;direction:ltr;white-space:nowrap}
  .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
  .s-ai{background:#FEF3C7;color:#92400E} .s-rule{background:#DCFCE7;color:#15803D}
  .s-ext{background:#E2E8F0;color:#475569} .s-man{background:#FEE2E2;color:#B91C1C}
  .s-new{background:#E0E7FF;color:#3730A3}
  .n{margin-inline-start:auto;color:var(--muted);font-size:12px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:22px}
  .card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px}
  .card b{display:block;font-size:22px;line-height:1.2}
  .card span{color:var(--muted);font-size:12px}
  .box{background:#fff;border:1px solid var(--line);border-inline-start:4px solid var(--brand);
       border-radius:8px;padding:12px 14px;margin-bottom:14px}
  .box p{margin:0 0 8px} .box p:last-child{margin:0}
  code{background:#F1F5F9;padding:1px 5px;border-radius:4px;font-size:12px;direction:ltr;display:inline-block}
</style></head><body><div class="wrap">

<h1>وسوم العملاء — المرجع الكامل</h1>
<p class="lede" dir="ltr">Customer tags — full reference. ${TAG_INDEX.size} tags in ${CATEGORIES.length} categories
 (${sheet} from the cheat sheet + ${added} country tags added on top of it).</p>

<div class="cards">
  <div class="card"><b>${TAG_INDEX.size}</b><span>إجمالي الوسوم / total tags</span></div>
  <div class="card"><b>${counts.ai}</b><span>يسندها الذكاء الاصطناعي / assigned by AI</span></div>
  <div class="card"><b>${counts.rule}</b><span>تُحسب من بياناتنا / computed from our data</span></div>
  <div class="card"><b>${counts.external}</b><span>مصدرها نظام آخر / owned elsewhere</span></div>
  <div class="card"><b>${added}</b><span>وسوم دول أُضيفت / country tags added</span></div>
</div>

<div class="box">
  <p><b>دول أُضيفت فوق الشيت.</b> الشيت يعرّف 24 دولة، وعملاؤكم من أكثر منها:
  الجزائر وحدها 780 جهة اتصال، والعراق 664، واليمن 365 — أي أكثر من معظم الدول التي <i>يغطّيها</i> الشيت.
  أضفنا وسم دولة لكل دولة يمكن تحديدها من مقدّمة الهاتف (${added} وسماً، معلَّمة
  <span class="pill s-new">مُضاف · added</span>)، فلا يبقى عميل بمنطقة بلا دولة.
  هذه الرموز <b>غير موجودة في Wati بعد</b> — إنشاؤها هناك قرارك.</p>
  <p dir="ltr"><b>Countries added on top of the sheet.</b> The sheet defines 24 countries; your leads come from
  more. Algeria alone is 780 contacts, Iraq 664, Yemen 365 — between them more leads than most of the countries
  the sheet <i>does</i> cover. Every country identifiable from the phone dial code now has a tag
  (${added} of them, marked <span class="pill s-new">added</span>), so no lead is left with a region and no
  country. These codes <b>do not exist in Wati yet</b> — creating them there is your call.</p>
</div>

<div class="box">
  <p><b>لماذا لا يُسند الذكاء الاصطناعي كل الوسوم؟</b> لأن الوسم لا يصحّ إلا بقدر صحّة النظام الذي يعرف الجواب.
  حجم الإيداع وحالة التحقّق من الهوية وحجم التداول والعقود الموقَّعة لا يظهر منها شيء في محادثة واتساب،
  ووسم <code>DEP_USD_25K_50K</code> مُخمَّن على عميل لم يودع شيئاً لا يمكن لأي تقرير أن يميّزه عن وسم حقيقي.
  لذلك: ما يمكن حسابه بدقّة نحسبه، وما يظهر في كلام العميل يستنتجه الذكاء الاصطناعي مع اقتباس حرفي يبرّره،
  وما مصدره منصّة التداول أو نظام الالتزام أو نظام الشراكات لا نكتبه إطلاقاً.</p>
  <p dir="ltr"><b>Why doesn't the AI assign every tag?</b> A tag is only as trustworthy as the system that
  knows the answer. Deposit size, KYC state, traded volume and signed contracts leave no trace in a WhatsApp
  thread, and a guessed <code>DEP_USD_25K_50K</code> on a customer who deposited nothing is indistinguishable
  from a real one in every report built on top of it. So: what can be computed exactly is computed, what shows
  in the customer's own words is inferred by AI with a verbatim quote behind it, and anything owned by the
  trading platform, the compliance system or the partner CRM is never written by us.</p>
</div>

<div class="box">
  <p><b>ماذا يعني كل مصدر؟</b></p>
  <p><span class="pill s-ai">ذكاء اصطناعي</span> يُستنتج من نصّ المحادثة، ومعه اقتباس حرفي ودرجة ثقة،
     وقابل للتأكيد أو الرفض من المشرف. الوسم المرفوض يختفي من كل الفلاتر ويبقى محفوظاً كإشارة تدريب.</p>
  <p><span class="pill s-rule">قاعدة محسوبة</span> يُحسب من بيانات نملكها (مقدّمة الهاتف، الإعلان المصدر،
     أوقات الرسائل)، فهو دقيق ولا يحتاج مراجعة، ويُعاد حسابه في كل تشغيل — فالعميل الذي ردّ أخيراً
     يفقد وسم «لا ردّ منذ 48 ساعة» تلقائياً.</p>
  <p><span class="pill s-ext">نظام آخر</span> مصدره منصّة التداول أو نظام الالتزام أو نظام الشراكات.
     يظهر في هذه الصفحة للاكتمال، ويبقى عدده صفراً حتى تبدأ تلك الأنظمة بالكتابة إلى Wati.</p>
  <p><span class="pill s-man">يدوي فقط</span> قرار بشري له تبعات، لا يتّخذه نموذج.</p>
</div>

<h2>الفئات والوسوم / Categories &amp; tags</h2>
${rows}

<p class="lede" style="margin-top:20px">
  مولَّد من <code>APP/server/src/lib/tagTaxonomy.js</code> — لا يُحرَّر يدوياً.<br>
  <span dir="ltr">Generated from the taxonomy module; do not edit by hand.</span>
</p>
</div></body></html>`;

const out = new URL("../../../docs/tags-reference.html", import.meta.url);
writeFileSync(out, html, "utf8");
console.log(`wrote ${out.pathname} · ${TAG_INDEX.size} tags · ${CATEGORIES.length} categories`);
