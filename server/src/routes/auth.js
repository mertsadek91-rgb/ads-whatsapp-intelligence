// BUG-002/SEC-2 fix: real per-user login (bcrypt + rate limit + lockout)
// replacing the single shared APP_PASSWORD plaintext compare.
import { Router } from "express";
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

router.post("/login", loginLimiter, async (req, res) => {
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
});

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
