// Knowledge Base (Q&A) — a self-learning store of the questions real customers
// ask, with compliant answers. generateKB() reads a sample of already-analyzed
// conversations (summaries + customer objections/needs) + the fixed business
// rules and asks DeepSeek (budget-guarded, ONE call) to distil the most common
// questions into bilingual Q&A pairs. Pairs are upserted by a hash of the
// normalized question so periodic re-runs MERGE (bumping times_seen) instead of
// duplicating — that accumulation is the "self-learning". Every generated pair
// lands as status='draft' for a human to approve here before it feeds a chatbot.
import { createHash } from "crypto";
import { query } from "../db.js";
import { businessContext } from "./promptContext.js";
import * as ds from "../lib/deepseek.js";
import { getProfile } from "./profileStore.js";
import { businessRules, kbCategoryKeys } from "./profileDerived.js";

// The buckets a question can fall into are this business’s, not a broker’s:
// "deposit / withdrawal / leverage" means nothing to a clinic.
export const kbCategories = () => kbCategoryKeys(getProfile());
const CAT_SET = () => new Set(kbCategories());
const clampCat = (c) => {
  const v = String(c || "").toLowerCase();
  const set = CAT_SET();
  return set.has(v) ? v : (set.has("general") ? "general" : [...set][0] || "general");
};

const normalizeQ = (q) => String(q || "").toLowerCase().replace(/\s+/g, " ").replace(/[؟?.!،,]+$/g, "").trim();
export const qHash = (q) => createHash("sha1").update(normalizeQ(q)).digest("hex");

/** Upsert one Q&A row keyed by (q_hash, lang); bumps times_seen on a repeat. */
async function upsertPair({ question, answer, category, lang, source, status }) {
  const h = qHash(question);
  if (!question.trim() || !answer.trim()) return { skipped: true };
  await query(
    `insert into ads_kb_qa (q_hash, question, answer, category, lang, source, status, times_seen)
     values (?,?,?,?,?,?,?,1) on duplicate key update
       times_seen = ads_kb_qa.times_seen + 1,
       -- refresh AI-authored drafts on re-generation; never clobber a human's
       -- edits or an approved answer.
       answer = case when ads_kb_qa.source='ai' and ads_kb_qa.status='draft' then values(answer) else ads_kb_qa.answer end,
       category = case when ads_kb_qa.source='ai' and ads_kb_qa.status='draft' then values(category) else ads_kb_qa.category end,
       updated_at = now()`,
    [h, question.trim(), answer.trim(), clampCat(category), lang === "en" ? "en" : "ar", source || "ai", status || "draft"]);
  return { hash: h };
}

/**
 * Generate/refresh Q&A drafts from recent analyzed conversations. Budget-guarded
 * (one DeepSeek call). Returns { sampled, pairs, upserted }.
 */
export async function generateKB({ limit = 150, now = new Date() } = {}) {
  if (!ds.hasKey()) throw new Error("لا يوجد مفتاح DeepSeek — لا يمكن توليد قاعدة المعرفة");
  // Sample recent conversations that actually contain customer substance.
  const rows = await query(
    `select summary, customer_details, lead_status
     from ads_conversation_analysis
     where summary is not null and summary <> ''
     order by analyzed_at desc limit ?`, [Math.min(400, Math.max(20, limit))]);
  if (!rows.length) return { sampled: 0, pairs: 0, upserted: 0 };

  // Compact the sample: keep just the customer's needs/objections + status,
  // not whole threads — keeps the prompt (and cost) small.
  const sample = rows.slice(0, 200).map((r) => {
    let d = r.customer_details;
    if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = null; } }
    return {
      status: r.lead_status || null,
      needs: d?.needs || d?.interests || null,
      objections: d?.objections || d?.concerns || null,
      questions: d?.questions || null,
      summary: String(r.summary).slice(0, 240),
    };
  });

  const system = `${businessContext("ar")}
أنت خبير امتثال ومحتوى لهذه الشركة. مهمّتك: من عيّنة محادثات عملاء حقيقية، استخرج أكثر الأسئلة تكراراً التي يطرحها العملاء، واكتب لكل سؤال إجابة نموذجية دقيقة ومتوافقة.
قواعد العمل الثابتة (التزم بها حرفياً):
${businessRules(getProfile(), "ar")}
${businessRules(getProfile(), "en")}
قيود صارمة على الإجابات: لا تَعِد بأي ربح أو عوائد؛ اذكر أن التداول ينطوي على مخاطر وقد يخسر رأس المال؛ لا تقدّم نصيحة استثمارية شخصية؛ الدورات التدريبية تأتي بعد فتح الحساب؛ كن موجزاً ومهنياً.
أعِد JSON فقط بالشكل: {"pairs":[{"category":"${kbCategories().join("|")}","question_ar":"..","answer_ar":"..","question_en":"..","answer_en":".."}]}.
أنتج حتى 12 زوجاً للأسئلة الأكثر تكراراً وأهمية فقط. استند للعيّنة فقط، لا تختلق أسئلة غير موجودة.`;
  const user = JSON.stringify({ sample_size: sample.length, conversations: sample });
  const raw = await ds.chatJSON(system, user, "kb-generate");
  const pairs = Array.isArray(raw?.pairs) ? raw.pairs.slice(0, 20) : [];

  let upserted = 0;
  for (const p of pairs) {
    const cat = clampCat(p.category);
    if (p.question_ar && p.answer_ar) { await upsertPair({ question: p.question_ar, answer: p.answer_ar, category: cat, lang: "ar", source: "ai", status: "draft" }); upserted++; }
    if (p.question_en && p.answer_en) { await upsertPair({ question: p.question_en, answer: p.answer_en, category: cat, lang: "en", source: "ai", status: "draft" }); upserted++; }
  }
  return { sampled: sample.length, pairs: pairs.length, upserted };
}

// ---- CRUD used by the review page ----
export async function listKB({ status, category, lang, q } = {}) {
  const where = [], params = [];
  if (status) { where.push("status = ?"); params.push(status); }
  if (category) { where.push("category = ?"); params.push(category); }
  if (lang) { where.push("lang = ?"); params.push(lang); }
  if (q) { where.push("(question like ? or answer like ?)"); params.push(`%${q}%`, `%${q}%`); }
  const sql = `select id, question, answer, category, lang, source, status, times_seen, created_at, updated_at
    from ads_kb_qa ${where.length ? "where " + where.join(" and ") : ""}
    order by (status='draft') desc, times_seen desc, updated_at desc limit 500`;
  return query(sql, params);
}

export async function kbStats() {
  const [r] = await query(
    "select count(*) total, " +
    "sum(status='approved') approved, sum(status='draft') draft, " +
    "sum(source='ai') `ai`, sum(source='manual') `manual` " +
    "from ads_kb_qa");
  return { total: Number(r?.total || 0), approved: Number(r?.approved || 0), draft: Number(r?.draft || 0),
    ai: Number(r?.ai || 0), manual: Number(r?.manual || 0) };
}

export async function createManual({ question, answer, category, lang }) {
  if (!question?.trim() || !answer?.trim()) throw new Error("السؤال والإجابة مطلوبان");
  await upsertPair({ question, answer, category, lang, source: "manual", status: "approved" });
  return { ok: true };
}

export async function updateKB(id, { question, answer, category, status }) {
  const sets = [], params = [];
  if (question != null) { sets.push("question = ?", "q_hash = ?"); params.push(String(question).trim(), qHash(question)); }
  if (answer != null) { sets.push("answer = ?"); params.push(String(answer).trim()); }
  if (category != null) { sets.push("category = ?"); params.push(clampCat(category)); }
  if (status != null && ["draft", "approved"].includes(status)) { sets.push("status = ?"); params.push(status); }
  if (!sets.length) return { ok: false, reason: "nothing-to-update" };
  sets.push("updated_at = now()");
  params.push(id);
  await query(`update ads_kb_qa set ${sets.join(", ")} where id = ?`, params);
  return { ok: true };
}

export async function deleteKB(id) {
  await query("delete from ads_kb_qa where id = ?", [id]);
  return { ok: true };
}

export default { generateKB, listKB, kbStats, createManual, updateKB, deleteKB, qHash, kbCategories };
