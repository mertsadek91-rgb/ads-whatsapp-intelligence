// BUG-044 fix: extracted so /api/health's DB-connectivity check (used by the
// Docker HEALTHCHECK) is unit-testable without booting the whole server.
import { query } from "../db.js";

export async function healthCheck() {
  try {
    await query("select 1");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
