// Every var(--x) in the stylesheet must resolve.
//
// This exists because of a real defect: the selected-tag chip was styled
// `background: var(--brand); color: #fff`, and --brand was never defined in this
// palette. CSS does not warn — the background silently fell back to nothing and
// the white text landed on a white card, so the chips were rendered, counted,
// and completely invisible. A typo in a variable name should fail here, not in
// front of the owner.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// import.meta.url is not a file: URL under the jsdom environment, so resolve
// from the project root that vitest runs in.
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

// Declarations look like `--name:value`; references look like `var(--name)`.
const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
const referenced = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]);

describe("CSS custom properties", () => {
  it("declares every variable the stylesheet references", () => {
    const missing = [...new Set(referenced.filter((v) => !declared.has(v)))].sort();
    expect(missing).toEqual([]);
  });

  it("is actually looking at something", () => {
    // A regex that silently matches nothing would make the test above vacuous.
    expect(declared.size).toBeGreaterThan(20);
    expect(referenced.length).toBeGreaterThan(50);
  });
});
