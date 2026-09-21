// Minimum-viable auth (BUG-002 fix): bcrypt hashing, email normalization,
// and the bootstrap-admin-only-once guard. db.js's query() is mocked so this
// is a true unit test — no network/DB dependency.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { users: [], logins: [] };
let nextId = 1;

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    if (sql.startsWith("select count(*) n from ads_users")) return [{ n: state.users.length }];
    if (sql.startsWith("insert into ads_users")) {
      state.users.push({ id: nextId++, email: params[0], password_hash: params[1], role: params[2], status: "active" });
      return {};
    }
    if (sql.startsWith("select * from ads_users where email")) {
      return state.users.filter((u) => u.email === params[0]);
    }
    if (sql.startsWith("insert into ads_login_logs")) {
      state.logins.push({ email: params[0], success: !!params[1], ts: Date.now() });
      return {};
    }
    if (sql.startsWith("select count(*) n from ads_login_logs")) {
      const n = state.logins.filter((l) => l.email === params[0] && !l.success).length;
      return [{ n }];
    }
    if (sql.startsWith("update ads_users set last_login_at")) return {};
    throw new Error("unexpected query in mock: " + sql);
  }),
}));

const users = await import("../src/lib/authUsers.js");

beforeEach(() => { state.users.length = 0; state.logins.length = 0; nextId = 1; });

describe("authUsers: password hashing", () => {
  it("hashes on create, never storing the plaintext password", async () => {
    const u = await users.createUser("Admin@Example.com", "correct-password-123");
    expect(u.password_hash).not.toBe("correct-password-123");
    expect(u.password_hash.startsWith("$2")).toBe(true); // bcrypt hash prefix
  });

  it("verifyPassword accepts the right password and rejects a wrong one", async () => {
    const u = await users.createUser("a@b.com", "right-pass");
    expect(await users.verifyPassword(u, "right-pass")).toBe(true);
    expect(await users.verifyPassword(u, "wrong-pass")).toBe(false);
  });

  it("verifyPassword safely returns false for a null user or empty password", async () => {
    expect(await users.verifyPassword(null, "x")).toBe(false);
    const u = await users.createUser("a@b.com", "x");
    expect(await users.verifyPassword(u, "")).toBe(false);
  });
});

describe("authUsers: email normalization", () => {
  it("normalizes email case/whitespace consistently between create and lookup", async () => {
    await users.createUser("  Admin@Example.COM  ", "pw");
    const found = await users.findByEmail("admin@example.com");
    expect(found).toBeTruthy();
    expect(found.email).toBe("admin@example.com");
  });
});

describe("authUsers: bootstrap admin (BUG-002 — never leave zero possible logins)", () => {
  it("creates exactly one admin when the users table is empty", async () => {
    const created = await users.ensureBootstrapAdmin();
    expect(created).toBeTruthy();
    expect(created.email).toBe("admin@istmarkets.local");
    expect(created.password.length).toBeGreaterThanOrEqual(10);
    expect(state.users.length).toBe(1);
  });

  it("does nothing (returns null) once a user already exists", async () => {
    await users.createUser("someone@else.com", "pw");
    const created = await users.ensureBootstrapAdmin();
    expect(created).toBeNull();
    expect(state.users.length).toBe(1); // unchanged
  });

  it("the generated bootstrap password actually verifies against the stored hash", async () => {
    const created = await users.ensureBootstrapAdmin();
    const user = await users.findByEmail(created.email);
    expect(await users.verifyPassword(user, created.password)).toBe(true);
  });
});

describe("authUsers: brute-force lockout counter (SEC-5)", () => {
  it("counts only FAILED attempts for the given email", async () => {
    await users.recordLogin({ email: "x@y.com", success: false });
    await users.recordLogin({ email: "x@y.com", success: false });
    await users.recordLogin({ email: "x@y.com", success: true }); // a success doesn't reduce the count
    await users.recordLogin({ email: "other@y.com", success: false }); // different email, doesn't count
    expect(await users.recentFailedAttempts("x@y.com")).toBe(2);
  });

  it("lockout threshold is reached after LOCKOUT_THRESHOLD failures", async () => {
    for (let i = 0; i < users.LOCKOUT_THRESHOLD; i++) {
      await users.recordLogin({ email: "brute@y.com", success: false });
    }
    expect(await users.recentFailedAttempts("brute@y.com")).toBeGreaterThanOrEqual(users.LOCKOUT_THRESHOLD);
  });
});
