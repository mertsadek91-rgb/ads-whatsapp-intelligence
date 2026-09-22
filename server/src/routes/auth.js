// BUG-002/SEC-2 fix: real per-user login (bcrypt + rate limit + lockout)
// replacing the single shared APP_PASSWORD plaintext compare.
import { Router } from "express";
import { wrap } from "../lib/wrap.js";
import rateLimit from "express-rate-limit";
import * as users from "../lib/authUsers.js";

const router = Router();

// SEC-5: throttle brute-force attempts at the network layer too (on top of
// the per-email lockout below, which survives across IPs/proxies).
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "محاولات كثيرة جداً — حاول مرة أخرى بعد دقيقة." },
});

router.post("/login", loginLimiter, wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim();
  const password = req.body?.password || "";
  const ip = req.ip;
  const userAgent = req.get("user-agent") || "";

  if (!email || !password) {
    return res.status(400).json({ error: "البريد الإلكتروني وكلمة المرور مطلوبان" });
  }

  const failedRecently = await users.recentFailedAttempts(email);
  if (failedRecently >= users.LOCKOUT_THRESHOLD) {
    await users.recordLogin({ email, success: false, ip, userAgent });
    return res.status(429).json({
      error: `محاولات فاشلة كثيرة — الحساب موقوف مؤقتاً لمدة ${users.LOCKOUT_WINDOW_MIN} دقيقة`,
    });
  }

  const user = await users.findByEmail(email);
  const passwordOk = user && user.status === "active" && (await users.verifyPassword(user, password));
  await users.recordLogin({ email, success: !!passwordOk, ip, userAgent });

  if (!passwordOk) {
    return res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
  }

  req.session.userId = user.id;
  req.session.email = user.email;
  req.session.role = user.role;
  users.touchLastLogin(user.id).catch(() => {});
  res.json({ ok: true, email: user.email, role: user.role });
}));

/**
 * Change your own password. Until now there was none: createUser was reachable
 * only from ensureBootstrapAdmin, so the random password printed once to the
 * server log was the permanent password for the install — despite the startup
 * banner and the README both telling the operator to change it.
 *
 * Rate-limited with the login limiter: this endpoint verifies the current
 * password, so without it an authenticated session is an offline-free oracle
 * for guessing it.
 */
router.post("/change-password", loginLimiter, wrap(async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: "unauthorized" });
  const current = req.body?.current_password || "";
  const next = req.body?.new_password || "";

  const user = await users.findById(req.session.userId);
  if (!user || !(await users.verifyPassword(user, current))) {
    await users.recordLogin({ email: user?.email || req.session.email, success: false,
      ip: req.ip, userAgent: req.get("user-agent") || "" });
    return res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
  }
  if (current === next) {
    return res.status(400).json({ error: "كلمة المرور الجديدة مطابقة للحالية" });
  }
  try { users.assertPasswordStrength(next); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  await users.setPassword(user.id, next);
  res.json({ ok: true });
}));

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", (req, res) => {
  if (req.session?.userId) {
    return res.json({ authed: true, email: req.session.email, role: req.session.role });
  }
  res.json({ authed: false });
});

export default router;
