// The installation wizard's API.
//
// Every step is test-then-save: a credential that has not just passed its
// validator in the same request cannot be persisted, from here or from the
// Settings page. That is what stops an install ending up with a stored token
// nobody ever proved works.
import { Router } from "express";
import config from "../config.js";
import * as state from "../lib/setupState.js";
import * as appConfig from "../lib/appConfig.js";
import * as users from "../lib/authUsers.js";
import { setKeyProvider } from "../lib/secretBox.js";
import {
  requireSetupAccess, requireNotInstalled, requireClaim, claim, ensureInstallToken, activeClaim,
} from "../middleware/setupAccess.js";

import * as dbValidator from "../setup/validators/db.js";
import * as metaValidator from "../setup/validators/meta.js";
import * as watiValidator from "../setup/validators/wati.js";
import * as aiValidator from "../setup/validators/ai.js";
import * as businessValidator from "../setup/validators/business.js";
import { generateBusinessProfile } from "../lib/profileGen.js";
import * as businessProfile from "../lib/businessProfile.js";
import { budgetRemaining } from "../lib/deepseek.js";
import { redirectUri } from "../setup/validators/meta.js";

const router = Router();

export const STEPS = ["db", "meta", "wati", "ai", "business", "finish"];

// Set by server.js so the wizard can bring the app up without a restart.
let activateRuntime = async () => {};
export function setActivator(fn) { activateRuntime = fn; }

const mask = (v) => (v ? "••••" + String(v).slice(-4) : "");

// ---- Status: the only route that stays open once installed -----------------
router.get("/status", (req, res) => {
  if (state.isInstalled()) return res.json({ installed: true });
  const s = state.readState();
  const held = activeClaim(s);
  res.json({
    installed: false,
    steps: STEPS,
    completedSteps: s.completedSteps || [],
    currentStep: STEPS.find((x) => !(s.completedSteps || []).includes(x)) || "finish",
    // An operator who set MYSQL_URL in the environment owns it; the wizard
    // shows that step read-only rather than fighting their deployment.
    lockedByEnv: { mysql: !!process.env.MYSQL_URL, sessionSecret: !!process.env.SESSION_SECRET },
    claimed: held ? { from: held.ip, agoMs: Date.now() - held.at } : null,
    // Saved values, secrets masked — this is what makes the wizard resumable
    // after a closed browser without ever putting a credential in the page.
    saved: {
      mysql: s.mysql ? { ...s.mysql, password: mask(s.mysql.password) } : null,
      meta: { appId: config.meta.appId, accountId: config.meta.accountId, apiVersion: config.meta.apiVersion,
        appSecret: mask(config.meta.appSecret), token: mask(config.meta.token) },
      wati: { endpoint: config.wati.endpoint, token: mask(config.wati.token) },
      ai: { baseUrl: config.deepseek.baseUrl, model: config.deepseek.model, apiKey: mask(config.deepseek.apiKey) },
    },
    redirectUri: redirectUri(config.appBaseUrl),
  });
});

// Everything below requires the install token (or loopback) AND an unfinished install.
router.use(requireNotInstalled, requireSetupAccess);

router.post("/claim", (req, res) => {
  const r = claim(req, { takeover: String(req.query.takeover || "") === "1" });
  if (!r.ok) {
    return res.status(409).json({
      error: "setup_in_progress", claimedFrom: r.claim.ip, claimedAgoMs: Date.now() - r.claim.at });
  }
  res.cookie("setup_claim", r.claim.id, { httpOnly: true, sameSite: "lax" });
  // Hand the caller the install token as an httpOnly cookie.
  //
  // Without this, claiming locked out the very operator who just claimed:
  // requireSetupAccess admits a local request only while nothing is claimed, so
  // the first successful claim made every following step answer 401 for a
  // browser on the same machine. Issuing the token at the moment of claiming
  // keeps the token the single authority, and means the operator never has to
  // copy it out of the server log when installing locally.
  res.cookie("setup_claim_token", ensureInstallToken(), { httpOnly: true, sameSite: "lax" });
  res.json({ ok: true, claimId: r.claim.id });
});

router.use(requireClaim);

const markComplete = (step) => {
  const done = new Set(state.readState().completedSteps || []);
  done.add(step);
  state.writeState({ completedSteps: [...done] });
};

// A step may only be saved if its validator just passed, in this request.
function testThenSave(step, validate, persist) {
  return async (req, res) => {
    let result;
    try { result = await validate(req.body || {}); }
    catch (e) { return res.status(500).json({ ok: false, code: "UNKNOWN", detail: e.message }); }
    if (!result.ok) return res.status(400).json(result);
    if (persist) await persist(req.body || {}, result);
    markComplete(step);
    res.json(result);
  };
}

const justTest = (validate) => async (req, res) => {
  try { res.json(await validate(req.body || {})); }
  catch (e) { res.status(500).json({ ok: false, code: "UNKNOWN", detail: e.message }); }
};

// ---- 1. Database -----------------------------------------------------------
router.post("/db/test", justTest(dbValidator.validate));

router.post("/db/create-database", async (req, res) => {
  res.json(await dbValidator.createDatabase(req.body || {}));
});

router.post("/db/save", testThenSave("db", dbValidator.validate, async (body) => {
  const mysql = {
    host: body.host, port: Number(body.port || 3306),
    user: body.user, password: body.password ?? "", database: body.database,
  };
  state.writeState({ mysql });
  config.mysql = mysql;
  // Point the live pool at the database we just proved works.
  const { resetPool } = await import("../db.js");
  await resetPool();
}));

// Create every table. Safe to re-run: schema.sql is entirely `if not exists`.
router.post("/db/migrate", async (req, res) => {
  try {
    const { ensureSchema } = await import("../jobs/backfill.js");
    const started = Date.now();
    await ensureSchema();
    const { query } = await import("../db.js");
    const rows = await query(
      "select table_name from information_schema.tables where table_schema = database() order by table_name");
    res.json({ ok: true, ms: Date.now() - started, tables: rows.map((r) => r.table_name || r.TABLE_NAME) });
  } catch (e) {
    res.status(400).json({ ok: false, code: "DB_NO_CREATE_PRIVILEGE", detail: e.message });
  }
});

// ---- 2. Meta ---------------------------------------------------------------
router.post("/meta/test", justTest(metaValidator.validate));

router.post("/meta/save", testThenSave("meta", metaValidator.validate, async (body) => {
  await appConfig.saveConfig({
    "meta.appId": body.appId || "",
    "meta.appSecret": body.appSecret || "",
    "meta.token": body.token || "",
    "meta.accountId": body.accountId || "",
    "meta.apiVersion": body.apiVersion || "v21.0",
    ...(body.periodSince ? { "meta.periodSince": body.periodSince } : {}),
    ...(body.lookbackDays ? { "meta.lookbackDays": body.lookbackDays } : {}),
  }, { updatedBy: "setup" });
}));

// ---- 3. Wati ---------------------------------------------------------------
router.post("/wati/test", justTest(watiValidator.validate));

router.post("/wati/save", testThenSave("wati", watiValidator.validate, async (body, result) => {
  await appConfig.saveConfig({
    // Store the endpoint we RESOLVED, not the one they typed, so the tenant
    // correction survives rather than being re-derived on every request.
    "wati.endpoint": result.details.resolvedEndpoint,
    "wati.token": String(body.token || "").replace(/^Bearer\s+/i, ""),
  }, { updatedBy: "setup" });
}));

// ---- 4. AI -----------------------------------------------------------------
router.post("/ai/test", justTest(aiValidator.validate));

router.post("/ai/save", testThenSave("ai", aiValidator.validate, async (body, result) => {
  await appConfig.saveConfig({
    "deepseek.apiKey": body.apiKey || "",
    "deepseek.baseUrl": body.baseUrl || "https://api.deepseek.com",
    "deepseek.model": result.details.model,
    ...(body.dailyBudgetUsd ? { "deepseek.dailyBudgetUsd": body.dailyBudgetUsd } : {}),
  }, { updatedBy: "setup" });
}));

// ---- 5. Business definition -------------------------------------------------
router.post("/business/test", justTest(businessValidator.validate));

router.post("/business/save", testThenSave("business", businessValidator.validate, async (body) => {
  const { query } = await import("../db.js");
  await query(
    `insert into ads_settings (k, v) values (?, ?)
     as new on duplicate key update v = new.v, updated_at = now()`,
    ["business_input", JSON.stringify({
      websiteUrl: body.websiteUrl || "", description: body.description || "",
      language: body.language === "en" ? "en" : "ar",
    })]);
}));

/**
 * Read the company's website and turn it into a draft business profile: the
 * compliance vocabulary, sales rules, lead lifecycle and tag taxonomy for THIS
 * industry rather than a generic one.
 *
 * Nothing goes live here. The draft is stored for a human to review, because an
 * AI-written regulatory fact that nobody checked is worse than no fact at all.
 */
router.post("/business/generate", async (req, res) => {
  try {
    // Never let setup eat the day's analysis budget on its way in.
    const remaining = await budgetRemaining().catch(() => null);
    if (remaining != null && remaining < 0.5) {
      return res.status(400).json({
        ok: false,
        detail: "ميزانية الذكاء الاصطناعي اليومية شبه مستنفدة — ارفع السقف أو أعِد المحاولة غداً " +
                "(the daily AI budget is nearly exhausted)",
      });
    }

    const out = await generateBusinessProfile({
      websiteUrl: req.body?.websiteUrl,
      description: req.body?.description,
      language: req.body?.language === "en" ? "en" : "ar",
    });
    await businessProfile.saveDraft(out.profile,
      { source: "ai", generatedFrom: out.evidence, createdBy: "setup" });

    res.json({
      ok: true,
      profile: out.profile,
      evidence: out.evidence,
      warnings: out.warnings,
      // Surfaced, never applied silently: a systematically bad generation must
      // not look like a clean one to the person approving it.
      repairs: out.repairs,
      errors: out.errors,
      summary: {
        issueTypes: out.profile.issue_types.length,
        tags: (out.profile.tags?.categories || []).reduce((n, c) => n + (c.tags?.length || 0), 0),
        stages: out.profile.lifecycle.stages.length,
        facts: out.profile.identity.facts.length,
        unverifiedFacts: out.profile.identity.facts.filter((f) => f.source === "unverified").length,
        calibrationCases: out.profile.calibration_cases.length,
      },
    });
  } catch (e) {
    res.status(400).json({ ok: false, detail: e.message });
  }
});

/** Save the reviewed draft, then make it the live vocabulary. */
router.post("/business/approve", async (req, res) => {
  try {
    if (req.body?.profile) {
      await businessProfile.saveDraft(req.body.profile, { source: "human", createdBy: "setup" });
    }
    const r = await businessProfile.activateDraft({ activatedBy: "setup" });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(400).json({ ok: false, detail: e.message });
  }
});

// ---- 6. Finish --------------------------------------------------------------
router.post("/finish", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const password = req.body?.password || "";
  if (!email) return res.status(400).json({ ok: false, detail: "البريد الإلكتروني مطلوب" });
  try { users.assertPasswordStrength(password); }
  catch (e) { return res.status(400).json({ ok: false, detail: e.message }); }

  const s = state.readState();
  const missing = ["db", "meta", "wati", "ai", "business"].filter((x) => !(s.completedSteps || []).includes(x));
  if (missing.length) {
    return res.status(400).json({ ok: false, detail: `خطوات غير مكتملة: ${missing.join(", ")}` });
  }

  try {
    if (await users.findByEmail(email)) {
      return res.status(409).json({ ok: false, detail: "هذا البريد مسجّل بالفعل" });
    }
    await users.createUser(email, password, "admin");
    state.writeState({ installed: true, installedAt: new Date().toISOString(), claim: null });
    // Swap the 503 router for the real API in this process — no restart.
    await activateRuntime();
    res.json({ ok: true, email });
  } catch (e) {
    res.status(500).json({ ok: false, detail: e.message });
  }
});

export { ensureInstallToken, setKeyProvider };
export default router;
