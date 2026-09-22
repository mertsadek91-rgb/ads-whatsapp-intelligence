// Keep a copy of what this process says at boot, on disk.
//
// Managed hosting routinely shows the BUILD log and nothing else. A deployment
// can then build perfectly, die on its first line, and answer 503 forever with
// no way for the operator to see why — the panel's only log ends in "built in
// 3.30s" with nothing wrong in it. That is not a hypothetical: it cost several
// rounds of guessing on a real install, because every diagnosis had to be
// inferred from the outside.
//
// So the process writes its own. It goes in DATA_DIR, which is the one
// directory an operator already knows about and which survives redeploys, and
// it is readable from any file manager without SSH.
//
// Rules this follows, because a logger that breaks boot is worse than no log:
//   - every call is best-effort and swallows its own errors
//   - it never holds the file open
//   - it truncates rather than growing without bound
import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 256 * 1024;
let logPath = null;

/** Point the log at DATA_DIR and start a fresh run. Safe to call once. */
export function openBootLog(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, "boot.log");
    // Keep the previous run: the interesting one is often the run BEFORE the
    // one you are looking at, when a restart loop is involved.
    try {
      if (fs.statSync(logPath).size > MAX_BYTES) fs.renameSync(logPath, `${logPath}.1`);
    } catch { /* no previous log */ }
    write(`\n=== boot ${new Date().toISOString()} · pid ${process.pid} · node ${process.version} ===`);
  } catch {
    logPath = null;   // unwritable DATA_DIR is reported separately; never throw here
  }
  return logPath;
}

/** Append one line. Never throws, never blocks on failure. */
export function write(line) {
  if (!logPath) return;
  try { fs.appendFileSync(logPath, `${line}\n`); } catch { /* best effort */ }
}

/**
 * Mirror console output into the log as well as the terminal.
 *
 * Wrapping console rather than asking every call site to log twice: the lines
 * worth having are the ones already written for a human to read, and a parallel
 * logging API would drift from them immediately.
 */
export function mirrorConsole() {
  for (const level of ["log", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      write(args.map((a) => (typeof a === "string" ? a : inspect(a))).join(" "));
    };
  }
}

const inspect = (v) => {
  try { return typeof v === "object" ? JSON.stringify(v) : String(v); }
  catch { return String(v); }
};

/**
 * Record what killed the process.
 *
 * Without this an uncaught exception at boot prints to a stderr nobody can
 * read and the app is simply gone — which from the outside is indistinguishable
 * from never having started.
 */
export function recordCrashes() {
  process.on("uncaughtException", (e) => {
    write(`FATAL uncaughtException: ${e?.stack || e}`);
    console.error("[fatal] uncaught exception:", e?.stack || e);
    process.exit(1);
  });
  // Recorded, NOT fatal.
  //
  // Exiting here — which is also Node's own default — turns one unguarded await
  // anywhere in the process into a site-wide outage: every in-flight request
  // dies, the proxy in front answers 503, and the supervisor restarts into the
  // same failure on the next attempt. A single request failing is recoverable;
  // the whole application disappearing is not. An uncaught exception is
  // different: the stack is already unwound and the process state is unknown,
  // so that one still ends it.
  process.on("unhandledRejection", (e) => {
    write(`unhandledRejection (kept running): ${e?.stack || e}`);
    console.error("[error] unhandled rejection — the process keeps serving:", e?.stack || e);
  });
}

export default { openBootLog, write, mirrorConsole, recordCrashes };
