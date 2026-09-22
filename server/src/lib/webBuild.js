// Make sure there is a front end to serve, even when the deployment lost it.
//
// Hostinger — and every host with a similar release model — builds in one
// directory and RUNS from another:
//
//   build:  hbuilds/source/repository/web/dist
//   run:    hbuilds/versions/<uuid>/web/dist
//
// The release copy is git-based, and web/dist is gitignored, so the thing the
// build step produced never reaches the directory the app runs from. The build
// log says "done", the API works, and every page is a 503. Nothing in either
// place is wrong; they are simply different directories.
//
// Rather than committing build output to git to work around one host's model,
// the app builds what it is missing, once, in the background. Boot is not
// blocked: the API is up immediately — which is what the setup wizard needs —
// and pages start working as soon as the build lands, with no restart.
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "../..");
export const distDir = path.resolve(serverRoot, "../web/dist");
const indexFile = path.join(distDir, "index.html");
const builder = path.join(serverRoot, "scripts", "build-web.mjs");

// "ready" once seen, and then never re-checked: a built front end does not
// un-build itself, and this is consulted on every page request.
let state = { status: "unknown", error: null };

/** Is there something to serve right now? */
export function isBuilt() {
  if (state.status === "ready") return true;
  if (existsSync(indexFile)) { state = { status: "ready", error: null }; return true; }
  return false;
}

/** What to tell a visitor who arrived before it was ready. */
export function status() {
  isBuilt();
  return { ...state, dist: distDir };
}

/**
 * Build it if it is missing. Returns immediately; the build runs detached.
 *
 * Deliberately not awaited by boot. On a host that kills a process for taking
 * too long to bind, blocking here to run an npm install would turn a missing
 * page into a dead application.
 */
export function buildIfMissing({ onDone = () => {} } = {}) {
  if (isBuilt() || state.status === "building") return state;
  if (!existsSync(builder)) {
    state = { status: "failed", error: `no builder at ${builder}` };
    return state;
  }

  state = { status: "building", error: null };
  console.log("[web] no built front end in this release — building it now. " +
    "The API is already up; pages will work in a minute or two.");

  const child = spawn(process.execPath, [builder], { cwd: serverRoot, stdio: ["ignore", "pipe", "pipe"] });
  let tail = "";
  const keep = (c) => { tail = (tail + c.toString()).slice(-2000); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  child.on("exit", (code) => {
    if (code === 0 && isBuilt()) {
      console.log("[web] front end built — pages are being served now.");
    } else {
      state = { status: "failed", error: tail.trim() || `builder exited ${code}` };
      console.error(`[web] could not build the front end (exit ${code}):\n${tail.trim()}`);
    }
    onDone(state);
  });
  child.on("error", (e) => {
    state = { status: "failed", error: e.message };
    console.error("[web] could not start the builder:", e.message);
    onDone(state);
  });

  return state;
}

export default { distDir, isBuilt, status, buildIfMissing };
