// Boot. Two phases, one process.
//
// Phase 1 always happens: resolve a session secret, start listening, and serve
// /api/health plus the setup wizard. This works with no database, no .env and
// no configuration of any kind — which is the point, because the wizard is how
// you configure it.
//
// Phase 2 — activateRuntime() — runs either at boot (already installed) or the
// moment the wizard finishes, and is the same function in both cases. That is
// what lets an operator complete setup and land on a working dashboard without
// being told to restart anything.
import fs from "node:fs";
import path from "node:path";
import config, { isStrongSecret } from "./config.js";
import * as setupState from "./lib/setupState.js";
import * as bootLog from "./lib/bootLog.js";
import * as webBuild from "./lib/webBuild.js";
import * as appConfig from "./lib/appConfig.js";
import * as businessProfile from "./lib/businessProfile.js";
import { setKeyProvider } from "./lib/secretBox.js";
import { supportsSystemCa, systemCaEnabled } from "./lib/tlsTrust.js";
import { ensureInstallToken } from "./middleware/setupAccess.js";
import { setActivator } from "./routes/setup.js";
import { app, buildApiRouter, setRuntimeRouter } from "./app.js";
import { resetPool } from "./db.js";
import { hydrateJobs as hydrateAdminJobs } from "./routes/admin.js";
import { hydrateJobs as hydrateConversationJobs } from "./routes/conversations.js";
import * as metaAuth from "./lib/metaAuth.js";
import * as authUsers from "./lib/authUsers.js";
import { ensureSchema } from "./jobs/backfill.js";
import { startScheduler } from "./jobs/scheduler.js";

// Before anything else at all, including the lines below this one. A failure
// during module initialisation is exactly the kind that produces a silent 503:
// the process is gone before it serves a request, and hosting that shows only
// the build log has nothing to show. This file is where the reason goes.
const BOOT_LOG = bootLog.openBootLog(setupState.dataDir());
bootLog.mirrorConsole();
bootLog.recordCrashes();

// Resolved before anything else: config.js no longer hard-exits on a missing
// SESSION_SECRET, because that made a fresh clone unbootable and encouraged
// operators to paste the example value to get past it. A value they set
// explicitly is still validated strictly; otherwise a strong one is generated
// and persisted to setup.json.
config.auth.sessionSecret = setupState.ensureSessionSecret({ isStrongSecret });
setKeyProvider(() => setupState.ensureSecretKey());

let activated = false;

export async function activateRuntime() {
  // The database credentials live in setup.json until the app is installed,
  // because the wizard that collects them cannot store them in the database.
  const saved = setupState.readState().mysql;
  if (saved && !process.env.MYSQL_URL) config.mysql = saved;
  await resetPool();

  await ensureSchema();
  const hydrated = await appConfig.hydrate();
  if (hydrated.applied) console.log(`[boot] applied ${hydrated.applied} stored configuration values`);
  // The vocabulary every AI prompt and validator is built from.
  const profileMeta = await businessProfile.hydrate();
  console.log(`[boot] business profile v${profileMeta.version} (${profileMeta.source}), policy ${profileMeta.policy_version}`);

  // Only safe once ensureSchema() has guaranteed ads_job_state exists — which
  // matters on a fresh database's very first boot.
  try { await hydrateAdminJobs(); } catch (e) { console.error("[boot] admin job hydrate failed:", e.message); }
  try { await hydrateConversationJobs(); } catch (e) { console.error("[boot] conversation job hydrate failed:", e.message); }

  // Never leave an installed app with zero possible logins. The wizard creates
  // the first admin itself, so this only fires for a headless install.
  try {
    const created = await authUsers.ensureBootstrapAdmin();
    if (created) {
      console.log(
        "\n" + "=".repeat(64) +
        "\n[boot] First run — created the initial admin account:\n" +
        `  email:    ${created.email}\n` +
        `  password: ${created.password}\n` +
        "  Shown once. Log in and change it under Users & Permissions —\n" +
        "  only the bcrypt hash is stored, so it cannot be recovered.\n" +
        "=".repeat(64) + "\n");
    }
  } catch (e) { console.error("[boot] admin bootstrap failed:", e.message); }

  // Adopt an .env seed token (upgrading it to long-lived) and refresh near expiry.
  try {
    const seed = config.meta.token;
    if (seed && metaAuth.appConfigured() && !(await metaAuth.getToken().then((t) => t && t !== seed))) {
      await metaAuth.adoptToken(seed).catch((e) => console.warn("[boot] meta adopt:", e.message));
    }
    const r = await metaAuth.ensureFresh();
    if (r.refreshed) console.log("[boot] Meta token refreshed.");
  } catch (e) { console.warn("[boot] meta auth:", e.message); }

  // The swap: every /api/* path stops answering 503 and starts serving.
  setRuntimeRouter(buildApiRouter());
  startScheduler();
  activated = true;
  console.log("[boot] runtime active.");
}

// The wizard's final step calls this, so setup completes without a restart.
setActivator(async () => {
  if (activated) return;
  await activateRuntime();
});

/**
 * Say, once, that this process will not trust the operating system's
 * certificates.
 *
 * On a machine running antivirus with HTTPS scanning, or behind a corporate
 * gateway, every outbound call is re-signed with a root certificate that lives
 * in the OS store. Browsers use that store; Node ships its own list and ignores
 * it. The result is a URL that works in Chrome and fails here, which is a
 * genuinely confusing thing to debug — so name it at boot rather than waiting
 * for a validator to fail.
 */
function printTlsHint() {
  if (!supportsSystemCa() || systemCaEnabled() || process.env.NODE_EXTRA_CA_CERTS) return;
  console.log(
    "[tls] Using Node's own certificate list, not the operating system's.\n" +
    "      If a connection fails with \"self-signed certificate in certificate chain\"\n" +
    "      while the same URL works in your browser, something is inspecting TLS\n" +
    "      (antivirus HTTPS scanning, or a corporate proxy). Start with:\n" +
    "        npm run start:trusted\n");
}

function printSetupBanner() {
  const token = ensureInstallToken();
  console.log(
    "\n" + "=".repeat(64) +
    "\n[setup] Not installed yet. Open the installation wizard:\n" +
    `  ${config.appBaseUrl}/setup\n` +
    `  install token: ${token}\n` +
    "  (only needed from a browser that is not on this machine)\n" +
    "=".repeat(64) + "\n");
}

/**
 * Prove the data directory is usable before anything needs it.
 *
 * setup.json lives here: the database credentials, the session secret, and the
 * key that decrypts every stored API token. It is created on first write, which
 * is in the middle of the wizard — so a DATA_DIR that is wrong or unwritable
 * surfaces as a failed step three screens in, with the real cause nowhere near
 * the message. Checking at boot moves it to the one place someone is already
 * reading, and names the directory so a typo is obvious.
 */
function checkDataDir() {
  const dir = setupState.dataDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    console.log(`[boot] data directory: ${dir}`);
    // Named explicitly: on hosting that only shows the build log, this file is
    // the only place the reason for a failed start will be written down.
    if (BOOT_LOG) console.log(`[boot] boot log: ${BOOT_LOG}`);
    if (!process.env.DATA_DIR) {
      // On managed hosting the application directory is usually replaced on
      // every deploy, which silently takes the installation with it.
      console.log("       DATA_DIR is not set, so this sits inside the app directory. " +
        "If your host replaces that on deploy, point DATA_DIR somewhere persistent.");
    }
  } catch (e) {
    console.error(
      `[boot] cannot write to the data directory ${dir}: ${e.message}\n` +
      "       Setup will fail when it tries to save. Fix DATA_DIR or the directory's permissions.");
  }
}

async function boot() {
  // Listen first, unconditionally. A container that refuses to start because it
  // has no database is a container nobody can configure.
  printTlsHint();
  checkDataDir();

  // Report what was actually bound, not what was asked for — server.address()
  // is the only thing that knows, and on a host that proxies to a socket it is
  // the difference between "started" and "reachable".
  const server = app.listen(config.listen, () => {
    const bound = server.address();
    console.log(typeof bound === "string"
      ? `Listening on unix socket ${bound}`
      : `Listening on http://0.0.0.0:${bound.port}`);
    if (process.env.PORT && typeof config.listen === "string") {
      console.log(`       PORT is a socket path, not a number — bound to it as given.`);
    }
  });

  server.on("error", (e) => {
    console.error(
      `[boot] could not listen on ${JSON.stringify(config.listen)}: ${e.message}\n` +
      `       PORT=${JSON.stringify(process.env.PORT ?? null)}. ` +
      "Nothing will reach this app until that is resolved.");
  });

  // A release that arrived without the built front end builds it now, in the
  // background. Not awaited: on a host that kills a process for taking too long
  // to bind, blocking here to run an npm install would turn a missing page into
  // a dead application.
  webBuild.buildIfMissing();

  if (!setupState.isInstalled()) return printSetupBanner();

  try {
    await activateRuntime();
  } catch (e) {
    // Stay up and keep serving /api/health so the failure is diagnosable from
    // outside the container, rather than crash-looping.
    console.error("[boot] could not activate the runtime:", e.message);
  }
}

boot();
