// Assign customer-type tags to a conversation: rules first, AI for the rest.
//
// This is a SEPARATE pass from the quality/compliance evaluation on purpose.
// Both read the same thread, but they answer different questions ("how well did
// the employee sell?" vs "who is this customer?"), they are reviewed by
// different people, and folding tags into the evaluation prompt would mean
// re-running — and re-paying for — 964 finished evaluations to add a tag list.
//
// The AI is given ~106 of the 294 tags and a rule it cannot talk its way around:
// only tag what the customer actually said. An inferred DEP_USD_25K_50K or a
// guessed COMP_KYC_VERIFIED is worse than no tag, because a report cannot tell a
// guess from a fact once it is a row in the database.
import ds from "./deepseek.js";
import { query } from "../db.js";
import { aiCategories, TAG_INDEX, exclusiveGroups, sourceOf } from "./tagTaxonomy.js";
import { ruleTags, segmentTag } from "./tagRules.js";

// Bump when the prompt or the vocabulary changes — that is what makes a re-tag
// detectable instead of silently mixing two generations of answers.
//
// NOT bumped for the ENG_OPTED_OUT tightening (rule 6b): it went in mid-run with
// 490 conversations already tagged, and re-running all of them to correct a rule
// that had produced exactly ONE arguable row would cost hours and a dollar for no
// real gain. Conversations tagged before that rule may therefore carry a slightly
// eager opt-out; they are reviewable on the tags page like any other. Bump the
// version whenever a change is bigger than that.
export const TAG_VERSION = "tag-1";

const isBot = (s) => String(s || "").trim().toLowerCase() === "bot";

/** The allowed vocabulary, grouped, with the exclusivity spelled out. */
function vocabulary() {
  return aiCategories().map((c) => {
    const one = c.exclusive === "all" ? " (اختر واحدة فقط)"
      : Array.isArray(c.exclusive) ? " (الحرارة: واحدة فقط)" : "";
    return `${c.name_ar}${one}:\n` + c.tags.map(([code, en, ar]) => `  ${code} — ${ar} / ${en}`).join("\n");
  }).join("\n\n");
}

const SYSTEM = `أنت محلّل بيانات عملاء في شركة وساطة مالية (IST Markets). مهمّتك الوحيدة: قراءة محادثة واتساب بين عميل وموظف مبيعات، وإسناد وسوم (tags) تصف **العميل** — من هو، وماذا يريد، وما مستواه، ولماذا انصرف إن انصرف.

القواعد التي لا تُخالَف:

1. **لا تسم إلا ما قاله العميل أو الموظف فعلاً.** إن لم تُذكر العملة الرقمية في المحادثة فلا تضع ASSET_CRYPTO لأن العميل «قد يكون» مهتماً بها. الوسم الخاطئ أسوأ من غياب الوسم، لأن التقرير لا يستطيع التمييز بين تخمين وحقيقة.
2. **لكل وسم دليل حرفي**: اقتباس مقتضب من المحادثة (بلغتها الأصلية) يبرّر الوسم. بلا اقتباس لا وسم.
3. **الثقة رقم صادق** بين 0 و1: 0.9+ إن صرّح العميل بذلك حرفياً، 0.7 إن كان استنتاجاً قوياً من كلامه، أقل من 0.6 إن كان ترجيحاً. لا تُبالغ في الثقة.
4. **النيّة ليست إنجازاً**: من قال «أريد فتح حساب حقيقي» نيّته INTENT_OPEN_LIVE — ولا يعني أنه فتحه. من قال «سأودع 5000 دولار» نيّته INTENT_DEPOSIT — ولا يعني أنه أودع. أرقام الإيداع الفعلية وحالة الحساب وحالة التحقّق من الهوية كلها مصادرها أنظمة أخرى، ولستَ مسؤولاً عنها ولا يجوز أن تخمّنها.
5. **الحرارة** (ENG_HOT / ENG_WARM / ENG_COLD) تُقاس من استعداده للخطوة التالية: من يسأل عن طريقة الإيداع الآن ساخن، ومن يقول «سأفكر» فاتر، ومن لا يردّ أو يرفض بارد.
6. **سبب الخسارة (LOST_*)** لا يوضع إلا إن ظهر السبب في المحادثة بكلام العميل — لا تخترع سبباً لأن المحادثة انتهت بلا نتيجة.
6ب. **ENG_OPTED_OUT و ENG_DO_NOT_WHATSAPP لهما وزن تشغيلي خاص**: وضعهما يمنع النظام من إدراج العميل في متابعة الموظف نهائياً. لا تضعهما إلا عند **طلب صريح بإيقاف المراسلة** («لا تراسلني»، «أزلني من القائمة»، «توقفوا عن الإرسال»). رفض مهذّب لعرض («لا شكراً»، «غير مهتم حالياً») ليس طلب إيقاف — ذاك ENG_COLD أو LOST_NOT_INTERESTED. الخطأ هنا يُفقد الشركة عميلاً قابلاً للاسترجاع بصمت.
7. **البونص (BONUS_*)** يُوسم بما عرضه الموظف صراحةً في رسالته، لا بما قد يستحقّه العميل.
8. استخدم **الرموز الحرفية** من القائمة فقط. أي رمز خارجها يُرفض ويُهمَل.
9. من الطبيعي أن تُخرج 3–8 وسوم لمحادثة عادية. محادثة من رسالتين قد لا تحتمل أكثر من وسم أو اثنين — وهذا مقبول. لا تملأ القائمة لتبدو مجتهداً.`;

function schemaHint() {
  return `أعِد JSON فقط بهذا الشكل:
{
 "tags": [
   { "tag": "الرمز الحرفي من القائمة", "confidence": رقم بين 0 و1, "evidence": "اقتباس حرفي مقتضب من المحادثة" }
 ],
 "customer_type": "وصف من سطر واحد لنمط هذا العميل بالعربية",
 "notes": "أي ملاحظة تخصّ تصنيف العميل، أو \\"\\" إن لا شيء"
}

=== الوسوم المتاحة (ولا شيء غيرها) ===
${vocabulary()}`;
}

function buildTranscript(thread) {
  const recent = thread.slice(-50);
  const lines = recent.map((m) => {
    const who = m.dir === "in" ? "العميل" : isBot(m.sender) ? "🤖 بوت" : `الموظف (${m.sender})`;
    return `${who}: ${m.body}`;
  });
  const prefix = thread.length > recent.length ? `(آخر ${recent.length} من ${thread.length} رسالة)\n` : "";
  return prefix + lines.join("\n");
}

/**
 * Keep only tags that are real, in the AI's vocabulary, and evidenced.
 *
 * Never throws: a malformed suggestion is dropped with a reason rather than
 * killing the whole conversation's tagging. `dropped` is returned so a bad
 * prompt shows up as a visible drop rate instead of as quiet under-tagging.
 */
export function validateAiTags(raw) {
  const kept = [];
  const dropped = [];
  const seen = new Set();

  for (const item of Array.isArray(raw?.tags) ? raw.tags : []) {
    const tag = String(item?.tag || "").trim().toUpperCase();
    const meta = TAG_INDEX.get(tag);
    if (!meta) { dropped.push({ tag, why: "unknown_tag" }); continue; }
    // The AI is only allowed the `ai` slice. A model that helpfully offers
    // STG_FUNDED is offering a fact it cannot possibly know.
    if (sourceOf(tag) !== "ai") { dropped.push({ tag, why: "not_ai_owned" }); continue; }
    const evidence = String(item?.evidence || "").trim();
    if (evidence.length < 3) { dropped.push({ tag, why: "no_evidence" }); continue; }
    const conf = Number(item?.confidence);
    if (!Number.isFinite(conf) || conf <= 0 || conf > 1) { dropped.push({ tag, why: "bad_confidence" }); continue; }
    if (seen.has(tag)) continue;
    seen.add(tag);
    kept.push({ tag, category: meta.category, confidence: Math.round(conf * 100) / 100, evidence: evidence.slice(0, 500) });
  }

  // Mutually-exclusive groups: keep the most confident, drop the rest. A
  // customer is not simultaneously a beginner and a professional, and letting
  // both through would make every count double.
  for (const group of exclusiveGroups()) {
    const inGroup = kept.filter((k) => group.includes(k.tag));
    if (inGroup.length < 2) continue;
    inGroup.sort((a, b) => b.confidence - a.confidence);
    for (const loser of inGroup.slice(1)) {
      dropped.push({ tag: loser.tag, why: `exclusive_with_${inGroup[0].tag}` });
      kept.splice(kept.indexOf(loser), 1);
    }
  }

  return { tags: kept, dropped, customer_type: String(raw?.customer_type || "").slice(0, 300) || null };
}

/** All of a customer's own words in one string — the rule engine's language input. */
const customerText = (thread) => thread.filter((m) => m.dir === "in").map((m) => m.body).join(" ").slice(0, 4000);

/**
 * Tag one conversation. `contact` carries the joined row the rules need; when
 * it is omitted it is loaded here.
 *
 * @returns { wa_id, rule: [...], ai: [...], dropped: [...], customer_type }
 */
export async function tagConversation(waId, { thread = null, contact = null, now = new Date(), useAi = true } = {}) {
  if (!thread) {
    const r = await query("select thread_snapshot from ads_conversation_analysis where wa_id=?", [waId]);
    const snap = r[0]?.thread_snapshot;
    thread = typeof snap === "string" ? JSON.parse(snap) : (snap || []);
  }
  if (!contact) [contact] = await query(
    `select c.wa_id, c.phone, c.country_iso2, c.source, c.source_ad_id, c.stage,
            p.campaign_name, m.human_replied, m.customer_msgs, m.last_dir, m.last_activity,
            e.qualification_score
     from ads_wati_contacts c
     left join ads_meta_ad_perf p on p.ad_id = c.source_ad_id
     left join ads_conversation_meta m on m.wa_id = c.wa_id
     left join ads_conversation_eval e on e.wa_id = c.wa_id
     where c.wa_id = ? limit 1`, [waId]);
  if (!contact) throw new Error("جهة الاتصال غير موجودة");

  const rules = ruleTags({ ...contact, customer_text: customerText(thread) }, now);

  let ai = [], dropped = [], customer_type = null;
  // Two messages carry no customer profile worth paying to read.
  if (useAi && thread.length >= 3) {
    const raw = await ds.chatJSON(SYSTEM, `${schemaHint()}\n\n=== نص المحادثة ===\n${buildTranscript(thread)}`, `tags:${waId}`);
    const v = validateAiTags(raw);
    ai = v.tags; dropped = v.dropped; customer_type = v.customer_type;
  }

  // SEG_* is composed from the AI's audience + experience answers, so it can
  // only be worked out once those exist.
  const seg = segmentTag([...rules, ...ai].map((x) => x.tag));
  if (seg) rules.push(seg);

  return { wa_id: waId, rule: rules, ai, dropped, customer_type };
}

/**
 * Persist a tagging result.
 *
 * A rule tag is recomputed exactly every run, so it is overwritten freely. An AI
 * tag is overwritten too — but never its review_status, so a supervisor's
 * confirm or reject survives every later re-tag. Rule tags that no longer apply
 * are deleted (a lead who finally replied is no longer ENG_NO_REPLY_48H);
 * AI tags are never auto-deleted, because "the AI didn't mention it this time"
 * is not evidence that it was wrong.
 */
export async function saveTags(result, { version = TAG_VERSION, model = null } = {}) {
  const rows = [
    ...result.rule.map((r) => ({ ...r, source: "rule", confidence: null })),
    ...result.ai.map((r) => ({ ...r, source: "ai" })),
  ];

  for (const r of rows) {
    await query(
      `insert into ads_conversation_tag (wa_id, tag, category, source, confidence, evidence, tag_version)
       values (?,?,?,?,?,?,?) as new
       on duplicate key update category=new.category, source=new.source,
         confidence=new.confidence, evidence=new.evidence, tag_version=new.tag_version,
         updated_at=now()`,
      [result.wa_id, r.tag, r.category, r.source, r.confidence ?? null, r.evidence || null, version]);
  }

  const liveRuleTags = result.rule.map((r) => r.tag);
  if (liveRuleTags.length) {
    await query(
      `delete from ads_conversation_tag
       where wa_id=? and source='rule' and tag not in (${liveRuleTags.map(() => "?").join(",")})`,
      [result.wa_id, ...liveRuleTags]);
  } else {
    await query("delete from ads_conversation_tag where wa_id=? and source='rule'", [result.wa_id]);
  }

  await query(
    `insert into ads_conversation_tag_run (wa_id, tag_version, tags_found, model)
     values (?,?,?,?) as new
     on duplicate key update tag_version=new.tag_version, tags_found=new.tags_found,
       model=new.model, tagged_at=now()`,
    [result.wa_id, version, rows.length, model]);

  return rows.length;
}

export default { tagConversation, saveTags, validateAiTags, TAG_VERSION };
