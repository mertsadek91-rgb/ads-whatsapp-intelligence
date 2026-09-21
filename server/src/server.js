// IST Markets APP — Express server: REST API + serves the built React UI.
import express from "express";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import config from "./config.js";
import { pool } from "./db.js";
import { healthCheck } from "./lib/health.js";
import { apiLog } from "./middleware/apiLog.js";
import { requireAuth } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import analyticsRoutes from "./routes/analytics.js";
import leadsRoutes from "./routes/leads.js";
import adminRoutes, { hydrateJobs as hydrateAdminJobs } from "./routes/admin.js";
import metaAuthRoutes from "./routes/metaAuth.js";
import conversationsRoutes, { hydrateJobs as hydrateConversationJobs } from "./routes/conversations.js";
import reportRoutes from "./routes/report.js";
import settingsRoutes from "./routes/settings.js";
import knowledgeRoutes from "./routes/knowledge.js";
import salesboardRoutes from "./routes/salesboard.js";
import assignmentRoutes from "./routes/assignment.js";
import tagRoutes from "./routes/tags.js";
import broadcastsRoutes from "./routes/broadcasts.js";
import qualityReviewRoutes from "./routes/qualityReview.js";
import publicBoardRoutes from "./routes/publicBoard.js";
import * as metaAuth from "./lib/metaAuth.js";
import * as authUsers from "./lib/authUsers.js";
import { ensureSchema } from "./jobs/backfill.js";
import { startScheduler } from "./jobs/scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// BUG-010 fix: MemoryStore (express-session's default) leaks memory under
// load and forgets every session on restart/redeploy. Points at the ads_sessions
// table (schema.sql) via the same pool as the rest of the app; table creation
// is owned by ensureSchema(), not this library, hence createDatabaseTable:false.
const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({ createDatabaseTable: false, schema: { tableName: "ads_sessions" } }, pool());

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(session({
  store: sessionStore,
  secret: config.auth.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000 },
}));

// Public + protected API
app.use("/api", apiLog);
app.use("/api/auth", authRoutes);
// Public kiosk board — token-gated, NO session auth (wall-display link).
app.use("/api/public", publicBoardRoutes);
// BUG-044 fix: used to report {ok:true} whenever the process was merely
// alive, even if its MySQL connection was down — the Docker HEALTHCHECK
// (Dockerfile) needs this to actually reflect whether the app can serve
// real requests, since almost every route here is DB-backed.
app.get("/api/health", async (req, res) => {
  const result = await healthCheck();
  res.status(result.ok ? 200 : 503).json(result);
});
app.use("/api/analytics", requireAuth, analyticsRoutes);
app.use("/api/leads", requireAuth, leadsRoutes);
app.use("/api/admin", requireAuth, adminRoutes);
app.use("/api/meta", requireAuth, metaAuthRoutes);
app.use("/api/conversations", requireAuth, conversationsRoutes);
app.use("/api/report", requireAuth, reportRoutes);
app.use("/api/settings", requireAuth, settingsRoutes);
app.use("/api/knowledge", requireAuth, knowledgeRoutes);
app.use("/api/salesboard", requireAuth, salesboardRoutes);
app.use("/api/assignment", requireAuth, assignmentRoutes);
app.use("/api/quality", requireAuth, qualityReviewRoutes);
app.use("/api/tags", requireAuth, tagRoutes);
app.use("/api/broadcasts", requireAuth, broadcastsRoutes);

// Serve built frontend (web/dist) if present
const dist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(dist, "index.html"));
  });
}

async function boot() {
  try { await ensureSchema(); }
  catch (e) { console.error("[boot] schema ensure failed:", e.message); }
  // BUG-012 fix: only safe to hydrate job status from ads_job_state once
  // ensureSchema() above has guaranteed the table exists (matters on a fresh
  // database's very first boot).
  try { await hydrateAdminJobs(); } catch (e) { console.error("[boot] admin job hydrate failed:", e.message); }
  try { await hydrateConversationJobs(); } catch (e) { console.error("[boot] conversation job hydrate failed:", e.message); }
  // BUG-002 fix: bootstrap exactly one admin account the first time the app
  // ever runs against a fresh `ads_users` table, so retiring the shared
  // APP_PASSWORD never locks everyone out. Printed once — only the bcrypt
  // hash is stored, this password cannot be recovered afterward.
  try {
    const created = await authUsers.ensureBootstrapAdmin();
    if (created) {
      console.log(
        "\n" + "=".repeat(60) +
        "\n[boot] First run — created the initial admin account:\n" +
        `  email:    ${created.email}\n` +
        `  password: ${created.password}\n` +
        "  (shown once — log in now and change it; this cannot be recovered)\n" +
        "=".repeat(60) + "\n"
      );
    }
  } catch (e) { console.error("[boot] admin bootstrap failed:", e.message); }
  // Adopt the .env seed token (upgrade to long-lived) + refresh if near expiry.
  try {
    const seed = config.meta.token;
    if (seed && metaAuth.appConfigured() && !(await metaAuth.getToken().then((t) => t && t !== seed))) {
      await metaAuth.adoptToken(seed).catch((e) => console.warn("[boot] meta adopt:", e.message));
    }
    const r = await metaAuth.ensureFresh();
    if (r.refreshed) console.log("[boot] Meta token refreshed.");
  } catch (e) { console.warn("[boot] meta auth:", e.message); }
  startScheduler();
  app.listen(config.port, () => console.log(`IST Markets APP on http://0.0.0.0:${config.port}`));
}

boot();
