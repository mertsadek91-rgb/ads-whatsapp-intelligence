// This product was extracted from a single-company build, and the company's
// name, ad account and WhatsApp numbers were compiled into eleven places —
// report headers, six email subjects, the sidebar, the login page, the kiosk
// footer, the browser tab. Every one of those would have announced a new
// installation as somebody else's business.
//
// These tests are the guard that stops any of it coming back. They scan the
// shipped source, so a paste of the old string fails the build rather than
// reaching a customer's report header.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as identity from "../src/lib/appIdentity.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "coverage" || entry === "data") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) { sourceFiles(full, acc); continue; }
    if (/\.(js|mjs|jsx|sql|json|html|css)$/.test(entry) && entry !== "package-lock.json") acc.push(full);
  }
  return acc;
}

// The AI prompt layer still names the original business. That is deliberate and
// tracked separately: those strings become the editable business profile, which
// is generated per installation rather than swept with a regex. Listing them
// here keeps the exemption explicit instead of silently weakening the guard.
const PROMPT_LAYER = [
  "src/lib/tagAssign.js",
  "src/lib/tagTaxonomy.js",
  "src/lib/tagRules.js",
  "src/lib/knowledgeBase.js",
  "src/lib/weeklyReports.js",
  "src/routes/report.js",
  "src/routes/analytics.js",
];

const scanned = sourceFiles(path.join(root, "src"))
  .concat(sourceFiles(path.join(root, "tests")))
  .concat(sourceFiles(path.join(root, "scripts")))
  .map((f) => ({ rel: path.relative(root, f).split(path.sep).join("/"), text: readFileSync(f, "utf8") }))
  .filter((f) => !f.rel.endsWith("tests/branding.test.js"));

const outsidePromptLayer = scanned.filter((f) => !PROMPT_LAYER.includes(f.rel));

describe("no company identity is compiled into the shipped source", () => {
  it("carries no company name outside the AI prompt layer", () => {
    const hits = outsidePromptLayer
      .filter((f) => /ist[ _-]?markets/i.test(f.text))
      // The deployment-hardening test asserts the OLD lock name is gone, so it
      // legitimately mentions it.
      .filter((f) => f.rel !== "tests/regression.deployHardening.test.js")
      .map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it("carries no real ad account or campaign identifier anywhere", () => {
    // A hardcoded ad account default meant a fresh install with no env var
    // would have issued Graph API calls against a stranger's account.
    const hits = scanned.filter((f) => /133471367053077|120235482467810125/.test(f.text)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it("carries no real business WhatsApp number", () => {
    const hits = scanned.filter((f) => /97152105731|97156117862/.test(f.text)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it("uses no company address as a default admin account", () => {
    const hits = scanned.filter((f) => /admin@istmarkets/i.test(f.text)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });
});

describe("app identity", () => {
  it("defaults to a neutral product name rather than any company", () => {
    expect(identity.DEFAULT_IDENTITY.appNameEn).toBe("Analytics");
    expect(JSON.stringify(identity.DEFAULT_IDENTITY)).not.toMatch(/ist/i);
  });

  it("renders the name in the language being used, falling back safely", () => {
    const id = identity.sanitizeIdentity({ appName: "عيادة النور", appNameEn: "Al Noor Clinic" });
    expect(identity.displayName(id, "ar")).toBe("عيادة النور");
    expect(identity.displayName(id, "en")).toBe("Al Noor Clinic");
    // An installation that only filled in Arabic still gets a usable English name.
    const arOnly = identity.sanitizeIdentity({ appName: "عيادة النور", appNameEn: "" });
    expect(identity.displayName(arOnly, "en")).toBeTruthy();
  });

  it("accepts only a hex colour, since it is interpolated into CSS", () => {
    // This value reaches a CSS custom property in the browser. Anything other
    // than a colour would be an injection point.
    expect(identity.sanitizeIdentity({ primaryColor: "#0EA5E9" }).primaryColor).toBe("#0EA5E9");
    for (const bad of ["red", "#ZZZ", "url(javascript:alert(1))", "#fff; } body{display:none", "expression(x)"]) {
      expect(identity.sanitizeIdentity({ primaryColor: bad }).primaryColor, bad).toBeNull();
    }
  });

  it("caps the monogram so it cannot break the sidebar layout", () => {
    expect(identity.sanitizeIdentity({ monogram: "TOOLONGNAME" }).monogram).toHaveLength(3);
  });

  it("never returns credentials or settings in the public subset", () => {
    const pub = identity.publicIdentity(identity.sanitizeIdentity({ senderName: "ops@x.io", reportFooter: "secret" }));
    expect(pub.senderName).toBeUndefined();
    expect(pub.reportFooter).toBeUndefined();
  });
});
