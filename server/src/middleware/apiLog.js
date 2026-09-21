// BUG-017 fix: minimal API audit trail — who called what, when, how long,
// and with what result. Fire-and-forget (never blocks or fails the request).
import { query } from "../db.js";

// Polled every 2.5s while a job runs — logging these would drown the table
// for near-zero audit value (they're read-only status checks, not actions).
const SKIP_PATHS = new Set(["/api/admin/status", "/api/conversations/jobs-status"]);

export function apiLog(req, res, next) {
  const start = Date.now();
  // Captured up front, not inside the finish handler: by the time "finish"
  // fires, Express has already stripped this middleware's own "/api" mount
  // prefix from req.path/req.url (each app.use(prefix, ...) further down the
  // stack does the same for its own prefix) — req.originalUrl is the only
  // property Express guarantees is never rewritten by mount-point routing.
  const method = req.method;
  const path = req.originalUrl.split("?")[0];
  res.on("finish", () => {
    if (SKIP_PATHS.has(path)) return;
    query(
      "insert into ads_api_logs (method, path, status, user_email, duration_ms, ip) values (?,?,?,?,?,?)",
      [method, path, res.statusCode, req.session?.email || null, Date.now() - start, req.ip]
    ).catch((e) => console.error("[apiLog] insert failed:", e.message));
  });
  next();
}

export default apiLog;
