// What .gitignore says and what git actually tracks are two different things,
// and only the second one is published.
//
// This repository learnt that the hard way. The ignore rule for the directory
// holding the database password, the session secret and the AES key that
// decrypts every stored API token was written as:
//
//     server/data/          # setup.json holds DB credentials + the keys
//
// Git does not accept a trailing comment on a pattern line — it reads the
// comment as part of the path — so the rule matched nothing, and the file was
// committed in six consecutive commits without one warning. Reading the
// .gitignore would not have revealed it. Asking git would have.
//
// So this asks git.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let tracked = null;
try {
  tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
} catch {
  tracked = null;     // not a git checkout (a tarball, a Docker build context)
}

// Paths that must never be committed, each with the reason, because a failure
// here needs to say what was about to be published rather than only that a
// pattern matched.
const FORBIDDEN = [
  [/(^|\/)data\/setup\.json$/,
    "the install state: database password, session secret, and the AES key that decrypts every stored API token"],
  [/(^|\/)\.env$/, "real credentials — only .env.example belongs in git"],
  [/(^|\/)\.env\.(?!example$)[^/]+$/, "an environment file for a real deployment"],
  [/(^|\/)data\//, "the runtime data directory, which holds install state"],
  [/\.pem$|\.key$|\.p12$|\.pfx$|id_rsa/, "a private key or certificate"],
  [/(^|\/)(coverage|dist|node_modules)\//, "build output, not source"],
  [/\.log$/, "a log file, which on this project has contained customer phone numbers"],
];

describe.skipIf(!tracked)("what this repository publishes", () => {
  it("tracks no file that carries credentials or runtime state", () => {
    const offenders = [];
    for (const file of tracked) {
      for (const [pattern, why] of FORBIDDEN) {
        if (pattern.test(file)) offenders.push(`${file} — ${why}`);
      }
    }
    expect(offenders, `these are committed and would be published:\n  ${offenders.join("\n  ")}`)
      .toEqual([]);
  });

  it("ignores the runtime data directory for real, not just on paper", () => {
    // `git check-ignore` answers the question the ignore file only appears to.
    // It is asked about a path that need not exist, so this holds on a fresh
    // clone as well as on a machine with a live install.
    let ignored = true;
    try {
      execFileSync("git", ["check-ignore", "-q", "server/data/setup.json"], { cwd: repo });
    } catch {
      ignored = false;
    }
    expect(ignored, "server/data/ is not actually ignored — check for a trailing comment on the pattern line").toBe(true);
  });

  it("keeps .env.example, which is the file that documents the rest", () => {
    // The ignore rules deny `.env.*` and then re-admit this one. A change that
    // dropped the negation would silently delete the install documentation.
    expect(tracked).toContain(".env.example");
  });
});
