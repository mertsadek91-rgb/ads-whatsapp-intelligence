// The installation wizard's access model. There is no database and therefore
// no session while this runs, so the guarantees have to come from somewhere
// else: an install token, a single-operator claim, and a hard stop once the
// app is installed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as state from "../src/lib/setupState.js";
import {
  requireSetupAccess, requireNotInstalled, requireClaim, claim, ensureInstallToken, isLocalRequest,
} from "../src/middleware/setupAccess.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "setuproutes-"));
  process.env.DATA_DIR = dir;
  state._resetCache();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  state._resetCache();
});

const guarded = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get("/open", (_req, res) => res.json({ ok: true }));
  app.use(requireNotInstalled, requireSetupAccess, requireClaim);
  app.post("/step", (_req, res) => res.json({ ok: true }));
  return app;
};

describe("install token", () => {
  it("is generated once and reused across restarts", () => {
    const a = ensureInstallToken();
    state._resetCache();
    expect(ensureInstallToken()).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a wrong token from a non-local address", async () => {
    ensureInstallToken();
    const r = await request(guarded()).post("/step")
      .set("X-Forwarded-For", "203.0.113.9")     // makes the request non-local
      .set("Authorization", "Bearer wrong")
      .send({});
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("setup_token_required");
  });

  it("accepts the right token from anywhere", async () => {
    const token = ensureInstallToken();
    const r = await request(guarded()).post("/step")
      .set("X-Forwarded-For", "203.0.113.9")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(r.status).toBe(200);
  });

  it("never asks someone on the machine for a token, even once a claim exists", async () => {
    // The bug this pins: requireSetupAccess also demanded !activeClaim, so the
    // moment ANY claim existed — including a stale one left by a restart — a
    // local operator was asked for a token printed in a log they may no longer
    // have. Being on the machine is the access answer; who holds the installer
    // is requireClaim's job, and it refuses a second operator on its own.
    ensureInstallToken();
    claim({ ip: "127.0.0.1" });                    // somebody already claimed
    const r = await request(guarded()).post("/step").send({});
    expect(r.status).not.toBe(401);
  });

  it("still demands the token from a remote caller once a claim exists", async () => {
    ensureInstallToken();
    claim({ ip: "127.0.0.1" });
    const r = await request(guarded()).post("/step")
      .set("X-Forwarded-For", "203.0.113.9").send({});
    expect(r.status).toBe(401);
  });

  it("does not leak the token from the open status route", async () => {
    const token = ensureInstallToken();
    const r = await request(guarded()).get("/open");
    expect(JSON.stringify(r.body)).not.toContain(token);
  });
});

describe("a request through a proxy is never treated as local", () => {
  // The hole this closes: with a reverse proxy on the same host and the default
  // TRUST_PROXY_HOPS=0, req.ip is 127.0.0.1 for EVERY request including ones
  // from the public internet. Trusting req.ip alone would have handed the
  // installation wizard to anyone who found the URL.
  const reqWith = (ip, headers = {}) => ({
    ip,
    get: (h) => headers[String(h).toLowerCase()] || undefined,
  });

  it("treats a genuine loopback request as local", () => {
    expect(isLocalRequest(reqWith("127.0.0.1"))).toBe(true);
    expect(isLocalRequest(reqWith("::1"))).toBe(true);
    expect(isLocalRequest(reqWith("::ffff:127.0.0.1"))).toBe(true);
  });

  it.each(["x-forwarded-for", "x-real-ip", "forwarded", "x-forwarded-host"])(
    "treats loopback carrying %s as remote", (header) => {
      expect(isLocalRequest(reqWith("127.0.0.1", { [header]: "203.0.113.9" }))).toBe(false);
    });

  it("treats any non-loopback address as remote", () => {
    expect(isLocalRequest(reqWith("203.0.113.9"))).toBe(false);
    expect(isLocalRequest(reqWith("10.0.0.5"))).toBe(false);
  });
});

describe("one operator at a time", () => {
  it("lets the first caller claim and refuses the second", () => {
    const req = { ip: "127.0.0.1" };
    expect(claim(req).ok).toBe(true);
    const second = claim({ ip: "10.0.0.9" });
    expect(second.ok).toBe(false);
    expect(second.claim.ip).toBe("127.0.0.1");
  });

  it("allows an explicit takeover", () => {
    claim({ ip: "127.0.0.1" });
    expect(claim({ ip: "10.0.0.9" }, { takeover: true }).ok).toBe(true);
    expect(state.readState().claim.ip).toBe("10.0.0.9");
  });

  it("tells the second operator who holds it, so they can decide", async () => {
    const token = ensureInstallToken();
    claim({ ip: "192.0.2.5" });
    const r = await request(guarded()).post("/step")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Setup-Claim", "not-the-right-claim")
      .send({});
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("setup_in_progress");
    expect(r.body.claimedFrom).toBe("192.0.2.5");
  });

  it("lets the SAME operator re-claim, which is what every step does", () => {
    // The bug this pins: the wizard claims before every action. Treating the
    // second claim as a conflict told the operator that "someone else" held the
    // installer — quoting their own address back at them — and made it
    // impossible to get past the first step.
    const first = claim({ ip: "127.0.0.1" });
    expect(first.ok).toBe(true);

    const again = claim({
      ip: "127.0.0.1",
      get: (h) => (String(h).toLowerCase() === "x-setup-claim" ? first.claim.id : undefined),
    });
    expect(again.ok).toBe(true);
    expect(again.reused).toBe(true);
    expect(again.claim.id).toBe(first.claim.id);   // same claim, not a new one
  });

  it("recognises the holder by cookie too, so a page reload is not a lockout", () => {
    // The client loses its copy of the id on reload but keeps the httpOnly
    // cookie, which is the only thing identifying it as the same operator.
    const first = claim({ ip: "127.0.0.1" });
    const afterReload = claim({ ip: "127.0.0.1", cookies: { setup_claim: first.claim.id } });
    expect(afterReload.ok).toBe(true);
    expect(afterReload.claim.id).toBe(first.claim.id);
  });

  it("still refuses a DIFFERENT operator", () => {
    const first = claim({ ip: "127.0.0.1" });
    const other = claim({ ip: "10.0.0.9", cookies: { setup_claim: "not-the-right-id" } });
    expect(other.ok).toBe(false);
    expect(other.claim.id).toBe(first.claim.id);
  });

  it("keeps a re-claimed installer from ageing out mid-install", () => {
    const first = claim({ ip: "127.0.0.1" });
    state.writeState({ claim: { ...state.readState().claim, at: Date.now() - 50 * 60 * 1000 } });
    claim({ ip: "127.0.0.1", cookies: { setup_claim: first.claim.id } });
    // Touching it on each step means a long install does not expire under them.
    expect(Date.now() - state.readState().claim.at).toBeLessThan(5000);
  });

  it("stops blocking once an abandoned claim ages out", () => {
    claim({ ip: "192.0.2.5" });
    const stale = state.readState().claim;
    state.writeState({ claim: { ...stale, at: Date.now() - 2 * 60 * 60 * 1000 } });
    expect(claim({ ip: "10.0.0.9" }).ok).toBe(true);
  });
});

describe("once installed, the wizard is closed", () => {
  it("answers 410 Gone rather than 404", async () => {
    // 410 so an operator re-running setup is told the install already
    // completed, instead of wondering whether they have the URL wrong.
    state.writeState({ installed: true });
    const r = await request(guarded()).post("/step")
      .set("Authorization", `Bearer ${ensureInstallToken()}`).send({});
    expect(r.status).toBe(410);
    expect(r.body.error).toBe("already_installed");
  });
});
