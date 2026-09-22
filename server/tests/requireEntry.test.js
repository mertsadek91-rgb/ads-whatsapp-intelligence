// The entry file must be require()-able, not only importable.
//
// This project is ESM and is normally started as `node src/server.js`, which
// works whatever the graph contains. But the CloudLinux/Passenger runners
// behind much shared hosting — Hostinger's among them — `require()` the entry
// file instead. Node allows that for ESM, with one exception: if anything in
// the graph uses TOP-LEVEL AWAIT it raises ERR_REQUIRE_ASYNC_MODULE and the
// process dies before serving a request.
//
// That is invisible from every other angle. The tests passed, `npm start`
// worked, the build log was clean, and the site answered 503 for days. Two
// `await`s in a CLI block — `await bootstrapCli()` in backfill.js, which
// server.js imports for ensureSchema — were enough.
//
// So this runs the thing the host runs. It is a subprocess rather than an
// in-process require because requiring the entry starts a listening server.
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Start the entry the way a CJS host does, and report what happened. */
function requireEntry() {
  return new Promise((resolve) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "require-entry-"));
    const child = spawn(process.execPath, ["-e", "require('./src/server.js')"], {
      cwd: serverRoot,
      // PORT=0 asks the OS for any free port, so this never collides with a
      // developer's running server or another test.
      env: { ...process.env, PORT: "0", DATA_DIR: dataDir, NODE_ENV: "test" },
    });

    let out = "";
    const done = (result) => {
      child.kill();
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
      resolve(result);
    };

    const read = (chunk) => {
      out += chunk.toString();
      if (/Listening on/.test(out)) done({ listening: true, out });
      if (/ERR_REQUIRE_ASYNC_MODULE/.test(out)) done({ listening: false, out });
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", () => done({ listening: /Listening on/.test(out), out }));
    setTimeout(() => done({ listening: false, out, timedOut: true }), 20000);
  });
}

describe("the entry file under a CommonJS host", () => {
  it("can be require()d, so no top-level await has crept into the graph", async () => {
    const r = await requireEntry();
    expect(r.out, "a top-level await somewhere in the boot graph — " +
      "run node --experimental-print-required-tla to find it")
      .not.toMatch(/ERR_REQUIRE_ASYNC_MODULE/);
    expect(r.listening, `the server did not start under require():\n${r.out}`).toBe(true);
  }, 30000);
});
