// The session carried a `role` from the day per-user login was introduced —
// routes/auth.js wrote it at login and /me read it back — but nothing ever
// checked it. Every signed-in account, including a read-only sales agent, could
// rotate the Meta token, rewrite settings, trigger a full resync, or send a
// WhatsApp broadcast to the whole contact list at real per-message cost. The
// Broadcasts page's "type the campaign name to arm Send" was a client-side
// guard, which is not a guard.
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { requireAuth, requireRole } from "../src/middleware/auth.js";

const appWith = (mw, session) => {
  const app = express();
  app.use((req, _res, next) => { req.session = session; next(); });
  app.get("/x", mw, (_req, res) => res.json({ ok: true }));
  return app;
};

describe("requireRole", () => {
  it("lets an allowed role through", async () => {
    const r = await request(appWith(requireRole("admin"), { userId: 1, role: "admin" })).get("/x");
    expect(r.status).toBe(200);
  });

  it("refuses a signed-in account whose role is not allowed", async () => {
    const r = await request(appWith(requireRole("admin"), { userId: 2, role: "viewer" })).get("/x");
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("forbidden");
  });

  it("accepts any one of several allowed roles", async () => {
    const r = await request(appWith(requireRole("admin", "manager"), { userId: 3, role: "manager" })).get("/x");
    expect(r.status).toBe(200);
  });

  it("fails closed on a session with no role rather than defaulting to one", async () => {
    // A session predating roles, or a hand-forged one, must not be privileged.
    const r = await request(appWith(requireRole("admin"), { userId: 4 })).get("/x");
    expect(r.status).toBe(403);
  });

  it("answers 401, not 403, when there is no session at all", async () => {
    const r = await request(appWith(requireRole("admin"), {})).get("/x");
    expect(r.status).toBe(401);
  });

  it("never echoes the caller's own role back to them", async () => {
    const r = await request(appWith(requireRole("admin"), { userId: 5, role: "viewer" })).get("/x");
    expect(JSON.stringify(r.body)).not.toContain("viewer");
  });

  it("requireAuth alone still admits any signed-in account", async () => {
    const r = await request(appWith(requireAuth, { userId: 6, role: "viewer" })).get("/x");
    expect(r.status).toBe(200);
  });
});

describe("the money-spending and configuration routes are gated in app.js", () => {
  // The API router is assembled in app.js rather than at import, because the
  // session store needs a live database pool and the app must be able to listen
  // before one exists. Paths here are router-relative.
  const src = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  it.each([
    ['r.use("/admin", requireRole("admin"), adminRoutes);', "full resync / job control"],
    ['r.use("/meta", requireRole("admin"), metaAuthRoutes);', "rotates the ad-platform token"],
    ['r.use("/broadcasts", requireRole("admin"), broadcastsRoutes);', "sends messages that cost money"],
    ['r.use("/users", requireRole("admin"), usersRoutes);', "account administration"],
    ['r.use("/assignment", requireRole("admin", "manager"), assignmentRoutes);', "operations"],
  ])("%s  // %s", (mount) => {
    expect(src).toContain(mount);
  });

  it("/settings stays on requireAuth at the mount, because every user loads currency rates", () => {
    // The CurrencyProvider fetches /settings/currency on every page for every
    // signed-in account. Admin-gating the mount would blank the whole UI for
    // managers and viewers, so the read/write split lives inside the router.
    expect(src).toContain('r.use("/settings", requireAuth, settingsRoutes);');
    const settings = readFileSync(new URL("../src/routes/settings.js", import.meta.url), "utf8");
    for (const write of [
      'router.post("/currency"', 'router.post("/employees"', 'router.delete("/employees/:id"',
      'router.post("/employees/seed"', 'router.post("/reports"', 'router.post("/work-hours"',
      'router.get("/employees"',
    ]) {
      expect(settings).toContain(write + ", admin,");
    }
  });

  it("answers every API path with setup_required until the app is installed", () => {
    // Without this an unconfigured install would return confusing database
    // errors from deep inside a route instead of telling the SPA to go to /setup.
    expect(src).toContain('error: "setup_required"');
    expect(src).toContain("let runtimeRouter = notInstalledRouter;");
  });

  it("keeps /api/health answering 200 during setup, or Docker kills the container", () => {
    // The Dockerfile HEALTHCHECK hits /api/health. Reporting 503 because no
    // database is configured would restart the container before anyone could
    // reach the wizard to configure one.
    expect(src).toContain('return res.json({ ok: true, mode: "setup" });');
  });
});

describe("user administration cannot strand the install", () => {
  it("refuses to demote, disable or delete the last active admin", async () => {
    vi.resetModules();
    let rows = [{ id: 1, email: "a@b.c", role: "admin", status: "active" }];
    vi.doMock("../src/db.js", () => ({
      query: vi.fn(async (sql, p = []) => {
        if (sql.includes("count(*) n from ads_users")) {
          return [{ n: rows.filter((u) => u.role === "admin" && u.status === "active").length }];
        }
        if (sql.startsWith("select * from ads_users where id")) {
          return rows.filter((u) => u.id === Number(p[0]));
        }
        return [];
      }),
    }));
    const users = await import("../src/lib/authUsers.js");

    expect(await users.isLastActiveAdmin(1)).toBe(true);
    rows.push({ id: 2, email: "d@e.f", role: "admin", status: "active" });
    expect(await users.isLastActiveAdmin(1)).toBe(false);
    // A second admin who is disabled does not count as a safety net.
    rows[1].status = "disabled";
    expect(await users.isLastActiveAdmin(1)).toBe(true);
  });
});
