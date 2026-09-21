// .env.example drifted badly in the original build: config.js read 37
// variables, the example documented 16 of them, one documented variable had
// been dead since the auth rebuild, and three shipped one company's real
// account identifiers as defaults.
//
// A document that describes the code is only as good as the thing that keeps it
// honest, so this parses config.js for what it ACTUALLY reads and fails the
// build on any gap in either direction.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const configSrc = readFileSync(path.join(root, "server/src/config.js"), "utf8");
const exampleSrc = readFileSync(path.join(root, ".env.example"), "utf8");

// config.js reads the environment through `const E = process.env`.
const readByConfig = [...new Set([...configSrc.matchAll(/\bE\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))];

// Both live and commented-out lines count as documented: a variable an operator
// should usually leave alone is still documented by being shown commented.
const documented = new Set(
  [...exampleSrc.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

// Read outside config.js, or consumed by the runtime rather than the config object.
const EXTRA = ["NODE_ENV", "PUPPETEER_EXECUTABLE_PATH", "TRUST_PROXY_HOPS",
  "DATA_DIR", "APP_SECRET_KEY", "BOOTSTRAP_ADMIN_EMAIL", "TZ"];

describe(".env.example describes the code", () => {
  it("documents every variable config.js reads", () => {
    const missing = readByConfig.filter((v) => !documented.has(v));
    expect(missing, `undocumented: ${missing.join(", ")}`).toEqual([]);
  });

  it("documents nothing the code does not read", () => {
    // APP_PASSWORD survived in the example long after the auth rebuild removed
    // its last reader, which told new installers to set something with no effect.
    const known = new Set([...readByConfig, ...EXTRA]);
    const stale = [...documented].filter((v) => !known.has(v));
    expect(stale, `documented but unread: ${stale.join(", ")}`).toEqual([]);
  });

  it("ships no real account identifier as a default", () => {
    expect(exampleSrc).not.toMatch(/=\s*\d{15,}/);
    expect(exampleSrc).not.toMatch(/act_\d+/);
  });

  it("ships no value that looks like a real credential", () => {
    expect(exampleSrc).not.toMatch(/EAA[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\./);
    // The MySQL URL must be a placeholder, not a password someone can read.
    expect(exampleSrc).toMatch(/MYSQL_URL=mysql:\/\/USER:PASSWORD@/);
  });

  it("marks the variables that must be set before the app can run", () => {
    for (const v of ["MYSQL_URL", "SESSION_SECRET", "WATI_API_ENDPOINT", "WATI_ACCESS_TOKEN"]) {
      expect(documented.has(v), v).toBe(true);
    }
    expect(exampleSrc).toMatch(/REQUIRED/);
  });
});
