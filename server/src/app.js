// Express wiring, split from the boot sequence so the app can listen BEFORE it
// has a database.
//
// The setup wizard has to be reachable on a machine where nothing is
// configured yet, which means the process must start and serve HTTP with no
// MySQL connection at all. Express cannot un-register middleware once mounted,
// so every authenticated route is reached through one indirection — a `let`
// holding the current API router — and boot swaps it from "not installed" to
// the real thing once setup completes. That is what lets the wizard finish
// without asking the operator to restart anything.
import express from "express";
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";

import config from "./config.js";
import { pool } from "./db.js";
import { healthCheck } from "./lib/health.js";
import { apiLog } from "./middleware/apiLog.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import * as setupState from "./lib/setupState.js";
import * as webBuild from "./lib/webBuild.js";

import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import analyticsRoutes from "./routes/analytics.js";
import leadsRoutes from "./routes/leads.js";
import adminRoutes from "./routes/admin.js";
import metaAuthRoutes from "./routes/metaAuth.js";
import conversationsRoutes from "./routes/conversations.js";
import reportRoutes from "./routes/report.js";
import settingsRoutes from "./routes/settings.js";
import knowledgeRoutes from "./routes/knowledge.js";
import salesboardRoutes from "./routes/salesboard.js";
import assignmentRoutes from "./routes/assignment.js";
import tagRoutes from "./routes/tags.js";
import broadcastsRoutes from "./routes/broadcasts.js";
import qualityReviewRoutes from "./routes/qualityReview.js";
import publicBoardRoutes from "./routes/publicBoard.js";
import businessProfileRoutes from "./routes/businessProfile.js";
import setupRoutes from "./routes/setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Answers every /api/* path until setup completes. 503 with a machine-readable
// code so the SPA can route the user to the wizard instead of showing a
// generic failure.
const notInstalledRouter = express.Router();
notInstalledRouter.use((req, res) => res.status(503).json({
  error: "setup_required",
  message: "التطبيق لم يُهيّأ بعد — افتح /setup لإكمال التنصيب (application is not set up yet)",
}));

let runtimeRouter = notInstalledRouter;
export function setRuntimeRouter(r) { runtimeRouter = r; }

export const app = express();

app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 0));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use("/api", apiLog);

// ---- Always available, in both modes -------------------------------------

// The Dockerfile HEALTHCHECK hits this. In setup mode it MUST answer 200:
// reporting 503 because no database is configured would have Docker kill the
// container before anyone could reach the wizard to configure one.
app.get("/api/health", async (req, res) => {
  if (!setupState.isInstalled()) return res.json({ ok: true, mode: "setup" });
  const result = await healthCheck();
  res.status(result.ok ? 200 : 503).json({ ...result, mode: "running" });
});

app.use("/api/setup", setupRoutes);

// The login screen has to render the installation’s own name and colour
// before anyone has signed in, so a deliberately minimal subset of the app
// identity is public. It carries no configuration and no credentials.
app.get("/api/identity", async (req, res) => {
  try {
    const { getIdentity, publicIdentity } = await import("./lib/appIdentity.js");
    res.json(publicIdentity(await getIdentity()));
  } catch {
    const { DEFAULT_IDENTITY, publicIdentity } = await import("./lib/appIdentity.js");
    res.json(publicIdentity(DEFAULT_IDENTITY));   // never block the login page
  }
});

// ---- Everything else goes through the swappable router -------------------
app.use("/api", (req, res, next) => runtimeRouter(req, res, next));

/**
 * The real API, assembled only once a database exists — the session store needs
 * a live pool, so this cannot be built at import time.
 */
export function buildApiRouter() {
  const r = express.Router();

  // BUG-010: MemoryStore leaks under load and forgets every session on restart.
  // Table creation is owned by ensureSchema(), not this library.
  const MySQLStore = MySQLStoreFactory(session);
  const store = new MySQLStore(
    { createDatabaseTable: false, schema: { tableName: "ads_sessions" } }, pool());

  r.use(session({
    store,
    secret: config.auth.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // Coupled to `trust proxy` above: secure:true without it makes Express
      // see req.protocol === "http" behind a TLS-terminating proxy and refuse
      // to set the cookie, breaking login. Fixing either alone is wrong.
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 3600 * 1000,
    },
  }));

  r.use("/auth", authRoutes);
  // Public kiosk board — token-gated, no session (wall-display link).
  r.use("/public", publicBoardRoutes);

  // Read surfaces: any signed-in account.
  r.use("/analytics", requireAuth, analyticsRoutes);
  r.use("/leads", requireAuth, leadsRoutes);
  r.use("/conversations", requireAuth, conversationsRoutes);
  r.use("/report", requireAuth, reportRoutes);
  r.use("/knowledge", requireAuth, knowledgeRoutes);
  r.use("/salesboard", requireAuth, salesboardRoutes);
  r.use("/quality", requireAuth, qualityReviewRoutes);
  r.use("/tags", requireAuth, tagRoutes);
  // Not admin-gated at the mount: the CurrencyProvider fetches /settings/currency
  // on every page for every signed-in user. The read/write split lives inside
  // that router instead.
  r.use("/settings", requireAuth, settingsRoutes);
  // What is still unconfigured. Any signed-in user may see it: the point is
  // that nobody wonders why a board is empty.
  r.get("/onboarding", requireAuth, async (req, res) => {
    const { onboardingStatus } = await import("./lib/onboarding.js");
    res.json(onboardingStatus());
  });

  // Write surfaces. Conservative on purpose: admin unless there is a clear
  // day-to-day reason an operations manager needs it.
  r.use("/admin", requireRole("admin"), adminRoutes);
  r.use("/meta", requireRole("admin"), metaAuthRoutes);
  r.use("/users", requireRole("admin"), usersRoutes);
  // These values decide how every employee is scored, so admin only.
  r.use("/business-profile", requireRole("admin"), businessProfileRoutes);
  r.use("/assignment", requireRole("admin", "manager"), assignmentRoutes);
  r.use("/broadcasts", requireRole("admin"), broadcastsRoutes);

  return r;
}

// ---- Static SPA ----------------------------------------------------------
// The API is served whether or not the front end was built, because the two
// fail for different reasons and a running API is still worth having — the
// setup wizard needs nothing else. What is not acceptable is failing silently,
// which is what this did before: a deployment that never ran the web build
// answered every page with a bare API 404, and the only clue was in a build log
// nobody re-reads.
// Mounted unconditionally, and whether it has anything to serve is decided per
// REQUEST rather than once at import. A release can arrive without the built
// front end and gain it a minute later — which is exactly what happens on a
// host that builds in one directory and runs from another — and deciding this
// at import time would leave such a deployment serving the "not built" page
// until somebody restarted it.
app.use(express.static(webBuild.distDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  if (webBuild.isBuilt()) return res.sendFile(path.join(webBuild.distDir, "index.html"));

  const s = webBuild.status();
  if (s.status === "building") {
    return res.status(503).type("text/plain; charset=utf-8")
      .set("Retry-After", "30")
      .send("جارٍ بناء الواجهة الآن — أعِد التحميل بعد دقيقة.\n" +
            "The front end is being built right now — reload in a minute.\n");
  }
  res.status(503).type("text/plain; charset=utf-8").send(
    "الواجهة لم تُبنَ بعد — شغّل \"npm run build\" في خطوة البناء.\n" +
    "The front end has not been built. Run \"npm run build\" in your deploy's build step.\n" +
    `Expected: ${webBuild.distDir}\n` +
    (s.error ? `\nLast build attempt failed:\n${s.error}\n` : ""));
});

export default app;
