import { Router } from "express";
import crypto from "node:crypto";
import config from "../config.js";
import * as auth from "../lib/metaAuth.js";

const router = Router();
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(500).json({ error: e.message }));

// connection status (for the Settings page)
router.get("/status", wrap(async (req, res) => res.json(await auth.status())));

// start one-click OAuth
router.get("/connect", (req, res) => {
  if (!auth.appConfigured()) {
    return res.status(400).send("أضِف META_APP_ID و META_APP_SECRET في .env أولاً.");
  }
  const state = crypto.randomBytes(12).toString("hex");
  req.session.metaState = state;
  res.redirect(auth.buildAuthUrl(state));
});

// OAuth callback (Facebook redirects the user's browser here)
router.get("/callback", wrap(async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.redirect(`/settings?meta=error&msg=${encodeURIComponent(error_description || error)}`);
  if (!code || state !== req.session.metaState) {
    return res.redirect("/settings?meta=error&msg=" + encodeURIComponent("حالة غير صالحة"));
  }
  try {
    await auth.handleCallback(code);
    res.redirect("/settings?meta=connected");
  } catch (e) {
    res.redirect("/settings?meta=error&msg=" + encodeURIComponent(e.message));
  }
}));

// manual token paste (fallback) — also upgrades to long-lived if app creds present
router.post("/token", wrap(async (req, res) => {
  const t = (req.body && req.body.token || "").trim();
  if (!t) return res.status(400).json({ error: "أدخل التوكن" });
  const r = await auth.adoptToken(t);
  res.json({ ...r, status: await auth.status() });
}));

router.post("/refresh", wrap(async (req, res) => {
  const r = await auth.ensureFresh();
  res.json({ ...r, status: await auth.status() });
}));

router.post("/disconnect", wrap(async (req, res) => {
  await auth.disconnect();
  res.json({ ok: true, status: await auth.status() });
}));

export default router;
