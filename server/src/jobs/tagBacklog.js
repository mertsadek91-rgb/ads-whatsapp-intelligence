// Tag conversations in bulk — the same shape as the evaluation backfill, and
// deliberately so: one period window, resumable, budget-aware, progress per
// conversation.
//
// It reads the THREAD WE ALREADY STORED (thread_snapshot) rather than re-fetching
// from Wati. That is not just cheaper: Wati's API is not guaranteed to return
// the same history forever, so tagging the stored snapshot means the tag and the
// evidence quote always refer to the same text a reviewer will see.
import { query } from "../db.js";
import { tagConversation, saveTags, TAG_VERSION } from "../lib/tagAssign.js";
import { scanWindow } from "../lib/qualityBoard.js";
import { budgetRemaining } from "../lib/deepseek.js";
import config from "../config.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = false;
export const isTagging = () => running;

/**
 * Conversations in the window with a usable stored thread and no tagging for the
 * current version. `>= 3` messages because a two-message thread has nothing to
 * profile — tagging it would spend budget to learn nothing.
 */
export async function pendingTagging({
  days = 30, since = null, until = null, limit = 500, version = TAG_VERSION, now = new Date(),
} = {}) {
  const w = scanWindow({ since, until, days, now });
  const rows = await query(
    `select c.wa_id
     from ads_wati_contacts c
     join ads_conversation_analysis a on a.wa_id = c.wa_id
     left join ads_conversation_tag_run r on r.wa_id = c.wa_id and r.tag_version = ?
     where c.created_date >= ? and c.created_date <= ?
       and a.thread_snapshot is not null and json_length(a.thread_snapshot) >= 3
       and r.wa_id is null
     order by c.last_message_at desc
     limit ${Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000)}`,
    [version, w.since, w.until]);
  return rows.map((r) => r.wa_id);
}

/**
 * @returns { window, scanned, tagged, failed, tags_written, dropped, budgetStopped, errors }
 */
export async function tagBacklog({
  days = 30, since = null, until = null, limit = 500, throttleMs = 300,
  now = new Date(), onProgress = null,
} = {}) {
  if (running) return { skipped: true, reason: "already_running" };
  running = true;
  const started = Date.now();
  const window = scanWindow({ since, until, days, now });
  const result = {
    tag_version: TAG_VERSION, window, scanned: 0, tagged: 0, failed: 0,
    tags_written: 0, dropped: 0, budgetStopped: false, errors: [],
  };

  try {
    const ids = await pendingTagging({ since: window.since, until: window.until, limit, now });
    result.scanned = ids.length;

    for (const waId of ids) {
      // Stop cleanly on budget instead of letting every remaining call throw —
      // the run resumes from where it stopped, because pendingTagging() only
      // ever returns conversations with no run row for this version.
      const left = await budgetRemaining().catch(() => null);
      if (left != null && left <= 0) { result.budgetStopped = true; break; }

      let ok = false, err = null, wrote = 0;
      try {
        const r = await tagConversation(waId, { now });
        wrote = await saveTags(r, { model: config.deepseek.model });
        result.tags_written += wrote;
        result.dropped += r.dropped.length;
        result.tagged++;
        ok = true;
      } catch (e) {
        result.failed++;
        err = e.message;
        if (result.errors.length < 10) result.errors.push(`${waId}: ${e.message}`);
        if (/budget|quota|insufficient/i.test(e.message)) result.budgetStopped = true;
      }
      if (onProgress) {
        try {
          await onProgress({
            waId, ok, error: err, wrote, done: result.tagged + result.failed,
            total: ids.length, tagged: result.tagged, failed: result.failed,
          });
        } catch { /* a reporting failure must never abort the run */ }
      }
      if (result.budgetStopped) break;
      if (throttleMs) await sleep(throttleMs);
    }
  } finally {
    running = false;
  }
  result.ms = Date.now() - started;
  return result;
}

export default { tagBacklog, pendingTagging, isTagging };
