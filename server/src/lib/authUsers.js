// Minimum-viable user auth (BUG-002/SEC-2 fix). Real bcrypt-hashed accounts +
// login attempt logging + lockout, replacing the single shared APP_PASSWORD.
// Full RBAC (roles/permissions matrix) is planning/16 — a later phase; this
// module intentionally stays small: accounts + login/lockout only.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { query } from "../db.js";

const BCRYPT_ROUNDS = 12;
export const LOCKOUT_WINDOW_MIN = 15;
export const LOCKOUT_THRESHOLD = 10;

const normEmail = (e) => String(e || "").trim().toLowerCase();

export async function findByEmail(email) {
  const rows = await query("select * from ads_users where email = ? limit 1", [normEmail(email)]);
  return rows[0] || null;
}

export async function createUser(email, plainPassword, role = "admin") {
  const hash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
  await query("insert into ads_users (email, password_hash, role) values (?, ?, ?)", [normEmail(email), hash, role]);
  return findByEmail(email);
}

export async function verifyPassword(user, plainPassword) {
  if (!user || !plainPassword) return false;
  return bcrypt.compare(plainPassword, user.password_hash);
}

export async function touchLastLogin(userId) {
  await query("update ads_users set last_login_at = now() where id = ?", [userId]);
}

export async function recordLogin({ email, success, ip, userAgent }) {
  await query(
    "insert into ads_login_logs (email, success, ip, user_agent) values (?, ?, ?, ?)",
    [normEmail(email), success ? 1 : 0, ip || null, (userAgent || "").slice(0, 255)]
  );
}

/** Failed attempts for this email within the lockout window (brute-force guard). */
export async function recentFailedAttempts(email) {
  const rows = await query(
    `select count(*) n from ads_login_logs
     where email = ? and success = 0 and created_at >= (now() - interval ${LOCKOUT_WINDOW_MIN} minute)`,
    [normEmail(email)]
  );
  return rows[0]?.n || 0;
}

/**
 * First-run bootstrap: if no user exists yet, create one admin with a random
 * password so the app is never left with zero possible logins after retiring
 * the shared password. Returns {email, password} ONCE (never re-derivable —
 * only the bcrypt hash is stored), or null if users already exist.
 */
export async function ensureBootstrapAdmin() {
  const [{ n }] = await query("select count(*) n from ads_users");
  if (n > 0) return null;
  const email = "admin@istmarkets.local";
  const password = crypto.randomBytes(9).toString("base64url"); // ~12 url-safe chars
  await createUser(email, password, "admin");
  return { email, password };
}

export default {
  findByEmail, createUser, verifyPassword, touchLastLogin, recordLogin,
  recentFailedAttempts, ensureBootstrapAdmin, LOCKOUT_WINDOW_MIN, LOCKOUT_THRESHOLD,
};
