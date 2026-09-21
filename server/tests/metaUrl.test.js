// adsManagerUrl builds a deep link into Meta Ads Manager that pre-selects a
// specific ad or campaign, so the owner can jump from a table row here to the
// exact same entity in their ad account.
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  default: { meta: { apiVersion: "v21.0", accountId: "999", token: null } },
}));
vi.mock("../src/lib/metaAuth.js", () => ({ getToken: vi.fn(async () => "t") }));

const { adsManagerUrl } = await import("../src/lib/meta.js");

describe("adsManagerUrl", () => {
  it("prefers the ad-level link when an ad id is given", () => {
    const u = adsManagerUrl("123", { adId: "ad_7", campaignId: "c_9" });
    expect(u).toBe("https://adsmanager.facebook.com/adsmanager/manage/ads?act=123&selected_ad_ids=ad_7");
  });

  it("falls back to the campaign-level link when only a campaign id is given", () => {
    const u = adsManagerUrl("123", { campaignId: "c_9" });
    expect(u).toBe("https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123&selected_campaign_ids=c_9");
  });

  it("uses the configured account id when none is passed", () => {
    expect(adsManagerUrl(null, { adId: "ad_1" })).toContain("act=999");
  });

  it("url-encodes ids that contain reserved characters", () => {
    expect(adsManagerUrl("a c/t", { adId: "a&b" })).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=a%20c%2Ft&selected_ad_ids=a%26b");
  });

  it("returns null when there is no entity id, or no account at all", () => {
    expect(adsManagerUrl("123", {})).toBeNull();
    expect(adsManagerUrl("", { adId: "x" })).toContain("act=999"); // empty acct -> config fallback
    expect(adsManagerUrl(null, {})).toBeNull();
  });
});
