// A duplicate key in AR_TO_EN's object literal silently collapses to
// whichever occurrence comes last (JS objects can't warn you at runtime —
// by the time the module loads, the duplicate is already gone). This
// happened for real: "جارٍ التوليد…" was defined twice, only caught by
// esbuild's build-time warning (which doesn't fail the build) in a Coolify
// deployment log. A static scan of the source text is the only way to catch
// this in a test, since the loaded object never shows evidence of it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "..", "src", "i18n.jsx"), "utf8");

describe("i18n.jsx — AR_TO_EN dictionary", () => {
  it("has no duplicate Arabic source-string keys", () => {
    // Matches a quoted string immediately followed by a colon, at the start
    // of a dictionary entry line — mirrors the "key": "value" shape used
    // throughout AR_TO_EN (including multi-line entries where the value
    // wraps to the next line).
    const keyPattern = /^\s*"((?:[^"\\]|\\.)*)":/gm;
    const counts = {};
    let match;
    while ((match = keyPattern.exec(source))) {
      const key = match[1];
      counts[key] = (counts[key] || 0) + 1;
    }
    const duplicates = Object.entries(counts).filter(([, n]) => n > 1).map(([k]) => k);
    expect(duplicates).toEqual([]);
  });
});
