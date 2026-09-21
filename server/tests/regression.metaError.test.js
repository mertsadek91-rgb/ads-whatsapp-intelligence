// REG-104 — the Meta "update" button used to show an opaque "status 400" with
// no way to tell an expired token from any other failure, because a raw axios
// error was thrown straight through the Graph API's own message. Fixed:
// fbGet() unwraps response.data.error and rethrows a message an operator can
// act on (and specifically flags token expiry, code 190).
import { describe, it, expect, vi } from "vitest";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));
vi.mock("../src/config.js", () => ({
  default: { meta: { apiVersion: "v21.0", accountId: "123", token: null } },
}));
vi.mock("../src/lib/metaAuth.js", () => ({ getToken: vi.fn(async () => "fake-token") }));

const axios = (await import("axios")).default;
const { fbGet } = await import("../src/lib/meta.js");

describe("REG-104: fbGet surfaces the real Graph API error, not a bare status code", () => {
  it("flags an expired/invalid token distinctly (error code 190)", async () => {
    axios.get.mockRejectedValueOnce({
      response: { data: { error: { code: 190, message: "Error validating access token" } } },
    });
    await expect(fbGet("https://graph.facebook.com/x", {})).rejects.toThrow(
      /توكن Meta غير صالح\/منتهي: Error validating access token/
    );
  });

  it("surfaces other Graph API errors with the API's own message", async () => {
    axios.get.mockRejectedValueOnce({
      response: { data: { error: { code: 100, message: "Invalid parameter" } } },
    });
    await expect(fbGet("https://graph.facebook.com/x", {})).rejects.toThrow(
      /خطأ Meta API: Invalid parameter/
    );
  });

  it("rethrows the original error unchanged when there is no Graph error payload", async () => {
    const networkError = new Error("connect ETIMEDOUT");
    axios.get.mockRejectedValueOnce(networkError);
    await expect(fbGet("https://graph.facebook.com/x", {})).rejects.toThrow("connect ETIMEDOUT");
  });

  it("returns the response through unchanged on success", async () => {
    axios.get.mockResolvedValueOnce({ data: { data: [] } });
    const res = await fbGet("https://graph.facebook.com/x", {});
    expect(res.data).toEqual({ data: [] });
  });
});
