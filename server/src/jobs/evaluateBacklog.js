// Backfills the quality/compliance evaluation for conversations that don't have
// one yet, then snapshots the board.
//
// Scoped to the last 30 days by default, and that is a deliberate limit, not an
// oversight: the full history is ~5.4k human-handled conversations, and
// re-evaluating all of it would spend days of AI budget scoring periods nobody
// is being reviewed on. The board only ever displays a rolling window anyway.
//
// Runs sequentially with a small delay — this shares the DeepSeek daily budget
// guard with the live per-conversation analysis, and starving that to fill a
// backlog would be the wrong trade.
import { analyze } from "../lib/conversationAnalysis.js";
import { pendingEvaluation, gatherQualityBoard, saveSnapshot, scanWindow } from "../lib/qualityBoard.js";
import { policyVersion as activePolicyVersion } from "../lib/businessProfile.js";
import { budgetRemaining } from "../lib/deepseek.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = false;
export const isEvaluating = () => running;

/**
 * @param {object} opts - { days=30, limit=200, throttleMs=400, snapshot=true, windowDays=7 }
 * @returns { scanned, evaluated, skipped, failed, budgetStopped, snapshot }
 */
export async function evaluateBacklog({
  days = 30, since = null, until = null, limit = 200, throttleMs = 400,
  snapshot = true, windowDays = 7, now = new Date(), onProgress = null,
} = {}) {
  if (running) return { skipped: true, reason: "already_running" };
  running = true;
  const started = Date.now();
  const window = scanWindow({ since, until, days, now });
  const result = {
    policy_version: activePolicyVersion(), days, window,
    scanned: 0, evaluated: 0, failed: 0,
    budgetStopped: false, errors: [], snapshot: null,
  };

  try {
    const ids = await pendingEvaluation({ since: window.since, until: window.until, limit, now });
    result.scanned = ids.length;

    for (const waId of ids) {
      // Stop cleanly on budget rather than letting every remaining call throw —
      // an interrupted backfill is fine, it resumes from where it stopped next run.
      if (typeof budgetRemaining === "function") {
        const left = await budgetRemaining().catch(() => null);
        if (left != null && left <= 0) { result.budgetStopped = true; break; }
      }
      let ok = false, err = null;
      try {
        const r = await analyze(waId);
        if (r?.evaluation) { result.evaluated++; ok = true; } else result.failed++;
      } catch (e) {
        result.failed++;
        err = e.message;
        if (result.errors.length < 10) result.errors.push(`${waId}: ${e.message}`);
        // A quota/budget error means every subsequent call fails the same way.
        if (/budget|quota|insufficient/i.test(e.message)) { result.budgetStopped = true; }
      }
      // Progress is reported per conversation: a multi-hour run with no
      // visibility is indistinguishable from a hung one.
      if (onProgress) {
        try {
          await onProgress({
            waId, ok, error: err, done: result.evaluated + result.failed,
            total: ids.length, evaluated: result.evaluated, failed: result.failed,
          });
        } catch { /* a reporting failure must never abort the backfill */ }
      }
      if (result.budgetStopped) break;
      if (throttleMs) await sleep(throttleMs);
    }

    if (snapshot) {
      const board = await gatherQualityBoard({ now, days: windowDays });
      result.snapshot = await saveSnapshot(board);
    }
  } finally {
    running = false;
  }
  result.ms = Date.now() - started;
  return result;
}

export default { evaluateBacklog, isEvaluating };
