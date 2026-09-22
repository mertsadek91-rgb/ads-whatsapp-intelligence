// BUG-005/BUG-023 — ingestMeta.js orchestrates the whole Meta sync but had
// zero test coverage. Covers: the no-token skip path, and that ads_meta_daily
// is now populated at all three levels (campaign/ad/adset — BUG-023), not
// just campaign.
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertCalls = [];
const queryCalls = [];
vi.mock("../src/db.js", () => ({
  upsert: vi.fn(async (table, cols, rows, conflictCols) => { upsertCalls.push({ table, rows, conflictCols }); return rows.length; }),
  query: vi.fn(async (sql, params = []) => { queryCalls.push({ sql, params }); return {}; }),
}));

vi.mock("../src/lib/metaAuth.js", () => ({ ensureFresh: vi.fn(async () => ({ refreshed: false })) }));

const hasToken = vi.fn();
const adCreatives = vi.fn(async () => ({}));
// The ad account's billing currency, which is what every `spend` below is
// denominated in. ingestMeta records it so the display layer stops assuming
// dirhams; see lib/money.js.
const accountInfo = vi.fn(async () => ({ currency: "AED", name: "Test account", timezone: "Asia/Dubai" }));
vi.mock("../src/lib/meta.js", () => ({
  hasToken: (...a) => hasToken(...a),
  adCreatives: (...a) => adCreatives(...a),
  accountInfo: (...a) => accountInfo(...a),
  adPeriod: vi.fn(async () => []),
  adsetPeriod: vi.fn(async () => []),
  campaignPeriod: vi.fn(async () => []),
  campaignMonthly: vi.fn(async () => []),
  campaignDaily: vi.fn(async () => [{ date: "2026-07-01", campaign_id: "c1", campaign_name: "Camp", spend: 10, impressions: 100, clicks: 1, results: 1, cpr: 10 }]),
  adDaily: vi.fn(async () => [{ date: "2026-07-01", ad_id: "a1", ad_name: "Ad", campaign_id: "c1", spend: 5, impressions: 50, clicks: 1, results: 1, cpr: 5 }]),
  adsetDaily: vi.fn(async () => [{ date: "2026-07-01", adset_id: "s1", adset_name: "Adset", campaign_id: "c1", spend: 5, impressions: 50, clicks: 1, results: 1, cpr: 5 }]),
  countryDaily: vi.fn(async () => [{ date: "2026-07-01", country: "SA", spend: 8, impressions: 80, clicks: 2, ctr: 2.5, cpc: 4, cpm: 100 }]),
}));

vi.mock("../src/config.js", () => ({ default: { meta: { lookbackDays: 120 }, data: { since: "2026-01-01" } } }));

const { ingestMeta } = await import("../src/ingest/ingestMeta.js");

beforeEach(() => { upsertCalls.length = 0; queryCalls.length = 0; hasToken.mockReset(); adCreatives.mockReset(); adCreatives.mockResolvedValue({}); });

describe("ingestMeta: no-token skip path", () => {
  it("skips entirely and touches no tables when there is no Meta token", async () => {
    hasToken.mockResolvedValue(false);
    const result = await ingestMeta({});
    expect(result).toEqual({ skipped: true });
    expect(upsertCalls).toHaveLength(0);
  });
});

describe("BUG-023: ingestMeta populates ads_meta_daily at campaign, ad, and adset level", () => {
  it("upserts three separate ads_meta_daily batches with the correct level tag", async () => {
    hasToken.mockResolvedValue(true);
    const result = await ingestMeta({ until: "2026-07-01" });

    const dailyUpserts = upsertCalls.filter((c) => c.table === "ads_meta_daily");
    expect(dailyUpserts).toHaveLength(3);

    const levels = dailyUpserts.map((c) => c.rows[0][1]); // column 1 = level
    expect(levels).toEqual(["campaign", "ad", "adset"]);

    expect(result.daily).toBe(1);
    expect(result.adDaily).toBe(1);
    expect(result.adsetDaily).toBe(1);
  });

  it("upserts Meta spend split by country into ads_meta_country_daily", async () => {
    hasToken.mockResolvedValue(true);
    const result = await ingestMeta({ until: "2026-07-01" });
    const cd = upsertCalls.find((c) => c.table === "ads_meta_country_daily");
    expect(cd).toBeTruthy();
    expect(cd.conflictCols).toEqual(["date", "country"]);
    expect(cd.rows[0]).toEqual(["2026-07-01", "SA", 8, 80, 2, 2.5, 4, 100]);
    expect(result.countries).toBe(1);
  });
});

describe("creative thumbnails + captions (posts/highlights display and content analysis)", () => {
  it("writes each fetched creative image URL, real post text and media type onto its ad row", async () => {
    hasToken.mockResolvedValue(true);
    adCreatives.mockResolvedValue({
      a1: { url: "https://cdn/img1.jpg", body: "احذر من الوعود بالأرباح المضمونة — تعلّم التداول بمخاطره الحقيقية", media_type: "video" },
      a2: { url: "https://cdn/img2.jpg", body: null, media_type: "image" },
    });
    const result = await ingestMeta({ until: "2026-07-01" });
    const updates = queryCalls.filter((c) => c.sql.includes("set thumbnail_url"));
    expect(updates).toHaveLength(2);
    expect(updates[0].params).toEqual(["https://cdn/img1.jpg", "احذر من الوعود بالأرباح المضمونة — تعلّم التداول بمخاطره الحقيقية", "video", "a1"]);
    expect(updates[1].params).toEqual(["https://cdn/img2.jpg", null, "image", "a2"]);
    expect(result.creatives).toBe(2);
  });

  it("a creatives failure is non-fatal — the numeric sync still completes", async () => {
    hasToken.mockResolvedValue(true);
    adCreatives.mockRejectedValue(new Error("missing permission"));
    const result = await ingestMeta({ until: "2026-07-01" });
    expect(result.creatives).toBe(0);
    expect(upsertCalls.filter((c) => c.table === "ads_meta_daily")).toHaveLength(3); // sync unaffected
  });
});
