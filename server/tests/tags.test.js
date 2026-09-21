// The tag taxonomy, the deterministic rules, and the validator that stands
// between the AI and the database.
//
// What is pinned here is the boundary: the AI must not be able to write a tag
// whose truth lives in the trading platform or the compliance system, and a
// suggestion without a quote must not become a row. Everything else about
// tagging is a judgement call; those two are correctness.
import { describe, it, expect } from "vitest";
import {
  CATEGORIES, TAG_INDEX, TAG_COUNT, aiTags, aiCategories, exclusiveGroups,
  sourceOf, tagLabel, categoryLabel, isKnownTag,
} from "../src/profiles/brokerageTags.js";
import { ruleTags, segmentTag, languageTag, unmappedCountries } from "../src/lib/tagRules.js";
import { COUNTRIES } from "../src/lib/phoneCountry.js";
import { validateAiTags } from "../src/lib/tagAssign.js";

describe("taxonomy", () => {
  it("carries the whole sheet plus the countries it was missing", () => {
    expect(CATEGORIES.length).toBe(35);
    // 294 from the owner's cheat sheet + 23 countries added on top of it.
    expect(TAG_COUNT).toBe(317);
    const added = [...TAG_INDEX.values()].filter((t) => t.added);
    expect(added.length).toBe(23);
    // Everything added is a country tag and computed, never AI-invented.
    for (const t of added) {
      expect(t.category).toBe("geo_country");
      expect(t.source).toBe("rule");
    }
  });

  it("has no duplicate tag code across categories", () => {
    const all = CATEGORIES.flatMap((c) => c.tags.map(([code]) => code));
    expect(all.length).toBe(new Set(all).size);
  });

  it("gives every tag both an Arabic and an English label", () => {
    for (const [code, en, ar] of CATEGORIES.flatMap((c) => c.tags)) {
      expect(en, code).toBeTruthy();
      expect(ar, code).toBeTruthy();
      expect(tagLabel(code, "en")).toBe(en);
      expect(tagLabel(code, "ar")).toBe(ar);
    }
  });

  it("keeps platform, compliance and partner facts away from the AI", () => {
    // These are the four families whose truth lives elsewhere. If any of them
    // ever enters the AI vocabulary, the AI can invent a deposit or a KYC state.
    for (const prefix of ["STG_FUNDED", "TRD_", "ACC_", "DEP_USD_", "COMP_", "DOC_", "CP_", "REBATE_"]) {
      const leaked = aiTags().filter((t) => t.startsWith(prefix));
      expect(leaked, `${prefix} must not be AI-owned`).toEqual([]);
    }
  });

  it("lets a tag override its category's source", () => {
    // Its category is rule-driven (timestamps), but "the customer asked us to
    // stop" is something only the text says.
    expect(sourceOf("ENG_NO_REPLY_48H")).toBe("rule");
    expect(sourceOf("ENG_OPTED_OUT")).toBe("ai");
    expect(sourceOf("ENG_CONTACTED")).toBe("rule");
    expect(sourceOf("ENG_HOT")).toBe("ai");
    expect(sourceOf("STG_BLACKLISTED")).toBe("manual");
  });

  it("builds the AI prompt from AI-owned tags only", () => {
    for (const c of aiCategories()) {
      for (const [code] of c.tags) expect(sourceOf(code), code).toBe("ai");
    }
  });

  it("marks the mutually-exclusive families", () => {
    const groups = exclusiveGroups();
    const inSomeGroup = (t) => groups.some((g) => g.includes(t));
    expect(inSomeGroup("EXP_BEGINNER")).toBe(true);
    expect(inSomeGroup("ENG_HOT")).toBe(true);
    // Do-Not-Call is not exclusive with the temperature — a hot lead can still
    // refuse phone calls.
    expect(inSomeGroup("ENG_DO_NOT_CALL")).toBe(false);
    expect(inSomeGroup("ASSET_GOLD")).toBe(false); // several assets at once is normal
  });

  it("labels categories in both languages and shrugs at unknown codes", () => {
    expect(categoryLabel("intent", "en")).toBe("Intent");
    expect(categoryLabel("intent", "ar")).toBe("نيّة العميل");
    expect(tagLabel("NOT_A_TAG")).toBe("NOT_A_TAG");
    expect(isKnownTag("NOT_A_TAG")).toBe(false);
    expect(isKnownTag("INTENT_DEPOSIT")).toBe(true);
  });
});

describe("rule tags", () => {
  const NOW = new Date("2026-07-30T12:00:00Z");
  const tagsOf = (row, now = NOW) => ruleTags(row, now).map((r) => r.tag);

  it("reads the country and region off the phone", () => {
    const t = tagsOf({ phone: "212612345678" });
    expect(t).toContain("GEO_MOR");
    expect(t).toContain("GEO_R_MENA");
  });

  it("covers every country the phone map can identify", () => {
    // The sheet defined 24 countries; Algeria, Iraq and Yemen alone are 1,809 of
    // our contacts and had none. This guard fails if phoneCountry ever learns a
    // new dial code without a matching tag, which is how the gap appeared.
    expect(unmappedCountries(COUNTRIES.map((c) => c.iso2))).toEqual([]);
    expect(tagsOf({ phone: "213612345678" })).toContain("GEO_DZA"); // Algeria
    expect(tagsOf({ phone: "9647701234567" })).toContain("GEO_IRQ"); // Iraq
    expect(tagsOf({ phone: "967712345678" })).toContain("GEO_YEM"); // Yemen
  });

  it("gives an unrecognisable number no country tag at all", () => {
    // A dial code we cannot place must yield nothing, never a plausible guess.
    const t = tagsOf({ phone: "99900012345" });
    expect(t.filter((x) => x.startsWith("GEO_"))).toEqual([]);
  });

  it("detects language from the customer's own script", () => {
    expect(languageTag("مرحبا اريد فتح حساب")).toBe("LANG_AR");
    expect(languageTag("hello I want to trade gold")).toBe("LANG_EN");
    expect(languageTag("здравствуйте")).toBe("LANG_RU");
    expect(languageTag("")).toBe(null);
    // Mixed text goes with the dominant script rather than tagging both.
    expect(languageTag("مرحبا hi")).toBe("LANG_AR");
  });

  it("only calls it contacted when a HUMAN replied", () => {
    expect(tagsOf({ human_replied: 0, customer_msgs: 5 })).not.toContain("ENG_CONTACTED");
    expect(tagsOf({ human_replied: 1, customer_msgs: 5 })).toContain("ENG_CONTACTED");
    expect(tagsOf({ human_replied: 1, customer_msgs: 5 })).toContain("STG_CONTACTED");
    // One customer message is the inbound lead itself, not a reply to us.
    expect(tagsOf({ human_replied: 1, customer_msgs: 1 })).not.toContain("ENG_RESPONDED");
  });

  it("buckets silence into exactly one window, and only when we spoke last", () => {
    const at = (h) => new Date(NOW.getTime() - h * 3_600_000);
    const silence = (h, dir = "out") => tagsOf({ last_dir: dir, last_activity: at(h) }).filter((x) => x.startsWith("ENG_NO_REPLY"));
    expect(silence(200)).toEqual(["ENG_NO_REPLY_7D"]);
    expect(silence(60)).toEqual(["ENG_NO_REPLY_48H"]);
    expect(silence(30)).toEqual(["ENG_NO_REPLY_24H"]);
    expect(silence(10)).toEqual([]);
    // The customer spoke last — the ball is in OUR court, that is not "no reply".
    expect(silence(200, "in")).toEqual([]);
  });

  it("treats a qualified lead gone quiet for a month as a reactivation target", () => {
    const old = new Date(NOW.getTime() - 40 * 24 * 3_600_000);
    const t = tagsOf({ qualification_score: 80, last_activity: old, last_dir: "out" });
    expect(t).toContain("STG_QUALIFIED");
    expect(t).toContain("STG_REACTIVATION");
    // Qualified yesterday is not a reactivation target.
    expect(tagsOf({ qualification_score: 80, last_activity: NOW })).not.toContain("STG_REACTIVATION");
    expect(tagsOf({ qualification_score: 20 })).not.toContain("STG_QUALIFIED");
  });

  it("tags the campaign only on an explicit keyword", () => {
    // The real campaign names in this account say nothing about audience.
    expect(tagsOf({ campaign_name: "GCC BRAND - WA - ARABIC" }).filter((x) => x.startsWith("CAMP_"))).toEqual([]);
    expect(tagsOf({ campaign_name: "IB Partner Acquisition Q3" })).toContain("CAMP_IB_ACQ");
    expect(tagsOf({ campaign_name: "Winback dormant traders" })).toContain("CAMP_TRADER_REACTIVATION");
  });

  it("reads the channel from the ad, falling back to organic inbound", () => {
    expect(tagsOf({ source: "CTWA", source_ad_id: "123" })).toContain("CH_META");
    expect(tagsOf({ source: "Instagram Story", source_ad_id: "123" })).toContain("CH_INSTAGRAM");
    expect(tagsOf({ source: "WhatsApp" })).toContain("CH_WHATSAPP_INBOUND");
  });

  it("composes the segment from audience and experience, or not at all", () => {
    expect(segmentTag(["AUD_TRADER", "EXP_BEGINNER"])?.tag).toBe("SEG_TRADER_BEGINNER");
    expect(segmentTag(["INTENT_BECOME_IB", "EXP_PRO"])?.tag).toBe("SEG_IB_PRO");
    // Experience with no audience, and an audience the ladder has no rung for.
    expect(segmentTag(["EXP_PRO"])).toBe(null);
    expect(segmentTag(["AUD_AFFILIATE", "EXP_PRO"])).toBe(null);
    expect(segmentTag([])).toBe(null);
  });
});

describe("AI tag validation", () => {
  const ok = (tag, confidence = 0.9, evidence = "أريد فتح حساب حقيقي") => ({ tag, confidence, evidence });

  it("keeps a well-formed suggestion", () => {
    const v = validateAiTags({ tags: [ok("INTENT_OPEN_LIVE")], customer_type: "عميل جاهز" });
    expect(v.tags).toEqual([{
      tag: "INTENT_OPEN_LIVE", category: "intent", confidence: 0.9, evidence: "أريد فتح حساب حقيقي",
    }]);
    expect(v.customer_type).toBe("عميل جاهز");
  });

  it("refuses a tag the AI is not allowed to own", () => {
    const v = validateAiTags({ tags: [ok("STG_FUNDED"), ok("DEP_USD_25K_50K"), ok("COMP_KYC_VERIFIED")] });
    expect(v.tags).toEqual([]);
    expect(v.dropped.map((d) => d.why)).toEqual(["not_ai_owned", "not_ai_owned", "not_ai_owned"]);
  });

  it("refuses invented tags", () => {
    const v = validateAiTags({ tags: [ok("INTENT_BUY_A_YACHT")] });
    expect(v.tags).toEqual([]);
    expect(v.dropped[0].why).toBe("unknown_tag");
  });

  it("refuses a tag with no quote behind it", () => {
    const v = validateAiTags({ tags: [{ tag: "ENG_HOT", confidence: 0.9, evidence: "" }] });
    expect(v.tags).toEqual([]);
    expect(v.dropped[0].why).toBe("no_evidence");
  });

  it("refuses an unusable confidence", () => {
    for (const c of [0, -1, 2, "very sure", null]) {
      const v = validateAiTags({ tags: [ok("ENG_HOT", c)] });
      expect(v.tags, String(c)).toEqual([]);
      expect(v.dropped[0].why).toBe("bad_confidence");
    }
  });

  it("keeps the most confident of a mutually-exclusive pair", () => {
    const v = validateAiTags({ tags: [ok("EXP_BEGINNER", 0.6), ok("EXP_PRO", 0.9)] });
    expect(v.tags.map((t) => t.tag)).toEqual(["EXP_PRO"]);
    expect(v.dropped[0]).toEqual({ tag: "EXP_BEGINNER", why: "exclusive_with_EXP_PRO" });
  });

  it("lets non-exclusive tags from one category coexist", () => {
    const v = validateAiTags({ tags: [ok("ASSET_GOLD"), ok("ASSET_CRYPTO"), ok("INTENT_DEPOSIT")] });
    expect(v.tags.map((t) => t.tag).sort()).toEqual(["ASSET_CRYPTO", "ASSET_GOLD", "INTENT_DEPOSIT"]);
  });

  it("survives any malformed response rather than throwing", () => {
    for (const bad of [null, undefined, {}, { tags: null }, { tags: "gold" }, { tags: [null, 7, "x"] }]) {
      expect(() => validateAiTags(bad)).not.toThrow();
      expect(validateAiTags(bad).tags).toEqual([]);
    }
  });

  it("de-duplicates and normalizes case", () => {
    const v = validateAiTags({ tags: [ok("intent_deposit"), ok("INTENT_DEPOSIT", 0.8)] });
    expect(v.tags.map((t) => t.tag)).toEqual(["INTENT_DEPOSIT"]);
  });
});
