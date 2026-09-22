// The wizard's job is not to accept credentials — it is to prove they work and,
// when they don't, say something an operator can act on. These tests pin the
// translation from a raw driver/API error to that guidance.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mysqlMock = { createConnection: vi.fn() };
vi.mock("mysql2/promise", () => ({ default: mysqlMock }));

const axiosMock = { get: vi.fn(), post: vi.fn(), create: vi.fn() };
vi.mock("axios", () => ({ default: axiosMock }));

const dbV = await import("../src/setup/validators/db.js");
const metaV = await import("../src/setup/validators/meta.js");
const watiV = await import("../src/setup/validators/wati.js");
const aiV = await import("../src/setup/validators/ai.js");
const site = await import("../src/lib/siteFetch.js");

const dbInput = { host: "h", port: 3306, user: "u", password: "p", database: "d" };
const connThrowing = (err) => { mysqlMock.createConnection.mockRejectedValueOnce(err); };
const err = (code, errno) => Object.assign(new Error(code), { code, errno });

beforeEach(() => { vi.clearAllMocks(); });

describe("database validator", () => {
  it.each([
    ["ECONNREFUSED", undefined, "DB_CONN_REFUSED"],
    ["ENOTFOUND", undefined, "DB_DNS"],
    ["ETIMEDOUT", undefined, "DB_TIMEOUT"],
    ["ER_ACCESS_DENIED_ERROR", 1045, "DB_ACCESS_DENIED"],
    ["ER_HOST_NOT_PRIVILEGED", 1130, "DB_HOST_NOT_PRIVILEGED"],
    ["ER_BAD_DB_ERROR", 1049, "DB_NO_DATABASE"],
    ["ER_DBACCESS_DENIED_ERROR", 1044, "DB_NO_SCHEMA_ACCESS"],
    ["ER_NOT_SUPPORTED_AUTH_MODE", 1251, "DB_AUTH_PLUGIN"],
  ])("maps %s to %s", async (code, errno, expected) => {
    connThrowing(err(code, errno));
    const r = await dbV.validate(dbInput);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(expected);
    expect(r.ar).toBeTruthy();   // never a bare driver string
    expect(r.en).toBeTruthy();
  });

  it("offers to create the database rather than just reporting it missing", async () => {
    connThrowing(err("ER_BAD_DB_ERROR", 1049));
    const r = await dbV.validate(dbInput);
    expect(r.action).toBe("create_database");
  });

  it("refuses a server too old for the schema, on either product", () => {
    // Accepting a server that cannot run what we write means ensureSchema
    // succeeds and every later write fails — a far worse failure than refusing
    // here. The floor is what the SCHEMA needs (JSON columns), not a syntax
    // version: the upserts are written in a form both products accept.
    expect(dbV.versionAtLeast("8.0.19")).toBe(true);
    expect(dbV.versionAtLeast("8.4.0")).toBe(true);
    expect(dbV.versionAtLeast("5.7.44")).toBe(true);
    expect(dbV.versionAtLeast("5.6.51")).toBe(false);
    // MariaDB's number looks newer than MySQL's and means something else, so it
    // is measured against its own floor rather than sailing past MySQL's.
    expect(dbV.versionAtLeast("11.8.9-MariaDB-log")).toBe(true);
    expect(dbV.versionAtLeast("10.2.0-MariaDB")).toBe(true);
    expect(dbV.versionAtLeast("10.1.9-MariaDB")).toBe(false);
    expect(dbV.versionAtLeast("garbage")).toBe(false);
  });

  it("proves CREATE TABLE before the schema step, not during it", async () => {
    // ensureSchema runs 646 lines over a multipleStatements connection; finding
    // out mid-script leaves a half-built schema behind a progress bar.
    const c = {
      query: vi.fn()
        .mockResolvedValueOnce([[{ v: "8.0.36" }]])                 // version()
        .mockResolvedValueOnce([[{ Value: "utf8mb4" }]])            // charset
        .mockRejectedValueOnce(err("ER_TABLEACCESS_DENIED_ERROR")), // create probe
      end: vi.fn(async () => {}),
    };
    mysqlMock.createConnection.mockResolvedValueOnce(c);
    const r = await dbV.validate(dbInput);
    expect(r.code).toBe("DB_NO_CREATE_PRIVILEGE");
    expect(r.fix).toMatch(/GRANT/);
  });

  it("warns, but does not block, on a non-utf8mb4 server", async () => {
    const c = {
      query: vi.fn()
        .mockResolvedValueOnce([[{ v: "8.0.36" }]])
        .mockResolvedValueOnce([[{ Value: "latin1" }]])
        .mockResolvedValueOnce([[]])                       // create probe
        .mockResolvedValueOnce([[]])                       // drop probe
        .mockResolvedValueOnce([[{ n: 12 }]]),             // table count
      end: vi.fn(async () => {}),
    };
    mysqlMock.createConnection.mockResolvedValueOnce(c);
    const r = await dbV.validate(dbInput);
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain("DB_WRONG_CHARSET");
    expect(r.details.existingTables).toBe(12);
  });

  it("refuses a database name that is not a plain identifier", async () => {
    const r = await dbV.createDatabase({ ...dbInput, database: "d`; drop schema x; --" });
    expect(r.ok).toBe(false);
    expect(mysqlMock.createConnection).not.toHaveBeenCalled();
  });
});

describe("Meta validator", () => {
  const fbErr = (code, sub, message = "") =>
    Object.assign(new Error("fb"), { response: { data: { error: { code, error_subcode: sub, message } } } });

  it.each([
    [190, undefined, "META_TOKEN_EXPIRED"],
    [200, undefined, "META_MISSING_PERMISSION"],
    [10, undefined, "META_APP_DEV_MODE"],
    [803, undefined, "META_BAD_AD_ACCOUNT"],
    [2635, undefined, "META_DEPRECATED_VERSION"],
    [4, undefined, "META_RATE_LIMITED"],
  ])("maps Graph error code %s to %s", (code, sub, expected) => {
    expect(metaV.classify(fbErr(code, sub))).toBe(expected);
  });

  it("maps code 100 subcode 33 to a bad ad account, not a generic failure", () => {
    expect(metaV.classify(fbErr(100, 33))).toBe("META_BAD_AD_ACCOUNT");
  });

  it("refuses a token missing ads_read, naming the scopes it does have", async () => {
    axiosMock.get.mockResolvedValueOnce({ data: { data: { is_valid: true, scopes: ["public_profile"] } } });
    const r = await metaV.validate({ appId: "a", appSecret: "s", token: "t" });
    expect(r.code).toBe("META_MISSING_PERMISSION");
    expect(r.detail).toContain("public_profile");
    expect(r.action).toBe("reconnect");
  });

  it("returns the ad accounts as a picker instead of asking for a numeric id", async () => {
    axiosMock.get
      .mockResolvedValueOnce({ data: { data: { is_valid: true, scopes: ["ads_read", "business_management"] } } })
      .mockResolvedValueOnce({ data: { data: [
        { account_id: "111", name: "Main", currency: "USD", account_status: 1, timezone_name: "UTC" },
      ] } });
    const r = await metaV.validate({ appId: "a", appSecret: "s", token: "t" });
    expect(r.ok).toBe(true);
    expect(r.details.adAccounts[0]).toMatchObject({ id: "111", name: "Main", currency: "USD" });
  });

  it("normalises the act_ prefix on the way in", async () => {
    axiosMock.get
      .mockResolvedValueOnce({ data: { data: { is_valid: true, scopes: ["ads_read", "business_management"] } } })
      .mockResolvedValueOnce({ data: { data: [] } })
      .mockResolvedValueOnce({ data: { data: [{ spend: "12.5" }] } })
      .mockResolvedValueOnce({ data: { data: [] } });
    const r = await metaV.validate({ appId: "a", appSecret: "s", token: "t", accountId: "act_999" });
    expect(r.ok).toBe(true);
    expect(r.details.accountId).toBe("999");
    expect(axiosMock.get.mock.calls[2][0]).toContain("act_999/insights");
  });

  it("shows the redirect URI verbatim, since a mismatch is the usual OAuth failure", () => {
    expect(metaV.redirectUri("https://app.example.com/")).toBe("https://app.example.com/api/meta/callback");
  });
});

describe("Wati validator", () => {
  it("appends the tenant id from the token when the endpoint omits it", () => {
    const payload = Buffer.from(JSON.stringify({ tenant_id: "1051066" })).toString("base64");
    const r = watiV.normalizeEndpoint("https://live-mt-server.wati.io", `a.${payload}.b`);
    expect(r.base).toBe("https://live-mt-server.wati.io/1051066");
    expect(r.corrections).toContain("WATI_TENANT_FIXED");
  });

  it("leaves an endpoint that already carries a tenant id alone", () => {
    const r = watiV.normalizeEndpoint("https://live-mt-server.wati.io/1051066", "x.y.z");
    expect(r.base).toBe("https://live-mt-server.wati.io/1051066");
    expect(r.corrections).toEqual([]);
  });

  it("strips a pasted /api/v1 suffix that would otherwise double up", () => {
    const payload = Buffer.from(JSON.stringify({ tenant_id: "7" })).toString("base64");
    const r = watiV.normalizeEndpoint("https://live-mt-server.wati.io/api/v1", `a.${payload}.b`);
    expect(r.base).toBe("https://live-mt-server.wati.io/7");
  });

  it("recognises the dashboard URL, which is the most common wrong answer", async () => {
    const r = await watiV.validate({ endpoint: "https://app.wati.io", token: "t" });
    expect(r.code).toBe("WATI_DASHBOARD_URL");
  });

  it("reports a 401 as a token problem with the place to get a new one", async () => {
    axiosMock.create.mockReturnValue({
      get: vi.fn().mockRejectedValue(Object.assign(new Error("401"), { response: { status: 401 } })),
    });
    const r = await watiV.validate({ endpoint: "https://live-mt-server.wati.io/1", token: "t" });
    expect(r.code).toBe("WATI_UNAUTHORIZED");
    expect(r.docUrl).toBeTruthy();
  });

  it("derives the connected WhatsApp numbers, since Wati exposes no channel list", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ data: { link: { total: 42 } } })                      // getContacts probe
      .mockResolvedValueOnce({ data: { messageTemplates: [{}, {}] } })               // templates
      .mockResolvedValueOnce({ data: { contact_list: [
        { customParams: [{ name: "whatsapp_971500000001" }] },
        { customParams: [{ name: "whatsapp_971500000002" }] },
        { customParams: [{ name: "whatsapp_971500000001" }] },
      ] } });
    axiosMock.create.mockReturnValue({ get });
    const r = await watiV.validate({ endpoint: "https://live-mt-server.wati.io/1", token: "t" });
    expect(r.ok).toBe(true);
    expect(r.details.contactCount).toBe(42);
    expect(r.details.channels.sort()).toEqual(["971500000001", "971500000002"]);
  });
});

describe("AI validator", () => {
  it("distinguishes an empty balance from a bad key", async () => {
    // The failure most often misread as "wrong key" — worth its own message.
    axiosMock.get.mockRejectedValueOnce(
      Object.assign(new Error("402"), { response: { status: 402, data: { error: { message: "Insufficient Balance" } } } }));
    const r = await aiV.validate({ apiKey: "k" });
    expect(r.code).toBe("AI_NO_BALANCE");
    expect(r.docUrl).toContain("top_up");
  });

  it("reports a bad key as a bad key", async () => {
    axiosMock.get.mockRejectedValueOnce(Object.assign(new Error("401"), { response: { status: 401 } }));
    const r = await aiV.validate({ apiKey: "k" });
    expect(r.code).toBe("AI_UNAUTHORIZED");
  });

  it("returns the model list so the UI can offer a dropdown, not a text box", async () => {
    axiosMock.get.mockResolvedValueOnce({ data: { data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }] } });
    axiosMock.post.mockResolvedValueOnce({ data: { usage: { prompt_tokens: 3, completion_tokens: 1 } } });
    const r = await aiV.validate({ apiKey: "k", model: "deepseek-v4-flash" });
    expect(r.ok).toBe(true);
    expect(r.details.models).toContain("deepseek-v4-pro");
    expect(r.details.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("warns when the chosen model is not in the provider's list", async () => {
    axiosMock.get.mockResolvedValueOnce({ data: { data: [{ id: "deepseek-v4-flash" }] } });
    axiosMock.post.mockResolvedValueOnce({ data: { usage: {} } });
    const r = await aiV.validate({ apiKey: "k", model: "retired-model" });
    expect(r.warnings).toContain("AI_BAD_MODEL");
  });
});

describe("website fetch refuses to be used as a port scanner", () => {
  // This is the one place the server requests a URL a user typed. Left
  // unguarded it would read cloud instance metadata (i.e. credentials) or
  // anything else inside the deployment network and feed it to an AI.
  it.each([
    "127.0.0.1", "10.0.0.1", "192.168.1.1", "172.16.0.1",
    "169.254.169.254",          // cloud instance metadata
    "100.64.0.1",               // CGNAT
    "0.0.0.0",
  ])("refuses the private address %s", async (ip) => {
    await expect(site.assertPublicUrl(`http://${ip}/`)).rejects.toThrow("SITE_PRIVATE_ADDRESS");
  });

  it.each(["::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])("refuses the IPv6 address %s", async (ip) => {
    await expect(site.assertPublicUrl(`http://[${ip}]/`)).rejects.toThrow("SITE_PRIVATE_ADDRESS");
  });

  it.each(["file:///etc/passwd", "gopher://x/", "ftp://x/"])("refuses the scheme in %s", async (url) => {
    await expect(site.assertPublicUrl(url)).rejects.toThrow("SITE_PRIVATE_ADDRESS");
  });

  it("refuses a public hostname that resolves to a private address", async () => {
    // The standard bypass: the name looks fine, the A record points inside.
    const resolver = { lookup: async () => [{ address: "10.1.2.3" }] };
    await expect(site.assertPublicUrl("https://evil.example.com/", { resolver }))
      .rejects.toThrow("SITE_PRIVATE_ADDRESS");
  });

  it("refuses when ANY resolved address is private, not just the first", async () => {
    const resolver = { lookup: async () => [{ address: "93.184.216.34" }, { address: "127.0.0.1" }] };
    await expect(site.assertPublicUrl("https://mixed.example.com/", { resolver }))
      .rejects.toThrow("SITE_PRIVATE_ADDRESS");
  });

  it("allows a genuinely public address", async () => {
    const resolver = { lookup: async () => [{ address: "93.184.216.34" }] };
    await expect(site.assertPublicUrl("https://example.com/", { resolver })).resolves.toContain("example.com");
  });
});

describe("website text extraction", () => {
  it("drops script, style and navigation chrome", () => {
    const text = site.extractText(
      "<nav>Home About</nav><script>var x=1</script><style>a{}</style><p>We sell bicycles.</p><footer>x</footer>");
    expect(text).toContain("We sell bicycles.");
    expect(text).not.toContain("var x");
    expect(text).not.toContain("Home About");
  });

  it("decodes entities so Arabic and punctuation survive", () => {
    expect(site.extractText("<p>Tom &amp; Jerry &quot;quoted&quot;</p>")).toBe('Tom & Jerry "quoted"');
  });

  it("prefers the pages that actually describe the business", () => {
    const html = `
      <a href="/blog/post-12">A blog post</a>
      <a href="/about">About us</a>
      <a href="/terms">Terms and conditions</a>
      <a href="https://twitter.com/x">Twitter</a>`;
    const ranked = site.rankCandidatePages(html, "https://example.com/");
    expect(ranked[0]).toContain("/about");
    expect(ranked.some((u) => u.includes("/terms"))).toBe(true);
    expect(ranked.some((u) => u.includes("twitter.com"))).toBe(false); // off-origin
    expect(ranked.some((u) => u.includes("/blog/"))).toBe(false);      // not informative
  });
});
