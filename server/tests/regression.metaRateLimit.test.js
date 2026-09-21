// BUG-021 — fbGet() used to propagate a Graph API rate-limit error (app/user/
// page/custom throttling, or a bare HTTP 429) straight up, aborting the whole
// daily sync on a transient limit. Fixed: bounded exponential-backoff retry
// (1s/4s/16s, 3 attempts) for rate-limit responses only — every other error
// still fails immediately.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
vi.mock("../src/config.js", () => ({
  default: { meta: { apiVersion: "v21.0", accountId: "123", token: null } },
}));
vi.mock("../src/lib/metaAuth.js", () => ({ getToken: vi.fn(async () => "fake-token") }));

const axios = (await import("axios")).default;
const { fbGet } = await import("../src/lib/meta.js");

describe("BUG-021: fbGet retries rate-limited Graph API calls with backoff", () => {
  beforeEach(() => { axios.get.mockReset(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("retries once on a rate-limit error code (17) and succeeds", async () => {
    axios.get
      .mockRejectedValueOnce({ response: { data: { error: { code: 17, message: "User request limit reached" } } } })
      .mockResolvedValueOnce({ data: { data: [] } });

    const promise = fbGet("https://graph.facebook.com/x", {});
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual({ data: { data: [] } });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it("retries on a bare HTTP 429 with no Graph error payload", async () => {
    axios.get
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockResolvedValueOnce({ data: { ok: true } });

    const promise = fbGet("https://graph.facebook.com/x", {});
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toEqual({ data: { ok: true } });
  });

  it("gives up after 3 retries and surfaces a rate-limit-specific message", async () => {
    axios.get.mockRejectedValue({ response: { data: { error: { code: 17, message: "User request limit reached" } } } });

    const promise = fbGet("https://graph.facebook.com/x", {});
    const assertion = expect(promise).rejects.toThrow(/تجاوز حدّ معدّل طلبات Meta API/);
    await vi.advanceTimersByTimeAsync(1000 + 4000 + 16000);
    await assertion;
    expect(axios.get).toHaveBeenCalledTimes(4); // initial attempt + 3 retries
  });

  it("does not retry non-rate-limit errors (e.g. invalid token, code 190)", async () => {
    axios.get.mockRejectedValueOnce({ response: { data: { error: { code: 190, message: "Error validating access token" } } } });
    await expect(fbGet("https://graph.facebook.com/x", {})).rejects.toThrow(/توكن Meta غير صالح/);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});
