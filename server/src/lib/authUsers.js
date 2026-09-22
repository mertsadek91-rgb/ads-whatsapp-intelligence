// Per-user auth: bcrypt-hashed accounts, login logging, lockout, and the small
// role vocabulary the route gate in middleware/auth.js enforces.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { query } from "../db.js";

const BCRYPT_ROUNDS = 12;
export const LOCKOUT_WINDOW_MIN = 15;
export const LOCKOUT_THRESHOLD = 10;

const normEmail = (e) => String(e || "").trim().toLowerCase();

/**
 * Login roles, most privileged first. Deliberately three, not a permission
 * matrix: the only distinctions the routes actually make today are "can change
 * how the system is configured", "can act on leads", and "can look".
 *   admin   — everything, including settings, users, and broadcasts (spends money)
 *   manager — day-to-day operations: lead assignment and handover
 *   viewer  — read-only dashboards and reports
 * Existing rows default to "admin" (the column default since the table was
 * created), so introducing roles does not lock anyone out.
 */
export const ROLES = ["admin", "manager", "viewer"];
export const isRole = (r) => ROLES.includes(r);
export const clampRole = (r) => (isRole(r) ? r : "viewer");

// Long enough to matter, short enough that nobody writes it on a sticky note.
export const MIN_PASSWORD_LEN = 10;

/** Throws a message suitable for returning to the caller. */
export function assertPasswordStrength(pw) {
  const s = String(pw || "");
  if (s.length < MIN_PASSWORD_LEN) {
    throw new Error(`كلمة المرور يجب أن تكون ${MIN_PASSWORD_LEN} أحرف على الأقل`);
  }
}

export async function findByEmail(email) {
  const rows = await query("select * from ads_users where email = ? limit 1", [normEmail(email)]);
  return rows[0] || null;
}

export async function createUser(email, plainPassword, role = "admin") {
  const hash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
  await query("insert into ads_users (email, password_hash, role) values (?, ?, ?)", [normEmail(email), hash, role]);
  return findByEmail(email);
}

/** Never returns password_hash — this feeds an API response. */
export async function listUsers() {
  return query(
    "select id, email, role, status, created_at, last_login_at from ads_users order by role, email");
}

export async function findById(id) {
  const rows = await query("select * from ads_users where id = ? limit 1", [Number(id)]);
  return rows[0] || null;
}

export async function setPassword(userId, plainPassword) {
  assertPasswordStrength(plainPassword);
  const hash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
  await query("update ads_users set password_hash = ? where id = ?", [hash, Number(userId)]);
  return { ok: true };
}

export async function updateUser(userId, { role, status } = {}) {
  const sets = [], params = [];
  if (role != null) { sets.push("role = ?"); params.push(clampRole(role)); }
  if (status != null) { sets.push("status = ?"); params.push(status === "disabled" ? "disabled" : "active"); }
  if (!sets.length) return { ok: false, reason: "nothing-to-update" };
  params.push(Number(userId));
  await query(`update ads_users set ${sets.join(", ")} where id = ?`, params);
  return { ok: true };
}

export async function deleteUser(userId) {
  await query("delete from ads_users where id = ?", [Number(userId)]);
  return { ok: true };
}

/**
 * Count of accounts that can still administer the system. Every destructive
 * change to an admin account is checked against this first: demoting,
 * disabling or deleting the last one would leave an install nobody can
 * configure, recoverable only by direct SQL.
 */
export async function activeAdminCount() {
  // Bound, not inlined. Written as bare words — `role = admin` — MySQL read
  // them as column names and every call threw "Unknown column 'admin'", so the
  // guard below never guarded anything: the check meant to stop an operator
  // deleting the last administrator failed with an error instead of a refusal.
  // Nothing caught it because every unit test mocks the driver; the install
  // test against a real MySQL did, the first time it ran.
  const [{ n }] = await query(
    "select count(*) n from ads_users where role = ? and status = ?",
    ["admin", "active"]);
  return Number(n || 0);
}

/** True when changing/removing this user would strand the install. */
export async function isLastActiveAdmin(userId) {
  const u = await findById(userId);
  if (!u || u.role !== "admin" || u.status !== "active") return false;
  return (await activeAdminCount()) <= 1;
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
  const email = normEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@localhost");
  const password = crypto.randomBytes(9).toString("base64url"); // ~12 url-safe chars
  await createUser(email, password, "admin");
  return { email, password };
}

export default {
  findByEmail, findById, createUser, verifyPassword, touchLastLogin, recordLogin,
  recentFailedAttempts, ensureBootstrapAdmin, LOCKOUT_WINDOW_MIN, LOCKOUT_THRESHOLD,
  listUsers, setPassword, updateUser, deleteUser, activeAdminCount, isLastActiveAdmin,
  ROLES, isRole, clampRole, MIN_PASSWORD_LEN, assertPasswordStrength,
};
