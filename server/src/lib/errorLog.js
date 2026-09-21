// BUG-017 slice 2: persist server-side route errors to ads_error_logs so an
// operator can see what actually failed after the fact (console output is
// gone once the container restarts). Fire-and-forget — logging must never
// break the request it's reporting on.
import { query } from "../db.js";

export function logError(req, err) {
  query(
    "insert into ads_error_logs (method, path, message, stack, user_email) values (?,?,?,?,?)",
    [
      req?.method || null,
      String(req?.originalUrl || "").split("?")[0].slice(0, 255) || null,
      String(err?.message || err).slice(0, 1000),
      String(err?.stack || "").slice(0, 4000) || null,
      req?.session?.email || null,
    ]
  ).catch((e) => console.error("[errorLog] insert failed:", e.message));
}

/** Daily retention: both log tables are high-volume and only useful recent. */
export async function cleanupLogs(days = 90) {
  const r1 = await query(`delete from ads_api_logs where created_at < (now() - interval ${Number(days) || 90} day)`);
  const r2 = await query(`delete from ads_error_logs where created_at < (now() - interval ${Number(days) || 90} day)`);
  return { api_logs: r1?.affectedRows ?? 0, error_logs: r2?.affectedRows ?? 0 };
}

export default { logError, cleanupLogs };
