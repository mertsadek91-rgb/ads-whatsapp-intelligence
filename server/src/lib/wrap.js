// Shared async route wrapper. Persists the failure to ads_error_logs
// (BUG-017 slice 2) and answers 500 — unless headers already went out
// (a streamed export failing mid-write, BUG-040), where it just ends.
import { logError } from "./errorLog.js";

export const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  logError(req, e);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: e.message });
});

export default wrap;
