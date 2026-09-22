// Build the front end from the server directory.
//
// Managed Node hosts (Hostinger, Render, Railway and the like) ask for one
// "root directory" and run install, build and start inside it. This project has
// two packages, so pointing that root at `server/` — which is what makes the
// API's own dependencies install correctly — leaves the web build with nobody
// to run it, and the deployment comes up serving an API and no pages.
//
// Putting the path logic in a file rather than in a text box in a control panel
// means it is reviewed, tested and fixed in the repository, instead of being a
// shell one-liner somebody typed once and nobody can find.
//
// Usage: npm run build:web   (from server/)
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../../web");

if (!existsSync(path.join(web, "package.json"))) {
  // The whole repository is not present — some hosts ship only the configured
  // root directory. That is a deployment setting to change, not an error to
  // paper over, so say which setting and stop without a stack trace.
  console.error(
    `[build:web] ${web} is not in this deployment.\n` +
    "            The host copied only the server directory, so there is no front end to build.\n" +
    "            Set the deployment's root directory to the repository root, or deploy the\n" +
    "            Docker image instead — it builds both stages itself.");
  process.exit(1);
}

// npm ci when there is a lockfile to honour, npm install when there is not.
const install = existsSync(path.join(web, "package-lock.json")) ? "ci" : "install";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

for (const args of [[install, "--no-audit", "--no-fund"], ["run", "build"]]) {
  console.log(`[build:web] npm ${args.join(" ")}`);
  const r = spawnSync(npm, args, { cwd: web, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const dist = path.join(web, "dist", "index.html");
if (!existsSync(dist)) {
  console.error(`[build:web] the build finished but produced no ${dist}`);
  process.exit(1);
}
console.log(`[build:web] done — ${dist}`);
