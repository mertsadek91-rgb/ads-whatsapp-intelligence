// The installation wizard's API.
//
// Every step is test-then-save: a credential that has not just passed its
// validator in the same request cannot be persisted, from here or from the
// Settings page. That is what stops an install ending up with a stored token
// nobody ever proved works.
import { Router } from "express";
import crypto from "node:crypto";
import config from "../config.js";
import * as state from "../lib/setupState.js";
import * as metaAuth from "../lib/metaAuth.js";
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
import { generateBusinessProfile, fetchBusinessFromSite } from "../lib/profileGen.js";
import * as businessProfile from "../lib/businessProfile.js";
import { budgetRemaining } from "../lib/deepseek.js";
import { redirectUri } from "../setup/validators/meta.js";
import { normalizeSince, describeRange } from "../lib/dataRange.js";

const router = Router();

export const STEPS = ["db", "meta", "wati", "ai", "business", "finish"];

// Only two things genuinely cannot be deferred: somewhere to put the data,
// and someone who can log in. Everything else can be connected later from the
// Settings page, and forcing it up front just means credentials pasted in a
// hurry to get past a screen.
export const REQUIRED_STEPS = ["db", "finish"];
export const SKIPPABLE = STEPS.filter((s) => !REQUIRED_STEPS.includes(s));

// Set by server.js so the wizard can bring the app up without a restart.
let activateRuntime = async () => {};
export function setActivator(fn) { activateRuntime = fn; }

const mask = (v) => (v ? "••••" + String(v).slice(-4) : "");

// ---- Status: the only route that stays open once installed -----------------
router.get("/status", async (req, res) => {
  if (state.isInstalled()) return res.json({ installed: true });
  const s = state.readState();
  // Whether signing in with Facebook already produced a token. Never the token
  // itself — a boolean is all the wizard needs to say "connected" instead of
  // asking for one. Tolerates having no database yet: this route answers from
  // the very first request, before the database step.
  const metaConnected = !!(await metaAuth.getToken().catch(() => null));
  const held = activeClaim(s);
  res.json({
    installed: false,
    steps: STEPS,
    completedSteps: s.completedSteps || [],
    skippedSteps: s.skippedSteps || [],
    requiredSteps: REQUIRED_STEPS,
    skippable: SKIPPABLE,
    currentStep: STEPS.find((x) =>
      !(s.completedSteps || []).includes(x) && !(s.skippedSteps || []).includes(x)) || "finish",
    // An operator who set MYSQL_URL in the environment owns it; the wizard
    // shows that step read-only rather than fighting their deployment.
    lockedByEnv: { mysql: !!process.env.MYSQL_URL, sessionSecret: !!process.env.SESSION_SECRET },
    claimed: held ? { from: held.ip, agoMs: Date.now() - held.at } : null,
    // Saved values, secrets masked — this is what makes the wizard resumable
    // after a closed browser without ever putting a credential in the page.
    saved: {
      mysql: s.mysql ? { ...s.mysql, password: mask(s.mysql.password) } : null,
      meta: { appId: config.meta.appId, accountId: config.meta.accountId, apiVersion: config.meta.apiVersion,
        appSecret: mask(config.meta.appSecret), token: mask(config.meta.token), connected: metaConnected },
      wati: { endpoint: config.wati.endpoint, token: mask(config.wati.token) },
      ai: { baseUrl: config.deepseek.baseUrl, model: config.deepseek.model, apiKey: mask(config.deepseek.apiKey) },
      data: describeRange(config),
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
  // Hand the caller the install token as an httpOnly cookie, so a browser that
  // claimed locally keeps working even if the request later looks remote —
  // someone putting the installer behind a tunnel or a proxy mid-install.
  res.cookie("setup_claim_token", ensureInstallToken(), { httpOnly: true, sameSite: "lax" });
  res.json({ ok: true, claimId: r.claim.id });
});

router.use(requireClaim);

const markComplete = (step) => {
  const s = state.readState();
  const done = new Set(s.completedSteps || []);
  done.add(step);
  // Completing a step it was previously skipped clears the skip, so the
  // post-install checklist does not keep nagging about something now done.
  const skipped = (s.skippedSteps || []).filter((x) => x !== step);
  state.writeState({ completedSteps: [...done], skippedSteps: skipped });
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
  const { normalizeSsl } = await import("../lib/mysqlSsl.js");
  const mysql = {
    host: body.host, port: Number(body.port || 3306),
    user: body.user, password: body.password ?? "", database: body.database,
    ssl: normalizeSsl(body.ssl),
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
/**
 * Sign in with Facebook instead of pasting a token.
 *
 * The Settings page has offered this since the beginning; the wizard asked for
 * a manually-created token, which is the single hardest field in the whole
 * installation to produce — it means finding Graph API Explorer, choosing the
 * right app, ticking two scopes and copying a 200-character string. The same
 * one-click flow belongs here, where a new operator actually is.
 *
 * Why this is not simply the /api/meta/connect route: that one lives behind the
 * runtime router and requires an admin session, and during setup there is no
 * session and no admin. It also stores its CSRF state on the session. Here the
 * state goes in setup.json, which is where everything else pre-database lives.
 */
router.post("/meta/oauth/start", async (req, res) => {
  const appId = String(req.body?.appId || "").trim();
  const appSecret = String(req.body?.appSecret || "").trim();
  if (!appId || !appSecret) {
    return res.status(400).json({
      ok: false, code: "META_APP_MISSING",
      detail: "أدخل App ID و App Secret أولاً — بهما يتم تسجيل الدخول",
    });
  }
  // buildAuthUrl reads these from config, so they have to be live before it is
  // called. They are not credentials to a service yet — they identify the app.
  await appConfig.saveConfig({ "meta.appId": appId, "meta.appSecret": appSecret },
    { updatedBy: "setup" });

  const oauthState = crypto.randomBytes(16).toString("hex");
  state.writeState({ metaOauthState: oauthState });
  res.json({ ok: true, url: metaAuth.buildAuthUrl(oauthState), redirectUri: redirectUri(config.appBaseUrl) });
});

/**
 * Where Facebook sends the operator back.
 *
 * Mounted by app.js at /api/meta/callback — the SAME path the installed app
 * uses — so there is only ever one redirect URI to register in the Meta app.
 * It hands over to the installed route once installation is finished.
 *
 * Authorisation is the one-shot state: it was generated by whoever started the
 * flow, stored server-side, and is cleared on use. That is the same guarantee
 * the session-based route gets, without a session.
 */
export async function metaOauthCallback(req, res, next) {
  if (state.isInstalled()) return next();   // the real route owns it from here

  const { code, state: returned, error, error_description } = req.query;
  const expected = state.readState().metaOauthState;
  state.writeState({ metaOauthState: null });   // single use, whatever happens

  const back = (params) => res.redirect(`/setup?${new URLSearchParams(params)}`);
  if (error) return back({ meta: "error", msg: error_description || error });
  if (!code || !returned || !expected || returned !== expected) {
    return back({ meta: "error", msg: "انتهت صلاحية الطلب أو لا يطابق — أعِد المحاولة" });
  }
  try {
    await metaAuth.handleCallback(code);
    back({ meta: "connected" });
  } catch (e) {
    back({ meta: "error", msg: e.message });
  }
}

/**
 * Use the token Facebook gave us when the operator did not type one.
 *
 * The validators are pure and never read config — that is what lets the
 * Settings page reuse them — so the substitution happens here, at the edge,
 * and the token itself never goes to the browser.
 */
async function withStoredToken(body) {
  if (String(body?.token || "").trim()) return body;
  const stored = await metaAuth.getToken().catch(() => null);
  return stored ? { ...body, token: stored } : body;
}

const metaTest = async (req, res) => {
  try { res.json(await metaValidator.validate(await withStoredToken(req.body || {}))); }
  catch (e) { res.status(500).json({ ok: false, code: "UNKNOWN", detail: e.message }); }
};

router.post("/meta/test", metaTest);

router.post("/meta/save", async (req, res, next) => {
  req.body = await withStoredToken(req.body || {});
  next();
}, testThenSave("meta", metaValidator.validate, async (body) => {
  await appConfig.saveConfig({
    "meta.appId": body.appId || "",
    "meta.appSecret": body.appSecret || "",
    "meta.token": body.token || "",
    "meta.accountId": body.accountId || "",
    "meta.apiVersion": body.apiVersion || "v21.0",
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
/**
 * Read the company website and write the description for them.
 *
 * "Describe your business in 3-5 lines" is the field people stall on, and a
 * thin description is the biggest single cause of a thin profile — the model
 * has nothing to generalise from and starts inventing. The site already says
 * what the business does.
 *
 * Returned as an editable draft, never applied silently: the operator knows
 * things the website does not say.
 */
router.post("/business/fetch", async (req, res) => {
  try {
    const out = await fetchBusinessFromSite(req.body?.websiteUrl, {
      language: req.body?.language === "en" ? "en" : "ar",
    });
    if (!out.ok) {
      return res.status(400).json({
        ok: false,
        code: out.warnings.includes("SITE_BOT_BLOCKED") ? "SITE_BOT_BLOCKED" : "SITE_UNREACHABLE",
        warnings: out.warnings,
      });
    }
    res.json(out);
  } catch (e) {
    const code = /SITE_PRIVATE_ADDRESS/.test(e.message) ? "SITE_PRIVATE_ADDRESS" : "SITE_UNREACHABLE";
    res.status(400).json({ ok: false, code, detail: e.message });
  }
});

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

/**
 * Defer a step. Recorded separately from "completed" on purpose: the two mean
 * different things afterwards, and the checklist shown after install needs to
 * tell them apart.
 */
router.post("/:step/skip", (req, res) => {
  const step = req.params.step;
  if (!SKIPPABLE.includes(step)) {
    return res.status(400).json({
      ok: false,
      detail: `لا يمكن تخطّي هذه الخطوة (${step} cannot be skipped)`,
    });
  }
  const s = state.readState();
  const skipped = new Set(s.skippedSteps || []);
  skipped.add(step);
  state.writeState({ skippedSteps: [...skipped] });
  res.json({ ok: true, skippedSteps: [...skipped] });
});

// ---- 6. Finish --------------------------------------------------------------
router.post("/finish", async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const password = req.body?.password || "";
  if (!email) return res.status(400).json({ ok: false, detail: "البريد الإلكتروني مطلوب" });
  try { users.assertPasswordStrength(password); }
  catch (e) { return res.status(400).json({ ok: false, detail: e.message }); }

  const s = state.readState();
  // Only the genuinely required steps block finishing. The rest may be either
  // done or explicitly deferred — but not silently absent, so nobody finishes
  // setup without having seen and decided about every step.
  const done = new Set(s.completedSteps || []);
  const skipped = new Set(s.skippedSteps || []);
  const missingRequired = REQUIRED_STEPS.filter((x) => x !== "finish" && !done.has(x));
  if (missingRequired.length) {
    return res.status(400).json({
      ok: false,
      detail: `خطوات إجبارية غير مكتملة: ${missingRequired.join(", ")}`,
    });
  }
  const undecided = SKIPPABLE.filter((x) => !done.has(x) && !skipped.has(x));
  if (undecided.length) {
    return res.status(400).json({
      ok: false,
      detail: `خطوات لم تُكمَل ولم تُتخطَّ بعد: ${undecided.join(", ")}`,
      undecided,
    });
  }

  try {
    if (await users.findByEmail(email)) {
      return res.status(409).json({ ok: false, detail: "هذا البريد مسجّل بالفعل" });
    }
    // How much history to import. Saved before the account so that the import
    // started below — and every later one — reads the operator's own choice
    // rather than the default window.
    await appConfig.saveConfig({
      "data.since": normalizeSince(req.body?.data?.since),
      "data.watiMessages": !!req.body?.data?.watiMessages,
    }, { updatedBy: "setup" });

    await users.createUser(email, password, "admin");
    state.writeState({ installed: true, installedAt: new Date().toISOString(), claim: null });
    // Swap the 503 router for the real API in this process — no restart.
    await activateRuntime();

    // Then fill the app with data. Without this an operator lands on empty
    // boards and has no way of knowing whether that means "still importing" or
    // "misconfigured"; the import shows up in the normal job status panel.
    let importStarted = false;
    if (req.body?.startImport !== false && (config.meta.accountId || config.wati.token)) {
      const { backfill } = await import("../jobs/backfill.js");
      const { runJob } = await import("./admin.js");
      importStarted = await runJob("wati", () => backfill());
    }
    res.json({ ok: true, email, importStarted, range: describeRange(config) });
  } catch (e) {
    res.status(500).json({ ok: false, detail: e.message });
  }
});

export { ensureInstallToken, setKeyProvider };
export default router;
