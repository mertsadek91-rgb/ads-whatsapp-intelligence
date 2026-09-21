// Blurry video covers — root cause and contract. Ads that promote an EXISTING
// post (this account's normal setup) have NO object_story_spec: the creative
// carries only object_type/video_id. Detecting "video" via object_story_spec
// alone classified everything as "image", and the sized creative thumbnail —
// even at thumbnail_width(1080) — is an UPSCALE of a tiny preview crop, so it
// passed dimension checks while still rendering blurry. The sharp cover lives
// on the video node's own /thumbnails edge (1440x2560 on this account).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
vi.mock("../src/config.js", () => ({
  default: { meta: { apiVersion: "v21.0", accountId: "123", token: null } },
}));
vi.mock("../src/lib/metaAuth.js", () => ({ getToken: vi.fn(async () => "fake-token") }));

const axios = (await import("axios")).default;
const { adCreatives } = await import("../src/lib/meta.js");

const adsPage = (ads) => ({ data: { data: ads, paging: {} } });

describe("adCreatives — media type detection + sharp video covers", () => {
  beforeEach(() => { axios.get.mockReset(); });

  it("classifies an existing-post video ad (object_type=VIDEO, empty spec) as video and swaps in the /thumbnails cover", async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.includes("/ads")) return adsPage([
        { id: "ad1", creative: { object_type: "VIDEO", video_id: "v9", thumbnail_url: "https://cdn/upscaled-64px.jpg", body: "نص البوست" } },
        { id: "ad2", creative: { object_type: "SHARE", image_url: "https://cdn/full.jpg", body: "بوست صورة" } },
      ]);
      if (url.includes("/v9/thumbnails")) return { data: { data: [
        { uri: "https://cdn/cover-small.jpg", width: 300, height: 533, is_preferred: false },
        { uri: "https://cdn/cover-1440.jpg", width: 1440, height: 2560, is_preferred: false },
      ] } };
      throw new Error("unexpected url " + url);
    });

    const map = await adCreatives();
    expect(map.ad1).toEqual({ url: "https://cdn/cover-1440.jpg", body: "نص البوست", media_type: "video" });
    expect(map.ad2).toEqual({ url: "https://cdn/full.jpg", body: "بوست صورة", media_type: "image" });
    // image ads must not trigger any /thumbnails fetch
    expect(axios.get.mock.calls.filter(([u]) => u.includes("/thumbnails"))).toHaveLength(1);
  });

  it("prefers the is_preferred thumbnail when the video has one", async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.includes("/ads")) return adsPage([
        { id: "ad1", creative: { video_id: "v1", thumbnail_url: "https://cdn/t.jpg" } },
      ]);
      if (url.includes("/v1/thumbnails")) return { data: { data: [
        { uri: "https://cdn/big.jpg", width: 1440, height: 2560, is_preferred: false },
        { uri: "https://cdn/chosen.jpg", width: 1080, height: 1920, is_preferred: true },
      ] } };
    });
    const map = await adCreatives();
    expect(map.ad1.url).toBe("https://cdn/chosen.jpg");
  });

  it("a /thumbnails failure is non-fatal — the ad keeps its sized-thumbnail fallback", async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.includes("/ads")) return adsPage([
        { id: "ad1", creative: { object_type: "VIDEO", video_id: "v1", thumbnail_url: "https://cdn/fallback.jpg" } },
      ]);
      throw Object.assign(new Error("perm"), { response: { data: { error: { code: 100, message: "no access" } } } });
    });
    const map = await adCreatives();
    expect(map.ad1).toMatchObject({ url: "https://cdn/fallback.jpg", media_type: "video" });
  });

  it("classifies spec-based creatives too: video_data => video (own cover, no extra fetch), child_attachments => carousel", async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.includes("/ads")) return adsPage([
        { id: "ad1", creative: { object_story_spec: { video_data: { message: "فيديو", image_url: "https://cdn/native-cover.jpg" } }, thumbnail_url: "https://cdn/t.jpg" } },
        { id: "ad2", creative: { object_story_spec: { link_data: { message: "كاروسيل", child_attachments: [{ picture: "https://cdn/c1.jpg" }] } } } },
      ]);
      throw new Error("unexpected url " + url);
    });
    const map = await adCreatives();
    expect(map.ad1).toMatchObject({ url: "https://cdn/native-cover.jpg", media_type: "video" });
    expect(map.ad2).toMatchObject({ url: "https://cdn/c1.jpg", media_type: "carousel" });
    expect(axios.get.mock.calls.filter(([u]) => u.includes("/thumbnails"))).toHaveLength(0);
  });
});
