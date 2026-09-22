// BUG-012 fix: persists background-job status (Wati/Meta sync, conversation
// analyze batches) to ads_job_state so a server restart never silently
// reports a stale "idle" for a job that was actually interrupted mid-run.
import { query } from "../db.js";

export async function loadJobState(jobName) {
  const rows = await query("select state_json from ads_job_state where job_name = ?", [jobName]);
  if (!rows.length) return null;
  const raw = rows[0].state_json;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export async function saveJobState(jobName, state) {
  await query(
    `insert into ads_job_state (job_name, state_json) values (?, ?) on duplicate key update state_json = values(state_json)`,
    [jobName, JSON.stringify(state)]
  );
}

/** A restart definitely interrupted any job that was still "running" when the
 *  process died — surface that as an explicit error instead of pretending it
 *  never started. */
export function correctInterrupted(state) {
  if (!state || state.state !== "running") return state;
  return { ...state, state: "error", error: "الخادم أعيد تشغيله أثناء العملية", finishedAt: state.finishedAt || Date.now() };
}
