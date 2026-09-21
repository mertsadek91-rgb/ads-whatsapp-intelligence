// MySQL access layer (port of the Python mdb.py). Tables live in the connection
// DB prefixed `ads_`. Provides query() and a batched upsert() using
// INSERT ... AS new ON DUPLICATE KEY UPDATE.
import mysql from "mysql2/promise";
import config from "./config.js";

let _pool = null;

export function pool() {
  if (!_pool) {
    _pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      charset: "utf8mb4",
      waitForConnections: true,
      connectionLimit: 8,
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
  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
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
 * conflictCols are the PK/unique cols. coalesceCols keep the existing value when
 * the incoming value is NULL (used by incremental runs).
 */
export async function upsert(table, cols, rows, conflictCols, { coalesceCols = [], batch = 500 } = {}) {
  if (!rows.length) return 0;
  // dedup within the call by conflict key (keep last)
  const keyIdx = conflictCols.map((c) => cols.indexOf(c));
  const seen = new Map();
  for (const r of rows) seen.set(keyIdx.map((i) => r[i]).join(""), r);
  const deduped = [...seen.values()];

  const updateCols = cols.filter((c) => !conflictCols.includes(c));
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

export default { pool, query, runScript, upsert };
