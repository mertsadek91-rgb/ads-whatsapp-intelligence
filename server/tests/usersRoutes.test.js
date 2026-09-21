// Account administration and self-service password change. Neither existed:
// createUser() was reachable only from ensureBootstrapAdmin(), so an install
// had exactly one account forever, with a random password printed once to the
// server log — while the startup banner and the README both told the operator
// to change it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const state = { users: [], nextId: 1 };

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, p = []) => {
    if (sql.includes("count(*) n from ads_users")) {
      return [{ n: state.users.filter((u) => u.role === "admin" && u.status === "active").length }];
    }
    if (sql.startsWith("select id, email, role, status")) return state.users;
    if (sql.startsWith("select * from ads_users where email")) {
      return state.users.filter((u) => u.email === p[0]);
    }
    if (sql.startsWith("select * from ads_users where id")) {
      return state.users.filter((u) => u.id === Number(p[0]));
    }
    if (sql.startsWith("insert into ads_users")) {
      state.users.push({ id: state.nextId++, email: p[0], password_hash: p[1], role: p[2], status: "active" });
      return {};
    }
    if (sql.startsWith("update ads_users set password_hash")) {
      const u = state.users.find((x) => x.id === Number(p[1])); if (u) u.password_hash = p[0];
      return {};
    }
    if (sql.startsWith("update ads_users set")) {
      const u = state.users.find((x) => x.id === Number(p[p.length - 1]));
      if (u) { if (sql.includes("role = ?")) u.role = p[0]; if (sql.includes("status = ?")) u.status = p[sql.includes("role = ?") ? 1 : 0]; }
      return {};
    }
    if (sql.startsWith("delete from ads_users")) {
      state.users = state.users.filter((x) => x.id !== Number(p[0])); return {};
    }
    if (sql.startsWith("insert into ads_login_logs")) return {};
    return [];
  }),
}));
vi.mock("../src/lib/errorLog.js", () => ({ logError: vi.fn() }));

const usersRouter = (await import("../src/routes/users.js")).default;
const authRouter = (await import("../src/routes/auth.js")).default;
const users = await import("../src/lib/authUsers.js");

const app = (session) => {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = session; next(); });
  a.use("/users", usersRouter);
  a.use("/auth", authRouter);
  return a;
};
const admin = { userId: 1, email: "admin@x.io", role: "admin" };

beforeEach(async () => {
  state.users = []; state.nextId = 1;
  await users.createUser("admin@x.io", "correct-horse-battery", "admin");
});

describe("POST /users", () => {
  it("creates an account with a clamped role", async () => {
    const r = await request(app(admin)).post("/users")
      .send({ email: "New@Example.com ", password: "another-long-one", role: "wizard" });
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe("new@example.com"); // normalised
    expect(r.body.user.role).toBe("viewer");           // unknown role is not privileged
  });

  it("refuses a password below the minimum length", async () => {
    const r = await request(app(admin)).post("/users").send({ email: "a@b.c", password: "short" });
    expect(r.status).toBe(400);
    expect(state.users.length).toBe(1);
  });

  it("refuses a duplicate email instead of failing on the unique index", async () => {
    const r = await request(app(admin)).post("/users")
      .send({ email: "admin@x.io", password: "another-long-one" });
    expect(r.status).toBe(409);
  });
});

describe("guards against locking everyone out", () => {
  it("refuses to demote the only active admin", async () => {
    const r = await request(app(admin)).patch("/users/1").send({ role: "viewer" });
    expect(r.status).toBe(409);
    expect(state.users[0].role).toBe("admin");
  });

  it("refuses to disable the only active admin", async () => {
    const r = await request(app(admin)).patch("/users/1").send({ status: "disabled" });
    expect(r.status).toBe(409);
  });

  it("allows the demotion once a second admin exists", async () => {
    await users.createUser("two@x.io", "another-long-one", "admin");
    const r = await request(app(admin)).patch("/users/1").send({ role: "viewer" });
    expect(r.status).toBe(200);
    expect(state.users[0].role).toBe("viewer");
  });

  it("refuses to delete your own account", async () => {
    await users.createUser("two@x.io", "another-long-one", "admin");
    const r = await request(app(admin)).delete("/users/1");
    expect(r.status).toBe(409);
  });
});

describe("POST /auth/change-password", () => {
  it("changes the password when the current one is right", async () => {
    const r = await request(app(admin)).post("/auth/change-password")
      .send({ current_password: "correct-horse-battery", new_password: "a-brand-new-secret" });
    expect(r.status).toBe(200);
    const u = await users.findByEmail("admin@x.io");
    expect(await users.verifyPassword(u, "a-brand-new-secret")).toBe(true);
    expect(await users.verifyPassword(u, "correct-horse-battery")).toBe(false);
  });

  it("refuses a wrong current password and leaves the old one working", async () => {
    const r = await request(app(admin)).post("/auth/change-password")
      .send({ current_password: "not-it", new_password: "a-brand-new-secret" });
    expect(r.status).toBe(401);
    const u = await users.findByEmail("admin@x.io");
    expect(await users.verifyPassword(u, "correct-horse-battery")).toBe(true);
  });

  it("refuses a weak new password", async () => {
    const r = await request(app(admin)).post("/auth/change-password")
      .send({ current_password: "correct-horse-battery", new_password: "short" });
    expect(r.status).toBe(400);
  });

  it("refuses reusing the current password", async () => {
    const r = await request(app(admin)).post("/auth/change-password")
      .send({ current_password: "correct-horse-battery", new_password: "correct-horse-battery" });
    expect(r.status).toBe(400);
  });

  it("requires a session", async () => {
    const r = await request(app({})).post("/auth/change-password")
      .send({ current_password: "correct-horse-battery", new_password: "a-brand-new-secret" });
    expect(r.status).toBe(401);
  });
});
