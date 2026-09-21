// Bring a command-line entry point up to the same state the server boots into.
//
// Once the setup wizard became the way an installation is configured, the CLI
// jobs were left behind: the database credentials live in setup.json and every
// integration token lives (encrypted) in app_config, and neither is reachable
// through the environment any more. `npm run backfill` on a wizard-installed
// instance therefore failed at the first query with "database not configured",
// and any job that did connect would have run with no Meta or Wati token.
//
// server.js does this inline as part of activateRuntime(); this is the same
// sequence for a process that is not serving HTTP.
import config from "../config.js";
import * as setupState from "./setupState.js";
import * as appConfig from "./appConfig.js";
import * as businessProfile from "./businessProfile.js";
import { setKeyProvider } from "./secretBox.js";
import { resetPool } from "../db.js";

export async function bootstrapCli({ quiet = false } = {}) {
  // The AES key that decrypts stored credentials.
  setKeyProvider(() => setupState.ensureSecretKey());

  // An explicit MYSQL_URL always wins — an operator who set it owns it.
  const saved = setupState.readState().mysql;
  if (saved && !process.env.MYSQL_URL) config.mysql = saved;
  await resetPool();

  const applied = await appConfig.hydrate();
  const profile = await businessProfile.hydrate();

  if (!quiet) {
    console.log(
      `[cli] configuration loaded (${applied.applied} stored values), ` +
      `business profile v${profile.version} (${profile.source})`);
  }
  return { config, profile };
}

export default bootstrapCli;
