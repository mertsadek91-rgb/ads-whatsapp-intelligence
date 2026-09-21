// Generate a business profile from the company's own website and description.
//
// Three AI calls, not one. The website corpus is the expensive part of the
// payload and is sent once; the two follow-ups are given only the short summary
// they need. A single call producing a ~300-line JSON document has a materially
// higher malformed-output rate than three producing ~80 lines each, and a
// failure on the third still leaves a usable profile from the first two.
//
// The rule that matters most is about facts: the model may only state a
// regulatory or legal fact if it can QUOTE the page it came from. Inventing a
// licence number is the single worst thing this generator could do, because the
// whole point of company facts is to give the evaluator something factual to
// check an agent's claims against — a fabricated one would make it confidently
// wrong in both directions.
import * as ds from "./deepseek.js";
import { fetchSiteCorpus } from "./siteFetch.js";
import { validateProfile, CORE_ISSUE_TYPES } from "./profileSchema.js";
import { GENERIC_PROFILE } from "../profiles/generic.js";
import { SEVERITIES, SOURCES } from "./profileConstants.js";

// Leave room for the day's real work: the wizard must never eat the analysis
// budget on its way in.
export const BUDGET_RESERVE_USD = 0.5;

const sevList = SEVERITIES.join(" | ");

function identityPrompt(lang) {
  const coreKeys = CORE_ISSUE_TYPES.map((t) => t.key).join(", ");
  return `You are setting up a conversation-quality system for a specific business.
You are given text from that company's own website plus a description written by
its owner. Produce the vocabulary the system will use to judge WhatsApp sales
conversations in THIS industry.

TWO DESIGN RULES, both load-bearing:

1. Issue types are a FIXED ENUM, never free text. A model that writes its reason
   in prose never string-matches across calls — "did not mention the risk" and
   "omitted the warning" are one issue worded twice — which silently breaks
   every count built on top of them. So: short snake_case keys, reused exactly.

2. The presence of a word is NOT a violation. "We cannot guarantee the outcome"
   is not a promise of an outcome, even though it contains the same words. Your
   compliance_intro text MUST contain at least two worked pairs IN THIS
   INDUSTRY'S OWN WORDS: one phrasing that IS a violation, and one that uses the
   same vocabulary correctly and is not.

FACTS: only state a company fact (licence, regulator, registration, guarantee,
certification) if you can quote the exact sentence from the supplied text that
says it. Put that sentence verbatim in "evidence" and set source to "website".
If you cannot quote it, you MUST set source to "unverified" and evidence to null.
Never invent a number, a regulator, or a licence.

These ten issue types are universal and are added automatically, so do NOT
repeat them: ${coreKeys}. Add 4-10 types that are specific to THIS industry —
what a salesperson in this business could say that would be misleading, unsafe,
or outside their competence.

Return JSON only, in this exact shape. Write all ar fields in Arabic and all en
fields in English regardless of the language of the source material:
{
 "identity": {
   "company_name": "...", "what_we_sell": "one paragraph",
   "industry_key": "snake_case", "audience": "...",
   "restricted_markets": ["ISO-2 codes, or empty"],
   "facts": [{"key":"snake_case","label_ar":"..","label_en":"..","value":"..",
              "verification":"how a customer could check it",
              "evidence":"verbatim quote or null","source":"website|operator|unverified"}]
 },
 "rules": {
   "business_rules_ar":"numbered rules an agent must follow, in Arabic",
   "business_rules_en":"the same in English",
   "discovery_playbook_ar":["step", "..."], "discovery_playbook_en":["step", "..."],
   "compliance_intro_ar":"the keyword-is-not-a-violation guidance with 2+ worked pairs, Arabic",
   "compliance_intro_en":"the same in English"
 },
 "issue_types":[{"key":"snake_case","default_severity":"${sevList}","ar":"..","en":".."}],
 "customer_risk_flags":[{"key":"snake_case","ar":"..","en":".."}],
 "sales_patterns":[{"key":"snake_case","ar":"..","en":".."}],
 "next_steps":[{"key":"snake_case","ar":"..","en":"..","real_progress":true,
                "counts_as_registration":false,"counts_as_conversion":false}],
 "lifecycle":{"stages":[{"key":"snake_case","ar":"..","en":"..","weight":5,
               "aliases":["CRM stage names an agent might set"],
               "counts_as_qualified":false,"counts_as_converted":false}],
   "conversion_noun_ar":"..","conversion_noun_en":"..","trial_noun_ar":"..","trial_noun_en":".."},
 "kb_categories":[{"key":"snake_case","ar":"..","en":".."}]
}
customer_risk_flags describe the CUSTOMER and must never cost the employee
points — they exist to route a conversation to the right approved response.
Exactly one next step must have counts_as_conversion true, and exactly one
lifecycle stage must have counts_as_converted true: the moment this business
considers someone a customer.
Reply in ${lang === "en" ? "English" : "Arabic"} where the schema says so.`;
}

function tagsPrompt() {
  return `Design a customer tag taxonomy for the business described below.

The critical decision for every category is its SOURCE, and getting it wrong is
worse than omitting the category entirely:

  "ai"       — ${SOURCES.ai.why_en}
  "rule"     — ${SOURCES.rule.why_en}
  "external" — ${SOURCES.external.why_en}

If the truth lives in ANY system other than the WhatsApp conversation — a
booking system, a payment processor, a CRM, a clinic record — the category is
"external" and the AI must never assign it. A guessed value would be
indistinguishable from a real one and would corrupt every report built on it.
Coverage is not the goal; being right is.

Produce 8-14 categories and 60-140 tags total. Tag codes are SHORT_UPPER_SNAKE.
Set "exclusive":"all" for a category where at most one tag can be true at once.

Return JSON only:
{"categories":[{"key":"snake_case","source":"ai|rule|external","dept":"sales|mkt|ops|comp|auto",
  "platform":"which system owns it, or empty","name_ar":"..","name_en":"..",
  "why_ar":"why this source was chosen","exclusive":"all or null",
  "tags":[["CODE","English label","التسمية العربية"]]}]}`;
}

function calibrationPrompt() {
  return `Write calibration conversations that test whether an automated evaluator
judges this industry correctly. The STRUCTURE below is what makes them useful —
follow it exactly:

  - For each of the most severe issue types, a PAIR: one short conversation that
    genuinely commits it, and one that uses the SAME vocabulary correctly and
    commits nothing. The pair is what measures over-sensitivity, which is the
    failure that actually happens in production.
  - One textbook-clean conversation expecting zero findings. If that one gets
    flagged, the evaluator is over-sensitive and every score is depressed.
  - One where the CUSTOMER raises the risky idea and the agent handles it
    properly: expect a customer risk flag and zero employee findings.
  - One where the agent says something wrong and then corrects themselves in the
    next message: expect a softened severity, not a full finding.

Keep each conversation to 4-8 messages. Write them in Arabic.

Return JSON only:
{"cases":[{"id":"snake_case","why":"what this case is testing",
  "thread":[{"dir":"in|out","sender":"العميل|موظف","body":".."}],
  "expect":{"issues":["issue_type_key"],"absent":["issue_type_key"],
            "flags":["risk_flag_key"],"softer":false}}]}`;
}

const summarise = (p) => JSON.stringify({
  company: p.identity?.company_name,
  what_we_sell: p.identity?.what_we_sell,
  industry: p.identity?.industry_key,
  audience: p.identity?.audience,
  lifecycle: (p.lifecycle?.stages || []).map((s) => s.key),
  issue_types: (p.issue_types || []).map((t) => `${t.key}:${t.default_severity}`),
});

/**
 * generateBusinessProfile({ websiteUrl, description, language })
 *   -> { profile, evidence, warnings, repairs, errors, costUsd }
 *
 * Never throws for an unreadable website: it falls back to the operator's
 * description alone and says so, because a company behind Cloudflare is not a
 * company that cannot use the product.
 */
export async function generateBusinessProfile({ websiteUrl, description, language = "ar" } = {}) {
  if (!ds.hasKey()) throw new Error("لا يوجد مفتاح للذكاء الاصطناعي (no AI key configured)");

  const warnings = [];
  let corpus = { pages: [], totalChars: 0, warnings: [] };
  if (websiteUrl) {
    const url = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
    try {
      corpus = await fetchSiteCorpus(url);
      warnings.push(...corpus.warnings);
    } catch (e) {
      // A refused internal address is a hard error; anything else degrades.
      if (/SITE_PRIVATE_ADDRESS/.test(e.message)) throw e;
      warnings.push("SITE_UNREACHABLE");
    }
  } else {
    warnings.push("SITE_UNREACHABLE");
  }

  const sourceText = [
    `OWNER'S DESCRIPTION:\n${description || ""}`,
    corpus.pages.length
      ? `WEBSITE TEXT:\n${corpus.pages.map((p) => `--- ${p.url} (${p.title}) ---\n${p.text}`).join("\n\n")}`
      : "WEBSITE TEXT: (the site could not be read — rely on the description alone, and mark every fact unverified)",
  ].join("\n\n");

  // Call 1 — identity, rules, and every enum. The corpus goes here only.
  const base = await ds.chatJSON(identityPrompt(language), sourceText, "profilegen:identity");

  const draft = {
    ...GENERIC_PROFILE,
    language,
    identity: { ...GENERIC_PROFILE.identity, ...(base.identity || {}) },
    rules: { ...GENERIC_PROFILE.rules, ...(base.rules || {}) },
    issue_types: base.issue_types || [],
    customer_risk_flags: base.customer_risk_flags || GENERIC_PROFILE.customer_risk_flags,
    sales_patterns: base.sales_patterns || GENERIC_PROFILE.sales_patterns,
    next_steps: base.next_steps?.length ? base.next_steps : GENERIC_PROFILE.next_steps,
    lifecycle: base.lifecycle?.stages?.length ? base.lifecycle : GENERIC_PROFILE.lifecycle,
    kb_categories: base.kb_categories?.length ? base.kb_categories : GENERIC_PROFILE.kb_categories,
  };

  // Call 2 — tags, given only the short summary, not the corpus again.
  try {
    const tags = await ds.chatJSON(tagsPrompt(), summarise(draft), "profilegen:tags");
    if (tags?.categories?.length) draft.tags = { categories: tags.categories };
  } catch (e) {
    warnings.push("TAGS_GENERATION_FAILED");
    console.warn("[profilegen] tag generation failed, keeping the generic taxonomy:", e.message);
  }

  // Call 3 — calibration cases. A failure here still leaves a usable profile.
  try {
    const cal = await ds.chatJSON(calibrationPrompt(),
      JSON.stringify({ issue_types: draft.issue_types, risk_flags: draft.customer_risk_flags }),
      "profilegen:calibration");
    if (Array.isArray(cal?.cases)) draft.calibration_cases = cal.cases;
  } catch (e) {
    warnings.push("CALIBRATION_GENERATION_FAILED");
    console.warn("[profilegen] calibration generation failed:", e.message);
  }

  const { profile, errors, repairs } = validateProfile(draft, { repair: true });

  return {
    profile,
    errors,
    repairs,
    warnings: [...new Set(warnings)],
    evidence: {
      website_url: websiteUrl || null,
      pages_fetched: corpus.pages.map((p) => ({ url: p.url, title: p.title, chars: p.chars })),
      chars_read: corpus.totalChars,
      language,
      generated_at: new Date().toISOString(),
    },
  };
}

export default { generateBusinessProfile, BUDGET_RESERVE_USD };

/**
 * Read the company's website and write the business description FOR the
 * operator, so the hardest field in the installer starts filled in.
 *
 * "Describe your business in 3-5 lines" is the step people stall on, and a
 * thin description is the single biggest cause of a thin profile — the model
 * has nothing to generalise from and starts inventing. The site already says
 * what the business does; asking a human to retype it is asking them to do the
 * worse job of the two.
 *
 * Returned as a DRAFT for editing, never applied silently: the operator knows
 * things the website does not say, and the description is what the whole
 * evaluation is built on.
 *
 * Degrades honestly without an AI key: the extracted page text is returned so
 * there is still raw material to edit, clearly marked as not summarised.
 */
export async function fetchBusinessFromSite(websiteUrl, { language = "ar" } = {}) {
  if (!websiteUrl) throw new Error("عنوان الموقع مطلوب (a website URL is required)");
  const url = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;

  const corpus = await fetchSiteCorpus(url);
  const warnings = [...corpus.warnings];

  if (!corpus.pages.length) {
    return { ok: false, warnings, pages: [], draft: null };
  }

  const pagesRead = corpus.pages.map((p) => ({ url: p.url, title: p.title, chars: p.chars }));
  const raw = corpus.pages.map((p) => `--- ${p.url} (${p.title}) ---\n${p.text}`).join("\n\n");

  if (!ds.hasKey()) {
    // No key: hand back what was actually read rather than nothing. Marked so
    // the UI does not present raw page text as if it were a summary.
    warnings.push("AI_KEY_MISSING");
    return {
      ok: true, warnings, pages: pagesRead, summarised: false,
      draft: {
        company_name: corpus.pages[0].title || "",
        description: raw.slice(0, 1500),
        audience: "",
      },
    };
  }

  const system = `You are reading a company's own website to describe what the business does,
for someone setting up a system that will judge their sales conversations.

Write the description in ${language === "en" ? "English" : "Arabic"}, in plain words, 4-8 lines. Cover, only where
the site actually says so:
  - what they sell or provide, specifically
  - who their customers are
  - what action they want a customer to take (book, buy, visit, request a quote)
  - any limits, licences or obligations the site states

Do not invent. If the site does not say who the customers are, leave audience
empty rather than guessing. Do not write marketing copy — write what a new
employee would need to know on their first day.

Return JSON only:
{"company_name":"..","description":"..","audience":"..","confidence":"high|medium|low",
 "missing":["what the site did not tell you, in the same language"]}`;

  const out = await ds.chatJSON(system, raw, "profilegen:site-summary");

  return {
    ok: true,
    warnings,
    pages: pagesRead,
    summarised: true,
    draft: {
      company_name: String(out?.company_name || "").trim(),
      description: String(out?.description || "").trim(),
      audience: String(out?.audience || "").trim(),
      confidence: out?.confidence || "medium",
      missing: Array.isArray(out?.missing) ? out.missing : [],
    },
  };
}
