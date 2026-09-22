// MySQL access layer (port of the Python mdb.py). Tables live in the connection
// DB prefixed `ads_`. Provides query() and a batched upsert() using
// INSERT ... AS new ON DUPLICATE KEY UPDATE.
import mysql from "mysql2/promise";
import config from "./config.js";
import { sslOption } from "./lib/mysqlSsl.js";

let _pool = null;

/** True once a database has actually been configured (env or setup wizard). */
export function isConfigured() {
  return !!(config.mysql && config.mysql.host && config.mysql.database);
}

function mysqlSettings() {
  if (!isConfigured()) {
    // Deliberately explicit. config.mysql is null on a fresh install rather
    // than a fabricated root@127.0.0.1, so callers get "not configured yet"
    // instead of a confusing ECONNREFUSED against a host nobody chose.
    throw new Error("قاعدة البيانات غير مهيّأة بعد — أكمل خطوة الإعداد أولاً (database not configured)");
  }
  return config.mysql;
}

/**
 * Drop the pool so the next call rebuilds it from the current config. The setup
 * wizard needs this: it validates and saves database credentials in a running
 * process, and without it the app would keep using the pool built at boot from
 * whatever was (or wasn't) configured then.
 */
export async function resetPool() {
  const old = _pool;
  _pool = null;
  if (old) await old.end().catch(() => {});
}

export function pool() {
  if (!_pool) {
    const my = mysqlSettings();
    _pool = mysql.createPool({
      host: my.host,
      port: my.port,
      user: my.user,
      password: my.password,
      database: my.database,
      ...(sslOption(my.ssl) ? { ssl: sslOption(my.ssl) } : {}),
      charset: "utf8mb4",
      waitForConnections: true,
      connectionLimit: 8,
      // Fail fast rather than queue forever. With queueLimit 0 and no acquire
      // timeout, eight connections stuck on a half-open TCP path put every
      // later query in a queue nothing ever drains: query() never rejects, the
      // handler never responds, nothing is logged, and a proxy in front turns
      // the silence into 503. An error is recoverable; a hang is not.
      queueLimit: 50,
      connectTimeout: 10_000,
      // maxIdle must be BELOW connectionLimit or mysql2 never schedules its
      // idle reaper at all — so idleTimeout alone does nothing. Without the
      // reaper, connections are kept indefinitely and the free list is LIFO, so
      // a quiet pool rots behind a remote wait_timeout or a NAT idle drop and
      // the next request inherits a dead socket.
      maxIdle: 2,
      idleTimeout: 30_000,
      // The default keep-alive delay is the OS default — two hours on Linux,
      // useless against a five-minute NAT timer.
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      namedPlaceholders: false,
      dateStrings: false,
      // BUG-003 fix: without this, mysql2 defaults to the process/OS local
      // timezone when converting DATE/DATETIME columns to JS Date objects on
      // read (and back on write) — confirmed by audit (scripts/audit-timezone.js)
      // to shift every stored date back by exactly one day on every read,
      // even though the underlying stored data was always correct. Pinning
      // 'Z' (UTC) makes the driver treat stored values as UTC verbatim,
      // matching how ingestWati.js's `ymd()` derives dates (also pure UTC).
      timezone: "Z",
    });
  }
  return _pool;
}

/** Run a query, return array of row objects. Uses .query (not .execute) so dynamic
 *  filter SQL and inline LIMITs work without prepared-statement quirks. */
export async function query(sql, params = []) {
  const [rows] = await pool().query(sql, params);
  return rows;
}

/** Run a multi-statement SQL script (schema). Uses a one-off multipleStatements connection. */
export async function runScript(sqlText) {
  const my = mysqlSettings();
  const conn = await mysql.createConnection({
    host: my.host,
    port: my.port,
    user: my.user,
    password: my.password,
    database: my.database,
    ...(sslOption(my.ssl) ? { ssl: sslOption(my.ssl) } : {}),
    charset: "utf8mb4",
    multipleStatements: true,
    timezone: "Z", // BUG-003 fix — see pool() above
  });
  try {
    await conn.query(sqlText);
  } finally {
    await conn.end();
  }
}

function param(v) {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v;
  if (typeof v === "object") return JSON.stringify(v); // tags / raw -> JSON column
  return v;
}

/**
 * Batched upsert. rows = array of arrays aligned to cols.
 * conflictCols are the PK/unique cols.
 *
 * Two ways to protect an existing value from a partial sync:
 *   coalesceCols  — keep the existing value when the INCOMING value is NULL.
 *                   Right for facts we simply did not fetch this run.
 *   insertOnlyCols— write on INSERT, never on UPDATE. Right for a DERIVED value
 *                   (a score) that we can still compute for a brand-new row but
 *                   must not recompute from a partial input for an existing one,
 *                   where COALESCE would not help because the value is not null,
 *                   just worse.
 */
export async function upsert(table, cols, rows, conflictCols, { coalesceCols = [], insertOnlyCols = [], batch = 500 } = {}) {
  if (!rows.length) return 0;
  // dedup within the call by conflict key (keep last)
  const keyIdx = conflictCols.map((c) => cols.indexOf(c));
  const seen = new Map();
  for (const r of rows) seen.set(keyIdx.map((i) => r[i]).join(""), r);
  const deduped = [...seen.values()];

  const insertOnly = new Set(insertOnlyCols);
  const updateCols = cols.filter((c) => !conflictCols.includes(c) && !insertOnly.has(c));
  const coalesce = new Set(coalesceCols);
  const setClause = updateCols
    .map((c) => (coalesce.has(c) ? `\`${c}\`=COALESCE(new.\`${c}\`, ${table}.\`${c}\`)` : `\`${c}\`=new.\`${c}\``))
    .join(", ");
  const collist = cols.map((c) => `\`${c}\``).join(", ");
  const ph = "(" + cols.map(() => "?").join(",") + ")";

  let total = 0;
  const conn = pool();
  for (let i = 0; i < deduped.length; i += batch) {
    const chunk = deduped.slice(i, i + batch);
    const values = chunk.map(() => ph).join(",\n");
    const flat = chunk.flatMap((r) => r.map(param));
    const sql = `INSERT INTO ${table} (${collist}) VALUES\n${values}\nAS new ON DUPLICATE KEY UPDATE ${setClause}`;
    await conn.query(sql, flat);
    total += chunk.length;
  }
  return total;
}

export default { pool, query, runScript, upsert, resetPool, isConfigured };
