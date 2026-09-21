// The whole install, against a real MySQL.
//
// Everything else in the suite mocks the driver, which proves the logic but not
// that the 646-line schema actually applies, that `INSERT ... AS new` is
// accepted by the server you are pointed at, or that a profile round-trips
// through a JSON column. This is the test that proves an install works.
//
// It needs a throwaway database and SKIPS ITSELF when there is none, so it can
// live in the repo without making `npm test` depend on infrastructure:
//
//   docker run -d --name mysql-test -e MYSQL_ROOT_PASSWORD=rootpw \
//     -e MYSQL_DATABASE=install_test -p 33061:3306 mysql:8.4
//   TEST_MYSQL_URL="mysql://root:rootpw@127.0.0.1:33061/install_test" \
//     npm run test:integration
//
// WARNING: it creates and drops tables in the database you point it at. Never
// aim it at anything you care about.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import config, { parseMysqlUrl } from "../../src/config.js";
import * as dbValidator from "../../src/setup/validators/db.js";

const URL_ = process.env.TEST_MYSQL_URL;
const parsed = URL_ ? parseMysqlUrl(URL_) : null;

// describe.skipIf keeps the file honest: it reports as skipped rather than
// passing vacuously, so a green run without a database cannot be mistaken for
// a verified install.
const suite = parsed ? describe : describe.skip;

suite("a real installation, end to end", () => {
  let db, query, ensureSchema, bp;

  beforeAll(async () => {
    // Point the runtime at the throwaway database, the same way the wizard's
    // db/save step does.
    config.mysql = parsed;
    db = await import("../../src/db.js");
    await db.resetPool();
    ({ query } = db);
    ({ ensureSchema } = await import("../../src/jobs/backfill.js"));
    bp = await import("../../src/lib/businessProfile.js");
  });

  afterAll(async () => { await db?.resetPool(); });

  it("accepts the credentials and reports a usable server", async () => {
    const r = await dbValidator.validate(parsed);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    // 8.0.19+ is a hard requirement: older servers accept the schema and then
    // fail on every ingest, because the app writes INSERT ... AS new.
    expect(dbValidator.versionAtLeast(r.details.version)).toBe(true);
  });

  it("creates the whole schema from nothing", async () => {
    await ensureSchema();
    const rows = await query(
      "select table_name t from information_schema.tables where table_schema = database()");
    const tables = rows.map((r) => r.t || r.TABLE_NAME);
    for (const required of [
      "ads_wati_contacts", "ads_meta_daily", "ads_conversation_analysis",
      "ads_conversation_eval", "ads_conversation_issue", "ads_users", "ads_sessions",
      "ads_settings", "app_config", "app_business_profile",
    ]) {
      expect(tables, `missing ${required}`).toContain(required);
    }
  });

  it("is safe to re-run, which is what the wizard's retry does", async () => {
    await expect(ensureSchema()).resolves.not.toThrow();
  });

  it("accepts INSERT ... AS new, which every ingest depends on", async () => {
    await db.upsert("ads_settings", ["k", "v"], [["install_probe", "a"]], ["k"]);
    await db.upsert("ads_settings", ["k", "v"], [["install_probe", "b"]], ["k"]);
    const [row] = await query("select v from ads_settings where k = 'install_probe'");
    expect(row.v).toBe("b");
    await query("delete from ads_settings where k = 'install_probe'");
  });

  it("stores Arabic text without mangling it", async () => {
    // utf8mb4 end to end. A latin1 column silently turns customer names into
    // question marks, and it is discovered months later in a report.
    const arabic = "محمد عبدالله — تجربة ✅";
    await db.upsert("ads_settings", ["k", "v"], [["install_probe_ar", arabic]], ["k"]);
    const [row] = await query("select v from ads_settings where k = 'install_probe_ar'");
    expect(row.v).toBe(arabic);
    await query("delete from ads_settings where k = 'install_probe_ar'");
  });

  it("round-trips a business profile and activates it", async () => {
    const { GENERIC_PROFILE } = await import("../../src/profiles/generic.js");
    const seed = JSON.parse(JSON.stringify(GENERIC_PROFILE));
    seed.identity.company_name = "عيادة الاختبار";
    seed.identity.what_we_sell = "عيادة أسنان تتلقّى حجوزات عبر واتساب.";

    const saved = await bp.saveDraft(seed, { source: "ai" });
    expect(saved.errors).toEqual([]);

    const first = await bp.activateDraft({ activatedBy: "install-test" });
    expect(first.policy_version).toBeTruthy();

    await bp.hydrate();
    expect(bp.getProfile().identity.company_name).toBe("عيادة الاختبار");

    // A label-only edit must not cost a re-analysis — this is the behaviour the
    // fingerprint exists for, and it is worth proving against the real column
    // rather than only in memory.
    const relabelled = JSON.parse(JSON.stringify(bp.getProfile()));
    relabelled.issue_types[0].ar = "صياغة أخرى تماماً";
    await bp.saveDraft(relabelled, { source: "human" });
    const second = await bp.activateDraft({ activatedBy: "install-test" });
    expect(second.reanalysisRequired).toBe(false);
    expect(second.policy_version).toBe(first.policy_version);

    // Changing the vocabulary must.
    const revocabularised = JSON.parse(JSON.stringify(bp.getProfile()));
    revocabularised.issue_types.push({
      key: "brand_new_issue", default_severity: "major", ar: "جديد", en: "New" });
    await bp.saveDraft(revocabularised, { source: "human" });
    const third = await bp.activateDraft({ activatedBy: "install-test" });
    expect(third.reanalysisRequired).toBe(true);
    expect(third.policy_version).not.toBe(first.policy_version);

    // Exactly one active profile, always.
    const [{ n }] = await query(
      "select count(*) n from app_business_profile where status = 'active'");
    expect(Number(n)).toBe(1);
  });

  it("creates an admin nobody can lock themselves out of", async () => {
    const users = await import("../../src/lib/authUsers.js");
    const email = `install-test-${Date.now()}@example.com`;
    await users.createUser(email, "a-long-enough-password", "admin");
    const u = await users.findByEmail(email);
    expect(u).toBeTruthy();
    expect(await users.verifyPassword(u, "a-long-enough-password")).toBe(true);
    // The password is hashed, never stored as typed.
    expect(u.password_hash).not.toContain("a-long-enough-password");
    expect(await users.isLastActiveAdmin(u.id)).toBe(
      (await users.activeAdminCount()) <= 1);
    await users.deleteUser(u.id);
  });

  it("encrypts stored credentials so a database dump does not leak them", async () => {
    const box = await import("../../src/lib/secretBox.js");
    box.setKeyProvider(() => "d".repeat(64));
    const appConfig = await import("../../src/lib/appConfig.js");

    await appConfig.saveConfig({ "wati.token": "a-real-looking-token-value" });
    const [row] = await query("select v, is_secret from app_config where k = 'wati.token'");
    expect(row.is_secret).toBe(1);
    expect(row.v).not.toContain("a-real-looking-token-value");   // ciphertext on disk

    await appConfig.hydrate();
    expect(config.wati.token).toBe("a-real-looking-token-value"); // plaintext in memory
    await query("delete from app_config where k = 'wati.token'");
  });
});

// Reported explicitly rather than silently: a skipped install test must not look
// like a passing one.
if (!parsed) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n[install.test] SKIPPED — set TEST_MYSQL_URL to a throwaway database to run the real install test.\n");
}
