// BUG-023 — ads_meta_daily was only ever populated at level='campaign', even
// though the table itself is already level-polymorphic (level+entity_id),
// making date-filtered spend/results impossible below the campaign level.
// adDaily()/adsetDaily() are mechanically identical to the existing
// campaignDaily(), just requesting level="ad"/"adset" from the Graph API.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
vi.mock("../src/config.js", () => ({
  default: { meta: { apiVersion: "v21.0", accountId: "123", token: null } },
}));
vi.mock("../src/lib/metaAuth.js", () => ({ getToken: vi.fn(async () => "fake-token") }));

const axios = (await import("axios")).default;
const { adDaily, adsetDaily } = await import("../src/lib/meta.js");

describe("BUG-023: adDaily/adsetDaily request Graph API insights at the right level", () => {
  beforeEach(() => { axios.get.mockClear(); });

  it("adDaily requests level=ad and maps ad_id/ad_name into a daily row shape", async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        data: [{
          date_start: "2026-07-01", ad_id: "999", ad_name: "My Ad", campaign_id: "1", objective: "OUTCOME_ENGAGEMENT",
          spend: "50.5", impressions: "1000", clicks: "20",
          actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "5" }],
        }],
        paging: {},
      },
    });

    const rows = await adDaily("2026-07-01", "2026-07-01");
    expect(axios.get.mock.calls[0][1].params.level).toBe("ad");
    expect(rows).toEqual([{
      date: "2026-07-01", ad_id: "999", ad_name: "My Ad", campaign_id: "1",
      spend: 50.5, impressions: 1000, reach: 0, clicks: 20, frequency: null, results: 5, cpr: expect.any(Number),
    }]);
  });

  it("adsetDaily requests level=adset and maps adset_id/adset_name into a daily row shape", async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        data: [{
          date_start: "2026-07-01", adset_id: "555", adset_name: "My Adset", campaign_id: "1", objective: "OUTCOME_ENGAGEMENT",
          spend: "10", impressions: "200", clicks: "3",
          actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "1" }],
        }],
        paging: {},
      },
    });

    const rows = await adsetDaily("2026-07-01", "2026-07-01");
    expect(axios.get.mock.calls[0][1].params.level).toBe("adset");
    expect(rows[0].adset_id).toBe("555");
    expect(rows[0].adset_name).toBe("My Adset");
    expect(rows[0].results).toBe(1);
  });
});
