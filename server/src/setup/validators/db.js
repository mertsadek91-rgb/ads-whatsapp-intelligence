// Prove a MySQL connection really works before the wizard lets the operator
// past the first step.
//
// The privilege probe matters more than it looks: ensureSchema() runs a
// 646-line script over a multipleStatements connection. Without proving CREATE
// TABLE first, the "create the tables" step dies halfway through behind a
// progress bar with a raw MySQL error, leaving a half-built schema.
//
// Credentials arrive as an argument and are never read from config, which is
// what lets the post-install Settings page reuse this untouched.
import mysql from "mysql2/promise";
import { fail, pass } from "../errorMap.js";
import { sslOption, isTlsTrustError, normalizeSsl } from "../../lib/mysqlSsl.js";

// The app writes with ON DUPLICATE KEY UPDATE c = VALUES(c), which every MySQL
// and every MariaDB understands — so the floor is only what the schema itself
// needs (JSON columns, utf8mb4), not a syntax version. It briefly was 8.0.19,
// because the upserts used the MySQL-only row-alias form; that cost a real
// installation its whole wizard, silently, since reads and logins worked.
export const MIN_MYSQL = [5, 7, 0];
export const MIN_MARIADB = [10, 2, 0];

/**
 * MariaDB is not MySQL, and the version number says the opposite.
 *
 * MariaDB reports "10.6.16-MariaDB" or "11.4.2-MariaDB-log". Compared as
 * numbers that is 10 or 11 against a minimum of 8, so it sails through a check
 * written for MySQL — and then fails on every write the app makes, because the
 * row-alias upsert form the whole data layer is built on (INSERT ... AS new
 * ON DUPLICATE KEY UPDATE) is MySQL 8.0.19+ only and MariaDB has never
 * implemented it.
 *
 * What that looks like without this check is the worst kind of failure: the
 * database step passes, every dashboard read works, login works — the session
 * store happens to use the older syntax — and every single save fails.
 */
export const isMariaDb = (versionString) => /mariadb/i.test(String(versionString || ""));

/**
 * MariaDB is not MySQL, and its version number says the opposite: "11.8.9-
 * MariaDB" compared as numbers is 11 against a MySQL minimum of 8, so it passes
 * a check written for MySQL. Both are supported now, but they need their own
 * floors — MariaDB 10.2 is where JSON columns arrived.
 */
export function versionAtLeast(versionString, min) {
  const floor = min || (isMariaDb(versionString) ? MIN_MARIADB : MIN_MYSQL);
  const m = String(versionString || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const got = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (got[i] > floor[i]) return true;
    if (got[i] < floor[i]) return false;
  }
  return true;
}

/** MySQL/driver error -> the code the wizard knows how to explain. */
export function classify(err) {
  // A TLS trust failure is not a connection problem and must not be reported
  // as one: the fix is a setting, not a different host or password.
  if (isTlsTrustError(err)) return "DB_TLS_UNTRUSTED";
  const code = err?.code || "";
  const errno = err?.errno;
  if (code === "ECONNREFUSED") return "DB_CONN_REFUSED";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DB_DNS";
  if (code === "ETIMEDOUT" || code === "PROTOCOL_SEQUENCE_TIMEOUT") return "DB_TIMEOUT";
  if (code === "ER_ACCESS_DENIED_ERROR" || errno === 1045) return "DB_ACCESS_DENIED";
  if (code === "ER_HOST_NOT_PRIVILEGED" || errno === 1130) return "DB_HOST_NOT_PRIVILEGED";
  if (code === "ER_BAD_DB_ERROR" || errno === 1049) return "DB_NO_DATABASE";
  if (code === "ER_DBACCESS_DENIED_ERROR" || errno === 1044) return "DB_NO_SCHEMA_ACCESS";
  if (code === "ER_NOT_SUPPORTED_AUTH_MODE" || errno === 1251) return "DB_AUTH_PLUGIN";
  // The server insists on TLS and we offered none.
  if (errno === 3159 || /secure transport/i.test(err?.message || "")) return "DB_TLS_REQUIRED";
  return "UNKNOWN";
}

const conn = (input, withDatabase = true) => {
  const ssl = sslOption(normalizeSsl(input.ssl));
  return mysql.createConnection({
    host: input.host,
    port: Number(input.port || 3306),
    user: input.user,
    password: input.password ?? "",
    ...(withDatabase && input.database ? { database: input.database } : {}),
    ...(ssl ? { ssl } : {}),
    connectTimeout: 8000,
  });
};

/**
 * Connect, check the server version, confirm the app can actually create
 * tables, and report what is already there.
 */
export async function validate(input) {
  if (!input?.host) return fail("DB_CONN_REFUSED", "no host given");
  if (!input?.database) return fail("DB_NO_DATABASE", "no database name given");

  let c;
  try {
    c = await conn(input);
  } catch (e) {
    return fail(classify(e), e.message);
  }

  try {
    const warnings = [];
    const [[ver]] = await c.query("select version() v");
    if (!versionAtLeast(ver.v)) {
      return fail("DB_VERSION_TOO_OLD", `server reports ${ver.v}`);
    }

    const [[cs]] = await c.query("show variables like 'character_set_server'");
    if (cs && !/utf8mb4/i.test(cs.Value || "")) warnings.push("DB_WRONG_CHARSET");

    // Prove CREATE/DROP now rather than halfway through the schema script.
    try {
      await c.query("create table if not exists _setup_probe (i int)");
      await c.query("drop table if exists _setup_probe");
    } catch (e) {
      return fail("DB_NO_CREATE_PRIVILEGE", e.message);
    }

    const [[tables]] = await c.query(
      "select count(*) n from information_schema.tables where table_schema = ?", [input.database]);

    return pass({
      version: ver.v,
      charset: cs?.Value || null,
      database: input.database,
      existingTables: Number(tables.n || 0),
    }, warnings);
  } catch (e) {
    return fail(classify(e), e.message);
  } finally {
    await c.end().catch(() => {});
  }
}

/**
 * Create the database itself, for the very common case of correct credentials
 * pointing at a schema nobody has created yet. Offered as a button rather than
 * done silently — creating a database is the operator's decision.
 */
export async function createDatabase(input) {
  if (!input?.database) return fail("DB_NO_DATABASE", "no database name given");
  // Identifier, not a value, so it cannot be parameterised. Restrict hard.
  if (!/^[A-Za-z0-9_]{1,64}$/.test(input.database)) {
    return fail("DB_NO_DATABASE", "database name must be letters, digits or underscore");
  }
  let c;
  try {
    c = await conn(input, false);
    await c.query(
      `create database if not exists \`${input.database}\` character set utf8mb4 collate utf8mb4_unicode_ci`);
    return pass({ created: input.database });
  } catch (e) {
    return fail(classify(e), e.message);
  } finally {
    await c?.end().catch(() => {});
  }
}

export default { validate, createDatabase, versionAtLeast, classify, MIN_MYSQL };
