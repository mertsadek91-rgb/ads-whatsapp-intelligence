// A duplicate key in the dictionary is invisible everywhere except the source.
//
// AR_TO_EN is one object literal, so by the time anything can inspect it the
// duplicates are gone: the later value has silently replaced the earlier one.
// Reading the file as text is not laziness here, it is the only vantage point
// from which the defect exists at all.
//
// It is worth catching because the two values are not always the same. The
// build was reporting seven duplicates, and in two of them the wording differed
// — a stage badge meant to read "Interested" was rendering the lowercase
// "interested" written for the middle of a sentence, because that entry came
// later in the file. Vite only warns, and a warning in a 60-line build log that
// still ends in "built in 3.30s" is a warning nobody reads.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Resolved from the package root, not from import.meta.url: this suite runs in
// jsdom, where import.meta.url is an http:// URL and readFileSync refuses it.
const src = readFileSync(path.resolve(process.cwd(), "src/i18n.jsx"), "utf8");

/** Every "key": "value" pair in source order, with its line. */
function pairs() {
  const re = /"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  const out = [];
  src.split("\n").forEach((line, i) => {
    for (const [, key, value] of line.matchAll(re)) out.push({ key, value, line: i + 1 });
  });
  return out;
}

describe("the translation dictionary", () => {
  it("defines each Arabic string exactly once", () => {
    const seen = new Map();
    const duplicates = [];
    for (const p of pairs()) {
      if (seen.has(p.key)) {
        const first = seen.get(p.key);
        duplicates.push(
          `"${p.key}" — line ${first.line} ("${first.value}") is dead; ` +
          `line ${p.line} ("${p.value}") wins`);
      } else {
        seen.set(p.key, p);
      }
    }
    expect(duplicates, `duplicate keys:\n  ${duplicates.join("\n  ")}`).toEqual([]);
  });

  it("has enough entries to be the real dictionary and not a stub", () => {
    // Guards against the regex silently matching nothing after a refactor,
    // which would make the check above pass for the wrong reason.
    expect(pairs().length).toBeGreaterThan(500);
  });
});
