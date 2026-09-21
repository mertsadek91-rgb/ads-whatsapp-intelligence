// BUG-005 coverage — lib/metaAuth.js (self-managing Meta OAuth token
// lifecycle) was the single largest coverage gap at 3.65%. Covers the token
// adoption/refresh state machine and every branch of status()/ensureFresh()
// without ever hitting the real Graph API.
import { describe, it, expect, vi, beforeEach } from "vitest";

const cfg = {
  meta: { appId: "APPID", appSecret: "SECRET", apiVersion: "v20.0", accountId: "act_1", token: "ENV_SEED_TOKEN", scopes: "ads_read" },
  appBaseUrl: "http://localhost:3000",
};
vi.mock("../src/config.js", () => ({ default: cfg }));

const axiosGet = vi.fn();
vi.mock("axios", () => ({ default: { get: (...a) => axiosGet(...a) } }));

const settings = {};
const dbQuery = vi.fn(async (sql, params = []) => {
  if (sql.startsWith("select v from ads_settings")) return settings[params[0]] !== undefined ? [{ v: settings[params[0]] }] : [];
  if (sql.startsWith("insert into ads_settings")) { settings[params[0]] = params[1]; return {}; }
  if (sql.startsWith("delete from ads_settings")) { delete settings[params[0]]; return {}; }
  throw new Error("unexpected query: " + sql);
});
vi.mock("../src/db.js", () => ({ query: (...a) => dbQuery(...a) }));

const meta = await import("../src/lib/metaAuth.js");

beforeEach(() => {
  axiosGet.mockReset();
  dbQuery.mockClear();
  for (const k of Object.keys(settings)) delete settings[k];
  cfg.meta.appId = "APPID";
  cfg.meta.appSecret = "SECRET";
});

describe("appConfigured() / getToken()", () => {
  it("is configured only when BOTH app id and secret are set", () => {
    expect(meta.appConfigured()).toBe(true);
    cfg.meta.appSecret = "";
    expect(meta.appConfigured()).toBe(false);
  });

  it("prefers the DB-stored token over the .env seed", async () => {
    settings.meta_access_token = "DB_TOKEN";
    expect(await meta.getToken()).toBe("DB_TOKEN");
  });

  it("falls back to the .env seed token when nothing is stored", async () => {
    expect(await meta.getToken()).toBe("ENV_SEED_TOKEN");
  });
});

describe("adoptToken()", () => {
  it("rejects an empty token without ever calling the API", async () => {
    await expect(meta.adoptToken("")).rejects.toThrow("توكن فارغ");
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it("upgrades to a long-lived token when the exchange succeeds", async () => {
    axiosGet.mockResolvedValueOnce({ data: { access_token: "LONG", expires_in: 5184000 } });
    const r = await meta.adoptToken("short");
    expect(r).toMatchObject({ ok: true, longLived: true });
    expect(settings.meta_access_token).toBe("LONG");
  });

  it("falls back to debug_token when the exchange fails but the token is already valid", async () => {
    axiosGet
      .mockRejectedValueOnce(new Error("already long-lived"))
      .mockResolvedValueOnce({ data: { data: { is_valid: true, expires_at: Math.floor(Date.now() / 1000) + 3600 } } });
    const r = await meta.adoptToken("already-long");
    expect(r).toMatchObject({ ok: true, longLived: false });
    expect(settings.meta_access_token).toBe("already-long");
  });

  it("throws a Facebook-shaped error message when the fallback debug check says invalid", async () => {
    axiosGet
      .mockRejectedValueOnce({ response: { data: { error: { message: "exchange failed" } } } })
      .mockResolvedValueOnce({ data: { data: { is_valid: false } } });
    await expect(meta.adoptToken("bad")).rejects.toThrow(/توكن غير صالح/);
  });

  it("throws when both the exchange AND the debug fallback fail", async () => {
    axiosGet
      .mockRejectedValueOnce(new Error("exchange down"))
      .mockRejectedValueOnce({ response: { data: { error: { message: "debug also down" } } } });
    await expect(meta.adoptToken("bad")).rejects.toThrow("debug also down");
  });

  it("stores the raw token with no expiry when the app isn't configured (no upgrade attempted)", async () => {
    cfg.meta.appSecret = "";
    const r = await meta.adoptToken("raw-token");
    expect(r).toEqual({ ok: true, longLived: false, expiresAt: null, note: "no_app_creds" });
    expect(axiosGet).not.toHaveBeenCalled();
    expect(settings.meta_access_token).toBe("raw-token");
  });
});

describe("ensureFresh()", () => {
  it("no-ops when the app isn't configured", async () => {
    cfg.meta.appSecret = "";
    expect(await meta.ensureFresh()).toEqual({ refreshed: false, reason: "no_app_creds" });
  });

  it("no-ops when there's no token at all", async () => {
    cfg.meta.token = null;
    expect(await meta.ensureFresh()).toEqual({ refreshed: false, reason: "no_token" });
    cfg.meta.token = "ENV_SEED_TOKEN";
  });

  it("does nothing yet when more than 10 days remain", async () => {
    settings.meta_access_token = "T";
    settings.meta_token_expires_at = String(Date.now() + 20 * 86400000);
    const r = await meta.ensureFresh();
    expect(r.refreshed).toBe(false);
    expect(r.daysLeft).toBe(20);
  });

  it("re-exchanges when fewer than 10 days remain, and succeeds", async () => {
    settings.meta_access_token = "T";
    settings.meta_token_expires_at = String(Date.now() + 3 * 86400000);
    axiosGet.mockResolvedValueOnce({ data: { access_token: "FRESH", expires_in: 5184000 } });
    const r = await meta.ensureFresh();
    expect(r.refreshed).toBe(true);
    expect(settings.meta_access_token).toBe("FRESH");
  });

  it("reports the error instead of throwing when the refresh exchange fails", async () => {
    settings.meta_access_token = "T";
    settings.meta_token_expires_at = String(Date.now() + 3 * 86400000);
    axiosGet.mockRejectedValueOnce(new Error("rate limited"));
    const r = await meta.ensureFresh();
    expect(r).toEqual({ refreshed: false, error: "rate limited" });
  });

  it("learns the expiry via debug_token when none is stored yet", async () => {
    settings.meta_access_token = "T"; // no meta_token_expires_at stored
    axiosGet.mockResolvedValueOnce({ data: { data: { is_valid: true, expires_at: Math.floor(Date.now() / 1000) + 20 * 86400 } } });
    const r = await meta.ensureFresh();
    expect(r.refreshed).toBe(false);
    expect(r.daysLeft).toBe(20);
  });
});

describe("status()", () => {
  it("reports not connected when no token exists", async () => {
    cfg.meta.token = null; // no DB setting either — nothing for getToken() to fall back to
    const r = await meta.status();
    cfg.meta.token = "ENV_SEED_TOKEN";
    expect(r).toMatchObject({ connected: false, appConfigured: true, accountId: "act_1" });
    expect(r.redirectUri).toBe("http://localhost:3000/api/meta/callback");
  });

  it("reports valid + scopes when connected and the debug check succeeds", async () => {
    settings.meta_access_token = "T";
    axiosGet.mockResolvedValueOnce({ data: { data: { is_valid: true, expires_at: Math.floor(Date.now() / 1000) + 864000, scopes: ["ads_read"] } } });
    const r = await meta.status();
    expect(r.connected).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.daysLeft).toBe(10);
    expect(r.scopes).toEqual(["ads_read"]);
  });

  it("surfaces the debug-check error without throwing", async () => {
    settings.meta_access_token = "T";
    axiosGet.mockRejectedValueOnce({ response: { data: { error: { message: "token revoked" } } } });
    const r = await meta.status();
    expect(r.connected).toBe(true);
    expect(r.valid).toBeNull();
    expect(r.error).toBe("token revoked");
  });

  it("skips the debug check entirely when the app isn't configured", async () => {
    settings.meta_access_token = "T";
    cfg.meta.appSecret = "";
    const r = await meta.status();
    expect(r.connected).toBe(true);
    expect(r.valid).toBeNull();
    expect(axiosGet).not.toHaveBeenCalled();
  });
});

describe("disconnect()", () => {
  it("removes both the token and expiry settings", async () => {
    settings.meta_access_token = "T";
    settings.meta_token_expires_at = "123";
    expect(await meta.disconnect()).toEqual({ ok: true });
    expect(settings.meta_access_token).toBeUndefined();
    expect(settings.meta_token_expires_at).toBeUndefined();
  });
});

describe("buildAuthUrl()", () => {
  it("builds a Facebook OAuth dialog URL carrying the app id, redirect, scope and state", () => {
    const url = meta.buildAuthUrl("csrf123");
    expect(url).toMatch(/^https:\/\/www\.facebook\.com\/v20\.0\/dialog\/oauth\?/);
    const q = new URL(url).searchParams;
    expect(q.get("client_id")).toBe("APPID");
    expect(q.get("redirect_uri")).toBe("http://localhost:3000/api/meta/callback");
    expect(q.get("scope")).toBe("ads_read");
    expect(q.get("state")).toBe("csrf123");
  });
});

describe("handleCallback()", () => {
  it("exchanges the OAuth code for a token, then adopts it", async () => {
    axiosGet
      .mockResolvedValueOnce({ data: { access_token: "OAUTH_SHORT" } }) // code -> token exchange
      .mockResolvedValueOnce({ data: { access_token: "OAUTH_LONG", expires_in: 5184000 } }); // adoptToken's long-lived exchange
    const r = await meta.handleCallback("auth-code-xyz");
    expect(r).toMatchObject({ ok: true, longLived: true });
    expect(settings.meta_access_token).toBe("OAUTH_LONG");
    expect(axiosGet.mock.calls[0][1].params.code).toBe("auth-code-xyz");
  });
});
