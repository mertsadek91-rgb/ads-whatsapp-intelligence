// The SQL this app writes must run on MariaDB as well as MySQL.
//
// Every upsert used INSERT ... AS new ON DUPLICATE KEY UPDATE c = new.c — a
// row-alias form MySQL added in 8.0.19 and that no MariaDB release implements.
// MariaDB is what most shared hosting provides, which made the product
// uninstallable there in the worst possible way: the schema applied, reads
// worked, login worked (the session library uses the older syntax), and every
// single save failed. A live installation on MariaDB 11.8 found it.
//
// VALUES(col) means the same thing and both accept it.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

function sources(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) { sources(full, acc); continue; }
    if (entry.endsWith(".js")) acc.push(full);
  }
  return acc;
}

const files = sources(srcDir).map((f) => ({
  rel: path.relative(srcDir, f).split(path.sep).join("/"),
  text: readFileSync(f, "utf8"),
}));

describe("the data layer speaks SQL both servers understand", () => {
  it("declares no row alias on an upsert", () => {
    const offenders = files
      .filter((f) => /as\s+new\s+on\s+duplicate\s+key\s+update/i.test(f.text))
      .map((f) => f.rel);
    expect(offenders, `MySQL-8.0.19-only row alias in:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("references no row alias in an update clause", () => {
    // `new.col` is only meaningful with the alias, so it is the other half of
    // the same defect and worth catching separately: a half-converted statement
    // is a parse error rather than a wrong answer.
    const offenders = files.filter((f) => /\bnew\.[A-Za-z_`]/.test(f.text)).map((f) => f.rel);
    expect(offenders, `row-alias column references in:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("still writes upserts — this guard must not pass by there being none left", () => {
    const withUpserts = files.filter((f) => /on\s+duplicate\s+key\s+update/i.test(f.text));
    expect(withUpserts.length).toBeGreaterThan(15);
    // And they use the portable form.
    const portable = withUpserts.filter((f) => /values\s*\(/i.test(f.text));
    expect(portable.length).toBe(withUpserts.length);
  });
});

describe("the version gate knows the two products apart", () => {
  it("accepts what each server needs and refuses what it cannot do", async () => {
    const { versionAtLeast, isMariaDb } = await import("../src/setup/validators/db.js");
    // MariaDB's number looks newer than MySQL's and means something different:
    // 11.8 as a plain number sails past a MySQL floor of 8.
    expect(isMariaDb("11.8.9-MariaDB-log")).toBe(true);
    expect(versionAtLeast("11.8.9-MariaDB-log")).toBe(true);
    expect(versionAtLeast("10.2.0-MariaDB")).toBe(true);
    expect(versionAtLeast("10.1.9-MariaDB")).toBe(false);   // before JSON columns
    expect(versionAtLeast("8.0.18")).toBe(true);            // no longer refused
    expect(versionAtLeast("5.7.44")).toBe(true);
    expect(versionAtLeast("5.6.51")).toBe(false);
  });
});
