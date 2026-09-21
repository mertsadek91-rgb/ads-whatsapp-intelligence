// The business-definition step: confirm we can read the company's website, and
// that the operator has written enough about the business for the AI to work
// from.
//
// Deliberately forgiving. A site behind Cloudflare, or one that renders
// entirely in JavaScript, is not a broken site and must not block the install —
// it just means the profile is built from the description alone, and the review
// screen says so plainly rather than quietly producing a thinner profile.
import { fetchSiteCorpus } from "../../lib/siteFetch.js";
import { fail, pass } from "../errorMap.js";
import { isTlsTrustError } from "../../lib/tlsTrust.js";

// Enough to describe a business in a sentence or two. Below this the model has
// nothing to generalise from and invents things, which is the worst outcome.
export const MIN_DESCRIPTION = 120;

export async function validate(input) {
  const description = String(input?.description || "").trim();
  const websiteUrl = String(input?.websiteUrl || "").trim();

  if (description.length < MIN_DESCRIPTION) {
    return fail("UNKNOWN",
      `الوصف قصير جداً (${description.length} حرفاً) — اكتب ${MIN_DESCRIPTION} حرفاً على الأقل ` +
      `/ description is too short; write at least ${MIN_DESCRIPTION} characters`);
  }

  if (!websiteUrl) {
    return pass({ websiteUrl: null, pagesRead: 0, charsRead: 0, readable: false },
      ["SITE_UNREACHABLE"]);
  }

  const url = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;

  let corpus;
  try {
    corpus = await fetchSiteCorpus(url);
  } catch (e) {
    // Reading the company website goes out through the same intercepting proxy
    // as every other outbound call, and reporting that as "site unreachable"
    // would send the operator to check a website that is perfectly fine.
    if (isTlsTrustError(e)) return fail("TLS_INTERCEPTED", e.message);
    // The SSRF guard refusing an internal address IS a hard failure: it means
    // the operator pointed us somewhere we must not read.
    if (/SITE_PRIVATE_ADDRESS/.test(e.message)) return fail("SITE_PRIVATE_ADDRESS", url);
    if (/SITE_INVALID_URL/.test(e.message)) return fail("SITE_UNREACHABLE", url);
    return fail("SITE_UNREACHABLE", e.message);
  }

  return pass({
    websiteUrl: url,
    pagesRead: corpus.pages.length,
    charsRead: corpus.totalChars,
    readable: corpus.totalChars >= 400,
    pages: corpus.pages.map((p) => ({ url: p.url, title: p.title, chars: p.chars })),
  }, corpus.warnings);
}

export default { validate, MIN_DESCRIPTION };
