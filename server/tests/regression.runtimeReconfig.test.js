// The whole point of the config refactor: a credential saved from the browser
// must take effect in the running process.
//
// Before this, meta.js, wati.js, metaAuth.js and ingestMeta.js each copied a
// config value into a module-level `const` at import time. A setup wizard
// writing the ad account or the Wati token into the database would have had no
// effect at all until someone restarted the container — and nothing would have
// said so. Every test here fails against that arrangement.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockConfig = {
  mysql: { host: "h", port: 3306, user: "u", password: "p", database: "d" },
  meta: { apiVersion: "v21.0", accountId: "", token: "t", appId: "", appSecret: "", scopes: "", lookbackDays: 30, periodSince: "" },
  wati: { endpoint: "", token: "" },
  smtp: { host: "", port: 587, secure: false, user: "", pass: "", from: "" },
  deepseek: {}, auth: {}, workHours: { start: 9, end: 17, offDays: [0, 6] },
};
vi.mock("../src/config.js", () => ({ default: mockConfig, config: mockConfig }));
vi.mock("../src/lib/metaAuth.js", () => ({ getToken: vi.fn(async () => "tok") }));

const captured = [];
vi.mock("axios", () => {
  const get = vi.fn(async (url) => { captured.push(url); return { data: { data: [] } }; });
  const create = vi.fn((opts) => ({
    get: vi.fn(async (path) => { captured.push((opts.baseURL || "") + path); return { data: { result: true, contact_list: [] } }; }),
    post: vi.fn(async (path) => { captured.push((opts.baseURL || "") + path); return { data: {} }; }),
  }));
  return { default: { get, create }, get, create };
});

beforeEach(() => { captured.length = 0; });
afterEach(() => vi.resetModules());

describe("Meta client reads the ad account per call, not at import", () => {
  it("uses the account configured now, not the one set when the module loaded", async () => {
    mockConfig.meta.accountId = "";                 // nothing configured at import
    const meta = await import("../src/lib/meta.js");

    // A wizard save happens while the process is running:
    mockConfig.meta.accountId = "111222333";
    await meta.adPeriod("2026-01-01", "2026-01-31").catch(() => {});
    expect(captured.some((u) => u.includes("act_111222333"))).toBe(true);

    // ...and again, to a different account, still with no restart.
    captured.length = 0;
    mockConfig.meta.accountId = "999888777";
    await meta.adPeriod("2026-01-01", "2026-01-31").catch(() => {});
    expect(captured.some((u) => u.includes("act_999888777"))).toBe(true);
  });

  it("refuses clearly instead of requesting act_ with nothing after it", async () => {
    mockConfig.meta.accountId = "";
    const meta = await import("../src/lib/meta.js");
    await expect(meta.adPeriod("2026-01-01", "2026-01-31")).rejects.toThrow(/not configured|مهيّأ/);
    expect(captured.some((u) => u.includes("act_/") || u.includes("act_undefined"))).toBe(false);
  });

  it("follows a change to the Graph API version", async () => {
    mockConfig.meta.accountId = "1";
    mockConfig.meta.apiVersion = "v23.0";
    const meta = await import("../src/lib/meta.js");
    await meta.adPeriod("2026-01-01", "2026-01-31").catch(() => {});
    expect(captured.some((u) => u.includes("/v23.0/"))).toBe(true);
    mockConfig.meta.apiVersion = "v21.0";
  });
});

describe("Wati client is rebuilt when the endpoint or token changes", () => {
  it("sends to the endpoint configured now", async () => {
    mockConfig.wati.endpoint = "https://old-server.wati.io/1";
    mockConfig.wati.token = "old";
    const wati = await import("../src/lib/wati.js");

    mockConfig.wati.endpoint = "https://live-mt-server.wati.io/9999";
    mockConfig.wati.token = "new";
    for await (const _ of wati.iterContacts()) break;

    expect(captured.some((u) => u.includes("live-mt-server.wati.io/9999"))).toBe(true);
    expect(captured.some((u) => u.includes("old-server"))).toBe(false);
  });

  it("derives the tenant id from the token when the endpoint omits it", async () => {
    const payload = Buffer.from(JSON.stringify({ tenant_id: "424242" })).toString("base64");
    mockConfig.wati.endpoint = "https://live-mt-server.wati.io";
    mockConfig.wati.token = `x.${payload}.y`;
    const wati = await import("../src/lib/wati.js");
    expect(wati.watiBase()).toBe("https://live-mt-server.wati.io/424242");
  });
});

describe("app_config hydration", () => {
  it("applies stored rows over the environment defaults and ignores unknown keys", async () => {
    vi.resetModules();
    vi.doMock("../src/config.js", () => ({ default: mockConfig, config: mockConfig }));
    vi.doMock("../src/db.js", () => ({
      query: vi.fn(async () => [
        { k: "meta.accountId", v: "act_555", is_secret: 0 },
        { k: "meta.lookbackDays", v: "45", is_secret: 0 },
        { k: "workHours.offDays", v: "5", is_secret: 0 },
        { k: "totally.unknown", v: "rm -rf", is_secret: 0 },   // must be ignored
      ]),
    }));
    const appConfig = await import("../src/lib/appConfig.js");
    const r = await appConfig.hydrate();

    expect(mockConfig.meta.accountId).toBe("555");     // act_ prefix stripped
    expect(mockConfig.meta.lookbackDays).toBe(45);     // coerced to a number
    expect(mockConfig.workHours.offDays).toEqual([5]); // coerced to a list
    expect(mockConfig.totally).toBeUndefined();        // never set an unknown key
    expect(r.applied).toBe(3);
    expect(r.skipped).toBe(1);
  });

  it("notifies listeners so memoised clients drop their cached settings", async () => {
    vi.resetModules();
    vi.doMock("../src/config.js", () => ({ default: mockConfig, config: mockConfig }));
    vi.doMock("../src/db.js", () => ({ query: vi.fn(async () => []) }));
    const appConfig = await import("../src/lib/appConfig.js");
    const seen = vi.fn();
    appConfig.onConfigChange(seen);
    await appConfig.hydrate();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("encrypts credentials on save and never returns them in full", async () => {
    vi.resetModules();
    vi.doMock("../src/config.js", () => ({ default: mockConfig, config: mockConfig }));
    const written = [];
    vi.doMock("../src/db.js", () => ({
      query: vi.fn(async (sql, p = []) => {
        if (sql.startsWith("insert into app_config")) { written.push(p); return {}; }
        return written.map(([k, v, is_secret]) => ({ k, v, is_secret }));
      }),
    }));
    const box = await import("../src/lib/secretBox.js");
    box.setKeyProvider(() => "f".repeat(64));
    const appConfig = await import("../src/lib/appConfig.js");

    await appConfig.saveConfig({ "wati.token": "super-secret-token", "meta.accountId": "777" });

    const tokenRow = written.find(([k]) => k === "wati.token");
    expect(tokenRow[1]).not.toContain("super-secret-token"); // stored encrypted
    expect(tokenRow[2]).toBe(1);
    const acctRow = written.find(([k]) => k === "meta.accountId");
    expect(acctRow[2]).toBe(0);                              // not a secret

    // ...and it decrypts back into the live config, with no restart.
    expect(mockConfig.wati.token).toBe("super-secret-token");
    expect(appConfig.describeConfig()["wati.token"]).toBe("••••oken");
  });
});
