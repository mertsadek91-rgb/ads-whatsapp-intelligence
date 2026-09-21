// AI conversation analysis using DeepSeek. On-demand per conversation.
import * as wati from "./wati.js";
import * as ds from "./deepseek.js";
import * as meta from "./conversationMeta.js";
import { normalizeAgentName } from "./agentName.js";
import { getProfile, policyVersion } from "./businessProfile.js";
import {
  businessRules, complianceIntro, factsBlock, issueTypes, riskFlags,
  salesPatterns, nextStepKeys, clampPatternKey,
} from "./profileDerived.js";
import { validateEvaluation } from "./evalValidate.js";
import config from "../config.js";
import { query } from "../db.js";

// Bumped whenever the prompt below changes in a way that alters output, so a
// stored evaluation always says which prompt produced it.
export const PROMPT_VERSION = "eval-2";

const patternEnumHint = (p) => salesPatterns(p).map((x) => x.key).join(" | ");

// A contact's connected WhatsApp number, so getMessages reads the right one
// (?channelPhoneNumber). Null for legacy/unknown contacts (defaults to primary).
async function channelFor(waId) {
  const r = await query("select business_channel from ads_wati_contacts where wa_id = ?", [waId]);
  return r.length ? r[0].business_channel || null : null;
}

/**
 * The system prompt, built per call from the live business profile.
 *
 * It used to be a module-level template literal naming one company and one
 * industry, which meant the evaluator judged a clinic by a forex broker's
 * standards. What stays hardcoded here is the part that is genuinely universal
 * to WhatsApp lead flows rather than to any industry: a customer replying to an
 * automation is a weak signal, value only appears once a human answers, and a
 * customer who engaged and got no human reply is a MISSED OPPORTUNITY rather
 * than a hot lead. Everything domain-specific comes from the profile.
 */
function systemPrompt(p) {
  const company = p.identity?.company_name || "الشركة";
  const facts = factsBlock(p, "ar");
  return `أنت محلّل جودة ومبيعات خبير لدى "${company}".
نشاط الشركة: ${p.identity?.what_we_sell || ""}
تُحلّل محادثات واتساب بين موظفي المبيعات والعملاء المحتملين (Leads) باللغة العربية.
هدفك: تقييم المحادثة والعميل، وتقييم أداء الموظف بدقّة ومهنية وحياد.

قاعدة جوهرية في التقييم:
- رسائل "الرد الآلي (بوت)" ومجرّد رد العميل عليها (اختيار اللغة، الضغط على أزرار، تحية) **إشارة ضعيفة جداً** ولا تدل على اهتمام حقيقي.
- الاهتمام الحقيقي وقيمة المحادثة يظهران **فقط بعد تدخّل موظف مبيعات بشري** ومعرفة تفاصيل العميل وحاجته الحقيقية.
- إذا كانت المحادثة بوت فقط أو ردّ العميل على البوت دون متابعة بشرية حقيقية → اجعل "conversation_score" منخفضاً (≤ 40) مهما كان عدد الرسائل، وأضِف وسماً "لا متابعة بشرية".
- العميل الذي تفاعل ولم يصله رد بشري = **فرصة ضائعة** (سلبي يستوجب إعادة تواصل)، وليس عميلاً ساخناً.
- ارفع الدرجة فقط عندما يجري حوار بشري فعلي ويُبدي العميل اهتماماً أو يطلب خطوة تالية واضحة.

قيّم أيضاً افتتاح المحادثة ونقطة الانقطاع (إن وُجدت):
- افتتاح المحادثة = أول رد فعلي من موظف بشري (وليس البوت) على أول رسالة عميل. قيّمه weak إن قفز لطلب خطوة تالية دون فهم حاجة العميل أو شرح ما يناسبه، أو كان رداً عاماً غير مخصّص. قيّمه adequate/strong إن راعى نيّة العميل وشرح قبل الطلب.
- نقطة الانقطاع = إن توقّف العميل عن الرد بعد رسالة أظهر فيها اهتماماً أو سؤالاً حقيقياً، استخرج آخر رسالة له قبل التوقف وسبب الانقطاع المحتمل من سياق الحوار.
- عند رصد ضعف في الافتتاح أو سبب انقطاع، صنّفه ضمن هذه الفئات الثابتة فقط: ${patternEnumHint(p)}.
${facts ? facts + "\n" : ""}${businessRules(p, "ar")}
${complianceIntro(p, "ar")}
أعِد ردك بصيغة JSON فقط مطابقاً للمخطط، وبقيم نصية عربية مختصرة وواضحة.`;
}

function schemaHint(p) {
  return `أعِد JSON بهذا الشكل بالضبط:
{
 "conversation_score": رقم 0-100 (جودة المحادثة واحتمال التحويل),
 "lead_intent": "hot" أو "warm" أو "cold",
 "lead_status": "وصف قصير لحالة العميل (مثل: مهتم بحساب حقيقي / طلب معلومات / غير مهتم)",
 "summary": "ملخّص لما دار في المحادثة (2-4 جمل)",
 "customer": {
   "needs": "ما يريده العميل",
   "objections": "اعتراضاته أو مخاوفه",
   "deposit_intent": "yes" أو "no" أو "unknown",
   "account_type": "demo" أو "real" أو "unknown",
   "market_or_country": "إن ذُكر"
 },
 "agent": {
   "name": "اسم الموظف كما ظهر",
   "score": رقم 0-100 لأداء الموظف,
   "communication_style": "تقييم أسلوب التواصل",
   "response_speed": "تقييم سرعة الرد",
   "follow_up_quality": "تقييم المتابعة وجودتها",
   "wrong_persuasion": true أو false,
   "wrong_persuasion_examples": ["اقتباسات أو أمثلة إن وُجدت"],
   "policy_compliance": "مدى الالتزام بالسياسات وذكر المخاطر",
   "strengths": ["نقاط القوة"],
   "improvements": ["نصائح للتحسين"],
   "opening_quality": "weak" أو "adequate" أو "strong",
   "opening_excerpt": "اقتباس الرد الأول الفعلي للموظف البشري، أو null إن لا يوجد رد بشري",
   "opening_pattern_key": "${patternEnumHint(p)} — فقط إن كانت opening_quality=weak، وإلا null",
   "dropout_detected": true أو false,
   "dropout_point_excerpt": "اقتباس آخر رسالة عميل قبل توقّفه عن الرد، أو null إن dropout_detected=false",
   "dropout_pattern_key": "${patternEnumHint(p)} — فقط إن dropout_detected=true، وإلا null",
   "smart_reply_example": "رد بديل مُعاد كتابته بالعربية، دافئ ومطابق لقواعد العمل أعلاه، أو null إن لم يوجد ضعف افتتاح أو انقطاع"
 },
 "flags": ["وسوم قصيرة لأي مشكلات مثل: وعود مضمونة، تجاهل المخاطر، بطء متابعة"],
${evalSchemaAr(p)}
}`;
}

// The quality/compliance block, appended to the SAME request rather than sent as
// a second call: the transcript is the expensive part of the payload and sending
// it twice would double the cost for no gain in accuracy. It comes AFTER the
// interest fields on purpose — those are what the existing board depends on, so
// they stay at the front of the schema where the model is most reliable.
const evalSchemaAr = (p) => ` "employeeAnalysis": {
   "// مهم": "أي درجة لا ينطبق موضوعها على هذه المحادثة أعِدها null لا 0. الصفر يعني «أداء سيئ»، وnull تعني «لا مجال للتقييم». مثال: إن لم يبدِ العميل أي اعتراض فـobjectionHandlingScore = null.",
   "persuasionQualityScore": رقم 0-100 لجودة الإقناع عموماً,
   "complianceAccuracyScore": رقم 0-100 للالتزام والدقّة (ابدأ من 100 واخصم على مخالفات موثّقة فقط),
   "objectionHandlingScore": رقم 0-100 لمعالجة اعتراضات العميل، أو null إن لم يوجد اعتراض,
   "conversationContinuityScore": رقم 0-100 لتماسك الحوار وعدم تكرار ما أجاب عنه العميل,
   "professionalismScore": رقم 0-100 للأسلوب المهني,
   "nextStepQualityScore": رقم 0-100 لجودة توجيه العميل لخطوة تالية مناسبة,
   "classificationAccuracyScore": رقم 0-100 لدقّة تصنيف الموظف لحالة العميل، أو null إن لم يُصنّف
 },
 "customerAnalysis": {
   "intentScore": رقم 0-100 لقوة نيّة العميل,
   "qualificationScore": رقم 0-100 لتأهّل العميل (بلد مدعوم، رقم صحيح، حاجة تناسب الخدمة، ليس سبام),
   "engagementScore": رقم 0-100 لتفاعل العميل,
   "customerRiskFlags": ["فقط من هذه القائمة: ${riskFlags(p).map((f) => f.key).join(" | ")}"]
 },
 "conversationOutcome": {
   "nextStepReached": true أو false,
   "nextStepType": "فقط من هذه القائمة أو null: ${nextStepKeys(p).join(" | ")}",
   "conversationCompletedCorrectly": true إن أُجيب سؤال العميل الأساسي وصُنّفت حالته ولا توجد رسالة عميل بلا رد,
   "followUpRequired": true أو false
 },
 "issues": [
   {
     "type": "فقط من هذه القائمة: ${issueTypes(p).map((t) => t.key).join(" | ")}",
     "severity": "informational | minor | moderate | major | critical",
     "confidence": رقم بين 0 و1,
     "evidence": "اقتباس حرفي من رسالة الموظف — إن لم يوجد فلا تسجّل المخالفة",
     "employeeMessageId": null,
     "contextExplanation": "لماذا صُنّفت مخالفة",
     "recommendedAlternative": "الصياغة المتوافقة البديلة"
   }
 ],
 "analysisMetadata": {
   "confidence": رقم بين 0 و1 لثقتك في هذا التقييم كله,
   "conversationComplete": true أو false,
   "requiresHumanReview": true إن كانت هناك مخالفة حرجة أو حالة ملتبسة
 }`;

const isBot = (s) => String(s || "").trim().toLowerCase() === "bot";

function buildTranscript(thread) {
  const recent = thread.slice(-60); // cap for token cost
  const lines = recent.map((m) => {
    let who;
    if (m.dir === "in") who = "العميل";
    else if (isBot(m.sender)) who = "🤖 رد آلي (بوت)";
    else who = `موظف المبيعات (${m.sender})`;
    const t = m.ts ? new Date(m.ts).toISOString().replace("T", " ").slice(0, 16) : "";
    return `[${t}] ${who}: ${m.body}`;
  });
  const cust = thread.filter((m) => m.dir === "in").length;
  const human = thread.filter((m) => m.dir === "out" && !isBot(m.sender)).length;
  const bot = thread.filter((m) => m.dir === "out" && isBot(m.sender)).length;
  const meta = `\n\n[إحصاء: رسائل العميل=${cust}، ردود موظف بشري=${human}، ردود بوت آلي=${bot}]`;
  const prefix = thread.length > recent.length ? `(عُرضت آخر ${recent.length} من ${thread.length} رسالة)\n` : "";
  return prefix + lines.join("\n") + meta;
}

/** Average minutes between a customer message and the next agent reply. */
function computeFollowUp(thread) {
  const gaps = [];
  for (let i = 0; i < thread.length - 1; i++) {
    if (thread[i].dir === "in" && thread[i + 1].dir === "out" && thread[i].ts && thread[i + 1].ts) {
      const g = (new Date(thread[i + 1].ts) - new Date(thread[i].ts)) / 60000;
      if (g >= 0 && g < 60 * 24 * 7) gaps.push(g);
    }
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  return Math.round(gaps[Math.floor(gaps.length / 2)] * 10) / 10; // median
}

export async function analyze(waId, thread = null) {
  thread = thread || (await wati.getThread(waId, await channelFor(waId)));
  if (!thread.length) throw new Error("لا توجد رسائل لهذه المحادثة");
  await meta.syncOne(waId, thread); // keep engagement metrics + classification fresh
  const transcript = buildTranscript(thread);
  const followUp = computeFollowUp(thread);

  // Read the profile ONCE and thread the same object into both the prompt and
  // the validator, so an activation mid-run cannot produce a row whose prompt
  // and validator disagree about the vocabulary.
  const profile = getProfile();
  const user = `${schemaHint(profile)}\n\n=== نص المحادثة ===\n${transcript}`;
  const a = await ds.chatJSON(systemPrompt(profile), user, waId);

  const agent = a.agent || {};
  // Clamp the two pattern-classification fields to the fixed enum before
  // persisting (mirrors the lead_intent whitelist check above) — an LLM can
  // drift off-schema; warn distinctly from a genuine "other" classification
  // so that drift stays visible instead of silently vanishing into counts.
  for (const f of ["opening_pattern_key", "dropout_pattern_key"]) {
    const raw = agent[f];
    const clamped = clampPatternKey(profile, raw);
    if (raw != null && clamped === "other" && raw !== "other") {
      console.warn(`[conversationAnalysis] ${waId}: ${f} off-schema value coerced to "other":`, raw);
    }
    agent[f] = clamped;
  }
  // Store the CANONICAL agent name (normalized against the clean Wati
  // contact_owner vocabulary) so new rows are clean at rest — the AI's raw
  // extraction ("X و Y", bot/unknown spellings…) is still preserved inside
  // the `raw` JSON column, so nothing is lost.
  const owners = (await query(
    "select distinct contact_owner v from ads_wati_contacts where contact_owner is not null and contact_owner <> ''"
  )).map((r) => r.v);
  const row = {
    conv_score: clampInt(a.conversation_score),
    lead_intent: ["hot", "warm", "cold"].includes(a.lead_intent) ? a.lead_intent : null,
    lead_status: str(a.lead_status, 191),
    summary: str(a.summary, 4000),
    customer_details: a.customer || {},
    agent_name: str(agent.name ? normalizeAgentName(agent.name, owners) : null, 191),
    agent_score: clampInt(agent.score),
    agent_eval: agent,
    follow_up_min: followUp,
    wrong_persuasion: agent.wrong_persuasion ? 1 : 0,
    flags: a.flags || [],
    message_count: thread.length,
    model: "deepseek-chat",
    raw: a,
    // The exact thread this analysis was built from (BUG-018 fix) — makes
    // the stored result reproducible/auditable and lets a manager or the
    // employee themselves review the real conversation, not just the AI's
    // summary of it, for coaching purposes.
    thread_snapshot: thread,
  };

  await query(
    `insert into ads_conversation_analysis
       (wa_id, conv_score, lead_intent, lead_status, summary, customer_details, agent_name,
        agent_score, agent_eval, follow_up_min, wrong_persuasion, flags, message_count, model, raw, thread_snapshot)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     as new on duplicate key update
       conv_score=new.conv_score, lead_intent=new.lead_intent, lead_status=new.lead_status,
       summary=new.summary, customer_details=new.customer_details, agent_name=new.agent_name,
       agent_score=new.agent_score, agent_eval=new.agent_eval, follow_up_min=new.follow_up_min,
       wrong_persuasion=new.wrong_persuasion, flags=new.flags, message_count=new.message_count,
       model=new.model, raw=new.raw, thread_snapshot=new.thread_snapshot, analyzed_at=now()`,
    [waId, row.conv_score, row.lead_intent, row.lead_status, row.summary,
     JSON.stringify(row.customer_details), row.agent_name, row.agent_score,
     JSON.stringify(row.agent_eval), row.follow_up_min, row.wrong_persuasion,
     JSON.stringify(row.flags), row.message_count, row.model, JSON.stringify(row.raw),
     JSON.stringify(row.thread_snapshot)]
  );

  // The quality/compliance layer is stored SEPARATELY and never allowed to fail
  // the analysis: if the evaluation block is malformed or missing, the
  // interested-customer detection above has already been persisted and the board
  // simply has no quality score for this conversation yet.
  const evaluation = await persistEvaluation(waId, a, thread).catch((e) => {
    console.error(`[conversationAnalysis] ${waId}: evaluation not stored:`, e.message);
    return null;
  });

  return { wa_id: waId, ...row, evaluation };
}

/**
 * Validate the AI's evaluation block and upsert it into ads_conversation_eval +
 * ads_conversation_issue. Returns null when there was nothing usable to store.
 *
 * Issue rows upsert on (wa_id, policy_version, evidence_hash) and deliberately
 * do NOT write review_status — so a supervisor's confirm or reject survives
 * every later re-analysis of the same conversation.
 */
export async function persistEvaluation(waId, raw, thread = []) {
  // No evaluation block at all is not drift — it's a response from before this
  // schema existed (or a re-analysis of a stored `raw`). Stay silent; warn only
  // when a block IS present but something in it was unusable.
  const hasEvalBlock = raw && typeof raw === "object"
    && ["employeeAnalysis", "conversationOutcome", "issues", "analysisMetadata"].some((k) => raw[k] != null);
  if (!hasEvalBlock) return null;

  const threadIds = new Set(thread.map((m) => m && m.id).filter(Boolean));
  const { evaluation, issues, warnings } = validateEvaluation(raw, {
    waId, model: config.deepseek.model, promptVersion: PROMPT_VERSION,
    profile, policyVersion: policyVersion(),
    threadIds: threadIds.size ? threadIds : null,
  });
  if (warnings.length) console.warn(`[conversationAnalysis] ${waId}: eval warnings:`, warnings.join("; "));
  if (!evaluation) return null;

  await query(
    `insert into ads_conversation_eval
       (wa_id, policy_version, model, prompt_version,
        persuasion_score, compliance_score, objection_score, continuity_score,
        professionalism_score, next_step_score, classification_score,
        customer_intent_score, qualification_score, engagement_score, customer_risk_flags,
        next_step_reached, next_step_type, completed_correctly, follow_up_required,
        confidence, requires_human_review, warnings)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     as new on duplicate key update
       model=new.model, prompt_version=new.prompt_version,
       persuasion_score=new.persuasion_score, compliance_score=new.compliance_score,
       objection_score=new.objection_score, continuity_score=new.continuity_score,
       professionalism_score=new.professionalism_score, next_step_score=new.next_step_score,
       classification_score=new.classification_score,
       customer_intent_score=new.customer_intent_score, qualification_score=new.qualification_score,
       engagement_score=new.engagement_score, customer_risk_flags=new.customer_risk_flags,
       next_step_reached=new.next_step_reached, next_step_type=new.next_step_type,
       completed_correctly=new.completed_correctly, follow_up_required=new.follow_up_required,
       confidence=new.confidence, requires_human_review=new.requires_human_review,
       warnings=new.warnings, analyzed_at=now()`,
    [waId, evaluation.policy_version, evaluation.model, evaluation.prompt_version,
     evaluation.persuasion_score, evaluation.compliance_score, evaluation.objection_score,
     evaluation.continuity_score, evaluation.professionalism_score, evaluation.next_step_score,
     evaluation.classification_score, evaluation.customer_intent_score,
     evaluation.qualification_score, evaluation.engagement_score,
     JSON.stringify(evaluation.customer_risk_flags), evaluation.next_step_reached,
     evaluation.next_step_type, evaluation.completed_correctly, evaluation.follow_up_required,
     evaluation.confidence, evaluation.requires_human_review, JSON.stringify(warnings)]
  );

  for (const it of issues) {
    await query(
      `insert into ads_conversation_issue
         (wa_id, policy_version, type, severity, confidence, evidence, evidence_hash,
          employee_message_id, context_explanation, recommended_alternative)
       values (?,?,?,?,?,?,?,?,?,?)
       as new on duplicate key update
         severity=new.severity, confidence=new.confidence,
         context_explanation=new.context_explanation,
         recommended_alternative=new.recommended_alternative`,
      [it.wa_id, it.policy_version, it.type, it.severity, it.confidence, it.evidence,
       it.evidence_hash, it.employee_message_id, it.context_explanation, it.recommended_alternative]
    );
  }

  // Issues the model no longer reports are withdrawn — but only the ones a
  // supervisor never ruled on, so a confirmed violation is never quietly erased.
  const keep = issues.map((i) => i.evidence_hash);
  await query(
    `delete from ads_conversation_issue
     where wa_id = ? and policy_version = ? and review_status = 'pending'
       ${keep.length ? `and evidence_hash not in (${keep.map(() => "?").join(",")})` : ""}`,
    [waId, POLICY_VERSION, ...keep]
  );

  return { ...evaluation, issues, warnings };
}

/**
 * Score a thread and return the validated evaluation WITHOUT writing anything.
 *
 * This is what makes the model measurable: the calibration harness feeds it
 * known-answer conversations, so a prompt or model change can be scored instead
 * of argued about. Deliberately shares the exact SYSTEM prompt and validator the
 * production path uses — a harness that tests a different prompt measures nothing.
 */
export async function evaluateThread(thread, { waId = "calibration" } = {}) {
  if (!Array.isArray(thread) || !thread.length) throw new Error("thread is required");
  const profile = getProfile();
  const user = `${schemaHint(profile)}\n\n=== نص المحادثة ===\n${buildTranscript(thread)}`;
  const raw = await ds.chatJSON(systemPrompt(profile), user, waId);
  const { evaluation, issues, warnings } = validateEvaluation(raw, {
    waId, model: config.deepseek.model, promptVersion: PROMPT_VERSION,
    profile, policyVersion: policyVersion(),
  });
  return { evaluation, issues, warnings, raw };
}

export async function getAnalysis(waId) {
  const r = await query("select * from ads_conversation_analysis where wa_id=?", [waId]);
  return r[0] || null;
}

function clampInt(x) { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null; }
function str(x, max) { return x == null ? null : String(x).slice(0, max); }

export default { analyze, getAnalysis };
