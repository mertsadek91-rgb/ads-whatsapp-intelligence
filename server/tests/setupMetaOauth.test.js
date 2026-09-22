// Signing in with Facebook from the WIZARD, not just from Settings.
//
// The Settings page has offered one-click sign-in from the start. The wizard
// asked for a manually created access token instead — the hardest single field
// in the installation to produce. Moving the same flow into the wizard means
// doing it without the two things the Settings route relies on: a session to
// hold the CSRF state, and an admin account to authorise it. Neither exists
// during setup. These pin what replaced them.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const saved = [];
vi.mock("../src/lib/appConfig.js", () => ({
  saveConfig: vi.fn(async (patch) => { saved.push(patch); return { saved: 1 }; }),
  hydrate: vi.fn(async () => ({ applied: 0 })),
}));

const handleCallback = vi.fn(async () => ({ ok: true }));
let storedToken = null;
vi.mock("../src/lib/metaAuth.js", () => ({
  buildAuthUrl: (state) => `https://www.facebook.com/v21.0/dialog/oauth?state=${state}`,
  handleCallback: (...a) => handleCallback(...a),
  getToken: vi.fn(async () => storedToken),
}));

const metaValidate = vi.fn(async (body) => ({ ok: true, details: { seenToken: body.token } }));
vi.mock("../src/setup/validators/meta.js", () => ({
  validate: (...a) => metaValidate(...a),
  redirectUri: (base) => `${base}/api/meta/callback`,
}));

// Access control is covered by setupRoutes.test.js; here it would only be noise.
vi.mock("../src/middleware/setupAccess.js", () => ({
  requireSetupAccess: (req, res, next) => next(),
  requireNotInstalled: (req, res, next) => next(),
  requireClaim: (req, res, next) => next(),
  claim: () => ({ ok: true, claim: { id: "x", ip: "::1", at: Date.now() } }),
  ensureInstallToken: () => "t".repeat(64),
  activeClaim: () => null,
}));

vi.mock("../src/db.js", () => ({ query: vi.fn(async () => []), resetPool: vi.fn(async () => {}) }));

const state = await import("../src/lib/setupState.js");
const { default: setupRoutes, metaOauthCallback } = await import("../src/routes/setup.js");

const app = express();
app.use(express.json());
app.use("/api/setup", setupRoutes);
app.get("/api/meta/callback", metaOauthCallback);

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "oauth-"));
  process.env.DATA_DIR = dir;
  state._resetCache();
  saved.length = 0;
  storedToken = null;
  handleCallback.mockClear();
  metaValidate.mockClear();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  state._resetCache();
});

const startOauth = () => request(app).post("/api/setup/meta/oauth/start")
  .send({ appId: "111", appSecret: "shhh" });

describe("starting the sign-in", () => {
  it("refuses without the app credentials, which are what identify the app", async () => {
    const r = await request(app).post("/api/setup/meta/oauth/start").send({ appId: "111" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("META_APP_MISSING");
  });

  it("stores the app id and secret, because buildAuthUrl reads them from config", async () => {
    await startOauth();
    expect(saved[0]).toEqual({ "meta.appId": "111", "meta.appSecret": "shhh" });
  });

  it("issues a one-shot state and remembers it server-side", async () => {
    // There is no session during setup, so setup.json holds what ties the
    // redirect back to the request that started it.
    const r = await startOauth();
    const issued = new URL(r.body.url).searchParams.get("state");
    expect(issued).toMatch(/^[0-9a-f]{32}$/);
    expect(state.readState().metaOauthState).toBe(issued);
  });
});

describe("the redirect back from Facebook", () => {
  const callback = (q) => request(app).get("/api/meta/callback").query(q);

  it("exchanges the code and returns to the wizard", async () => {
    const r0 = await startOauth();
    const issued = new URL(r0.body.url).searchParams.get("state");

    const r = await callback({ code: "abc", state: issued });
    expect(handleCallback).toHaveBeenCalledWith("abc");
    expect(r.headers.location).toBe("/setup?meta=connected");
  });

  it("refuses a state that does not match, and exchanges nothing", async () => {
    await startOauth();
    const r = await callback({ code: "abc", state: "not-the-one" });
    expect(handleCallback).not.toHaveBeenCalled();
    expect(r.headers.location).toMatch(/meta=error/);
  });

  it("refuses a replay of a state already used", async () => {
    const r0 = await startOauth();
    const issued = new URL(r0.body.url).searchParams.get("state");
    await callback({ code: "abc", state: issued });
    handleCallback.mockClear();

    const replay = await callback({ code: "abc", state: issued });
    expect(handleCallback).not.toHaveBeenCalled();
    expect(replay.headers.location).toMatch(/meta=error/);
  });

  it("carries Facebook's own refusal back rather than a generic failure", async () => {
    await startOauth();
    const r = await callback({ error: "access_denied", error_description: "User denied" });
    // Read it as a query parameter rather than decoding the string: the encoder
    // writes a space as "+", which decodeURIComponent does not undo.
    const msg = new URL(r.headers.location, "http://x").searchParams.get("msg");
    expect(msg).toBe("User denied");
  });
});

describe("the token from the sign-in is used without passing through the browser", () => {
  it("substitutes the stored token when the operator typed none", async () => {
    // The validators are pure and never read config — that is what lets the
    // Settings page reuse them — so the substitution happens at the route.
    storedToken = "long-lived-from-facebook";
    await request(app).post("/api/setup/meta/test").send({ appId: "111", accountId: "act1" });
    expect(metaValidate.mock.calls[0][0].token).toBe("long-lived-from-facebook");
  });

  it("leaves a token the operator DID type alone", async () => {
    storedToken = "long-lived-from-facebook";
    await request(app).post("/api/setup/meta/test").send({ token: "typed-by-hand" });
    expect(metaValidate.mock.calls[0][0].token).toBe("typed-by-hand");
  });

  it("does not invent one when there is neither", async () => {
    await request(app).post("/api/setup/meta/test").send({ appId: "111" });
    expect(metaValidate.mock.calls[0][0].token).toBeUndefined();
  });
});
