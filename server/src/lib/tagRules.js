// The tags we can compute EXACTLY, from data we already hold.
//
// Around a quarter of the Wati taxonomy is deterministic: the country is in the
// phone number, the channel is in the ad the lead came from, "no reply for 48
// hours" is in the message timestamps. Sending any of that to an AI would be
// slower, cost money, and be wrong more often than a two-line rule — so none of
// it goes to the AI. What is left for the AI is only what a human would have to
// read the conversation to know.
//
// Every function here is pure: it takes a row and returns tags. No queries, no
// clock reads except the `now` passed in — which is what makes the whole thing
// testable and makes a re-run reproduce the same answer.
import { countryOf } from "./phoneCountry.js";
import { TAG_INDEX } from "./tagTaxonomy.js";

export const RULE_VERSION = "rule-1";

// ISO-2 -> GEO_* tag. Covers every country the phone map can identify, so no
// lead ends up with a region and no country. The 24 in the owner's sheet come
// first; the rest were added on top of it (see `addedBeyondSheet` in the
// taxonomy) because Algeria, Iraq and Yemen alone are 1,809 of our contacts.
const ISO_TO_GEO = {
  // --- from the cheat sheet ---
  AE: "GEO_UAE", SA: "GEO_KSA", KW: "GEO_KUW", QA: "GEO_QAT", OM: "GEO_OM",
  BH: "GEO_BAH", JO: "GEO_JOR", EG: "GEO_EG", MA: "GEO_MOR", TR: "GEO_TUR",
  IN: "GEO_IND", PK: "GEO_PAK", BD: "GEO_BGD", LK: "GEO_LKA", NG: "GEO_NGR",
  GH: "GEO_GHN", KE: "GEO_KEN", ZA: "GEO_RSA", RU: "GEO_RUS", GB: "GEO_UK",
  US: "GEO_USA", CA: "GEO_CAN", AU: "GEO_AUS", NZ: "GEO_NZL",
  // --- added beyond the sheet ---
  DZ: "GEO_DZA", IQ: "GEO_IRQ", YE: "GEO_YEM", SD: "GEO_SDN", TN: "GEO_TUN",
  LY: "GEO_LBY", LB: "GEO_LBN", SY: "GEO_SYR", PS: "GEO_PSE", MR: "GEO_MRT",
  SO: "GEO_SOM", DJ: "GEO_DJI", KM: "GEO_COM", IR: "GEO_IRN", AF: "GEO_AFG",
  MY: "GEO_MYS", ID: "GEO_IDN", PH: "GEO_PHL", CN: "GEO_CHN", FR: "GEO_FRA",
  DE: "GEO_DEU", IT: "GEO_ITA", ES: "GEO_ESP",
};

// Region is defined for every country we can see, including the ones with no
// GEO_* tag — so a lead from Iraq is still findable as MENA.
const ISO_TO_REGION = {
  AE: "GEO_R_GCC", SA: "GEO_R_GCC", KW: "GEO_R_GCC", QA: "GEO_R_GCC",
  OM: "GEO_R_GCC", BH: "GEO_R_GCC",
  JO: "GEO_R_MENA", LB: "GEO_R_MENA", SY: "GEO_R_MENA", IQ: "GEO_R_MENA",
  YE: "GEO_R_MENA", PS: "GEO_R_MENA", EG: "GEO_R_MENA", MA: "GEO_R_MENA",
  DZ: "GEO_R_MENA", TN: "GEO_R_MENA", LY: "GEO_R_MENA", SD: "GEO_R_MENA",
  MR: "GEO_R_MENA", IR: "GEO_R_MENA",
  IN: "GEO_R_SOUTH_ASIA", PK: "GEO_R_SOUTH_ASIA", BD: "GEO_R_SOUTH_ASIA",
  LK: "GEO_R_SOUTH_ASIA", AF: "GEO_R_SOUTH_ASIA",
  CN: "GEO_R_EAST_ASIA",
  MY: "GEO_R_SOUTHEAST_ASIA", ID: "GEO_R_SOUTHEAST_ASIA", PH: "GEO_R_SOUTHEAST_ASIA",
  NG: "GEO_R_SUB_SAHARAN_AFRICA", KE: "GEO_R_SUB_SAHARAN_AFRICA",
  GH: "GEO_R_SUB_SAHARAN_AFRICA", ZA: "GEO_R_SUB_SAHARAN_AFRICA",
  SO: "GEO_R_SUB_SAHARAN_AFRICA", DJ: "GEO_R_SUB_SAHARAN_AFRICA", KM: "GEO_R_SUB_SAHARAN_AFRICA",
  US: "GEO_R_NORTH_AMERICA", CA: "GEO_R_NORTH_AMERICA",
  GB: "GEO_R_UK_IE", IE: "GEO_R_UK_IE",
  FR: "GEO_R_EU", DE: "GEO_R_EU", IT: "GEO_R_EU", ES: "GEO_R_EU",
  TR: "GEO_R_EU", // the sheet has no separate Turkey region; EU is its closest bucket
  RU: "GEO_R_CIS",
};

/** Countries we see in the data that the sheet has no GEO_* tag for. */
export function unmappedCountries(iso2List) {
  return [...new Set(iso2List.filter((c) => c && !ISO_TO_GEO[c]))].sort();
}

/**
 * Language from the customer's own characters.
 *
 * Script detection, not translation: Arabic script means Arabic, Cyrillic means
 * Russian, Han means Chinese. Latin is ambiguous (English, French, and
 * transliterated Arabic all look the same), so Latin alone only ever yields
 * LANG_EN — and Hindi/Urdu are left to the AI, because Urdu is Arabic script
 * and a rule cannot tell it from Arabic.
 */
export function languageTag(customerText) {
  const s = String(customerText || "");
  if (!s.trim()) return null;
  const counts = {
    ar: (s.match(/[؀-ۿ]/g) || []).length,
    ru: (s.match(/[Ѐ-ӿ]/g) || []).length,
    zh: (s.match(/[一-鿿]/g) || []).length,
    hi: (s.match(/[ऀ-ॿ]/g) || []).length,
    en: (s.match(/[A-Za-z]/g) || []).length,
  };
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!n) return null;
  return { ar: "LANG_AR", ru: "LANG_RU", zh: "LANG_ZH", hi: "LANG_HI", en: "LANG_EN" }[best];
}

const hoursSince = (ts, now) => (ts ? (now - new Date(ts).getTime()) / 3_600_000 : null);

/**
 * @param {object} row  A joined contact row: phone/country_iso2, source,
 *   source_ad_id, campaign_name, human_replied, customer_msgs, last_dir,
 *   last_activity, stage, qualification_score, customer_text.
 * @returns {Array<{tag,category,confidence,evidence}>}
 */
export function ruleTags(row = {}, now = new Date()) {
  const out = [];
  const t = new Date(now).getTime();
  const add = (tag, evidence) => {
    const meta = TAG_INDEX.get(tag);
    // Guard against a typo in this file silently creating a tag nobody defined.
    if (meta) out.push({ tag, category: meta.category, evidence });
  };

  // ---- where they are -------------------------------------------------------
  const iso = row.country_iso2 || countryOf(row.phone).iso2;
  if (iso) {
    if (ISO_TO_GEO[iso]) add(ISO_TO_GEO[iso], `dial code → ${iso}`);
    if (ISO_TO_REGION[iso]) add(ISO_TO_REGION[iso], `${iso} → region`);
  }

  // ---- what language they write in ----------------------------------------
  const lang = languageTag(row.customer_text);
  if (lang) add(lang, "script of the customer's own messages");

  // ---- where they came from -------------------------------------------------
  const src = String(row.source || "").toLowerCase();
  const hasAd = !!String(row.source_ad_id || "").trim();
  if (/instagram/.test(src)) add("CH_INSTAGRAM", `source=${row.source}`);
  else if (/facebook/.test(src)) add("CH_FACEBOOK", `source=${row.source}`);
  else if (hasAd) add("CH_META", "click-to-WhatsApp ad");
  else if (/whatsapp|wati|ctwa/.test(src)) add("CH_WHATSAPP_INBOUND", `source=${row.source}`);

  // Campaign intent is only tagged on an explicit keyword. A campaign called
  // "GCC IST MARKETS - WA - ARABIC" says nothing about IB vs trader, and
  // guessing CAMP_TRADER_ACQ for everything would make the tag meaningless.
  const camp = String(row.campaign_name || "").toLowerCase();
  if (/\bib\b|introduc/.test(camp)) add("CAMP_IB_ACQ", row.campaign_name);
  else if (/affiliat/.test(camp)) add("CAMP_AFFILIATE_ACQ", row.campaign_name);
  else if (/reactivat|winback|win-back/.test(camp)) add("CAMP_TRADER_REACTIVATION", row.campaign_name);
  else if (/upsell|upgrade/.test(camp)) add("CAMP_TRADER_UPSELL", row.campaign_name);

  // ---- how the conversation went -------------------------------------------
  const replied = Number(row.human_replied) === 1;
  if (replied) { add("ENG_CONTACTED", "a human agent replied"); add("STG_CONTACTED", "a human agent replied"); }
  // "Responded" means the CUSTOMER carried on talking, which is only meaningful
  // once someone spoke to them — otherwise every inbound lead looks responsive.
  if (replied && Number(row.customer_msgs || 0) > 1) add("ENG_RESPONDED", "the customer kept replying");

  // Silence buckets: only the LARGEST applicable one, so a 9-day-old thread
  // carries "no reply for 7 days" and not all three at once. Silence is only
  // silence if WE spoke last.
  if (row.last_dir === "out") {
    const h = hoursSince(row.last_activity, t);
    const bucket = h == null ? null : h >= 168 ? "ENG_NO_REPLY_7D" : h >= 48 ? "ENG_NO_REPLY_48H" : h >= 24 ? "ENG_NO_REPLY_24H" : null;
    if (bucket) add(bucket, `${Math.floor(h)}h since our last message`);
  }

  // ---- how far they got ----------------------------------------------------
  const qs = row.qualification_score == null ? null : Number(row.qualification_score);
  const stageQualified = ["qualified", "interested", "demo", "deposit"].includes(String(row.stage || "").toLowerCase());
  if ((qs != null && qs >= 60) || stageQualified) {
    add("STG_QUALIFIED", qs != null ? `qualification score ${qs}` : `stage=${row.stage}`);
    // A qualified lead who then went quiet for a month is exactly who a
    // reactivation campaign is for.
    const h = hoursSince(row.last_activity, t);
    if (h != null && h >= 720) add("STG_REACTIVATION", `${Math.floor(h / 24)} days silent after qualifying`);
  }

  return out;
}

/**
 * SEG_* is a composition, not an observation: audience type × experience level.
 * It runs after the AI tags exist, because both of its inputs are AI tags.
 */
export function segmentTag(tags = []) {
  const has = (x) => tags.includes(x);
  const level = has("EXP_PRO") ? "PRO" : has("EXP_INTERMEDIATE") ? "INTERMEDIATE" : has("EXP_BEGINNER") ? "BEGINNER" : null;
  if (!level) return null;
  // Only trader and IB have segments in the sheet; an affiliate or money
  // manager gets no SEG_* rather than being forced into the trader ladder.
  const kind = has("AUD_IB") || has("INTENT_BECOME_IB") ? "IB" : has("AUD_TRADER") ? "TRADER" : null;
  if (!kind) return null;
  const tag = `SEG_${kind}_${level}`;
  return TAG_INDEX.has(tag) ? { tag, category: "trader_segment", evidence: `${kind} + ${level}` } : null;
}

export default { ruleTags, segmentTag, languageTag, unmappedCountries, RULE_VERSION };
