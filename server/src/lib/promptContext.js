// One sentence describing this business, for every prompt that is not the main
// conversation evaluator.
//
// The coaching, knowledge-base, campaign-analysis and post-review prompts all
// opened by asserting the industry — "a forex/CFD brokerage in the Gulf" — which
// meant a clinic got sales coaching written for a broker and a knowledge base
// full of deposit and leverage questions. They need far less context than the
// evaluator does: who this business is and what it sells is enough to make the
// advice land in the right industry.
import { getProfile } from "./profileStore.js";

/**
 * "a dental clinic called Al Noor" / "شركة تبيع ... اسمها ..."
 * Falls back to a neutral phrase rather than naming an industry we do not know,
 * because a wrong industry is worse than no industry.
 */
export function businessContext(lang = "ar", profile = getProfile()) {
  const name = profile.identity?.company_name?.trim();
  const sells = profile.identity?.what_we_sell?.trim();
  const audience = profile.identity?.audience?.trim();

  if (lang === "en") {
    const who = name ? `a company called "${name}"` : "this company";
    return [
      `You are working for ${who}.`,
      sells ? `What it does: ${sells}` : "",
      audience ? `Its customers: ${audience}` : "",
    ].filter(Boolean).join("\n");
  }
  const who = name ? `شركة اسمها "${name}"` : "هذه الشركة";
  return [
    `أنت تعمل لدى ${who}.`,
    sells ? `نشاط الشركة: ${sells}` : "",
    audience ? `عملاؤها: ${audience}` : "",
  ].filter(Boolean).join("\n");
}

/** The role line plus the business context, which is how every prompt opens. */
export function promptPreamble(role, lang = "ar", profile = getProfile()) {
  return `${role}\n${businessContext(lang, profile)}`;
}

export default { businessContext, promptPreamble };
