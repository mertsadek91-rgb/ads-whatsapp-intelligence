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
import config, { isStrongSecret } from "./config.js";
import * as setupState from "./lib/setupState.js";
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

async function boot() {
  // Listen first, unconditionally. A container that refuses to start because it
  // has no database is a container nobody can configure.
  printTlsHint();
  app.listen(config.port, () => console.log(`Listening on http://0.0.0.0:${config.port}`));

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
