// Who may drive the installation wizard.
//
// There is no database and therefore no session at this point, so the wizard
// authenticates with an install token printed to stdout on first boot — the
// same convention the first-admin banner already used. Loopback is allowed
// without it so local development stays frictionless; a stranger who finds
// /api/setup on a public VPS gets nothing.
import crypto from "node:crypto";
import * as state from "../lib/setupState.js";

const CLAIM_TTL_MS = 60 * 60 * 1000; // an abandoned wizard should not block the box forever

export function ensureInstallToken() {
  const s = state.readState();
  if (s.installToken) return s.installToken;
  const token = crypto.randomBytes(32).toString("hex");
  state.writeState({ installToken: token });
  return token;
}

const isLoopbackIp = (ip) => {
  const a = String(ip || "").replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a === "localhost";
};

/**
 * "The request came from this machine" — and it has to mean that.
 *
 * req.ip alone does NOT: with a reverse proxy on the same host and the default
 * TRUST_PROXY_HOPS=0, req.ip is 127.0.0.1 for every request, including ones
 * from the public internet. Trusting that would hand the installation wizard to
 * anyone who found the URL. So a request carrying any forwarding header is
 * treated as remote no matter what req.ip says, and must present the token.
 */
function isLocalRequest(req) {
  if (!isLoopbackIp(req.ip)) return false;
  for (const h of ["x-forwarded-for", "x-real-ip", "forwarded", "x-forwarded-host"]) {
    if (req.get(h)) return false;
  }
  return true;
}

/** Constant-time compare, so the token cannot be recovered by timing. */
function tokenMatches(given, expected) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(expected || ""));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function presentedToken(req) {
  const header = req.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  return bearer || req.cookies?.setup_claim_token || req.body?.installToken || null;
}

/** Every /api/setup route except /status is dead once the app is installed. */
export function requireNotInstalled(req, res, next) {
  if (state.isInstalled()) {
    // 410, not 404: an operator re-running the wizard deserves to be told the
    // install already completed, rather than wondering if the URL is wrong.
    return res.status(410).json({
      error: "already_installed",
      message: "التنصيب مكتمل بالفعل — استخدم صفحة الإعدادات لتغيير أي بيانات (already installed)",
    });
  }
  next();
}

export function requireSetupAccess(req, res, next) {
  const s = state.readState();
  const token = ensureInstallToken();

  const authorised = tokenMatches(presentedToken(req), token)
    || (isLocalRequest(req) && !activeClaim(s));

  if (!authorised) {
    return res.status(401).json({
      error: "setup_token_required",
      message: "مطلوب رمز التنصيب — اطبعه من سجلّ الخادم (install token required; it is printed in the server log)",
    });
  }
  next();
}

export function activeClaim(s = state.readState()) {
  const c = s.claim;
  if (!c) return null;
  if (Date.now() - (c.at || 0) > CLAIM_TTL_MS) return null;
  return c;
}

/**
 * One operator at a time. Two people running the wizard against the same box
 * would interleave saves and produce a half-configured install, so the first
 * caller claims it and the second is told who holds it and for how long.
 */
export function claim(req, { takeover = false } = {}) {
  const s = state.readState();
  const existing = activeClaim(s);
  if (existing && !takeover) {
    return { ok: false, claim: existing };
  }
  const next = { id: crypto.randomBytes(16).toString("hex"), ip: req.ip, at: Date.now() };
  state.writeState({ claim: next });
  return { ok: true, claim: next };
}

/** Every mutating step must carry the claim it was issued. */
export function requireClaim(req, res, next) {
  const held = activeClaim();
  if (!held) return next();                       // nothing claimed yet — first writer wins
  const given = req.get("x-setup-claim") || req.cookies?.setup_claim || req.body?.claimId;
  if (given === held.id) return next();
  return res.status(409).json({
    error: "setup_in_progress",
    message: "شخص آخر يشغّل معالج التنصيب الآن (someone else is running the setup wizard)",
    claimedFrom: held.ip,
    claimedAgoMs: Date.now() - held.at,
  });
}

export { isLocalRequest };
export default { requireSetupAccess, isLocalRequest, requireNotInstalled, requireClaim, claim, ensureInstallToken, activeClaim };
