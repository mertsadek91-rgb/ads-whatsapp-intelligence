// Emergency, on-demand refresh of the data behind the two wall boards.
//
// The automatic path (quickSync, every 30 min) is deliberately capped: it
// re-reads at most 600 recently-active conversations and skips the rest. That is
// the right trade for a background tick, but it means a conversation can sit up
// to two days stale — and when the sales manager is standing in front of the
// board arguing about whether a customer was contacted, "up to two days stale"
// is not good enough.
//
// So this does what quickSync will not: re-read EVERY conversation in the board's
// own window, uncapped, right now.
//
// It deliberately does NOT run the AI. Scoring costs money and minutes; this is
// for the question "is the contact data current?", which is free to answer. The
// AI passes have their own buttons.
//
// The result reports what CHANGED, not just that it ran. An emergency refresh
// whose answer is "nothing moved, the board was already right" is exactly as
// useful as one that finds three missed replies — but only if it says so.
import { query } from "../db.js";
import { ingestWati } from "../ingest/ingestWati.js";
import * as cmeta from "../lib/conversationMeta.js";
import { snapshotContactStatus, gatherContactStatus } from "../lib/contactStatus.js";
import { dubaiYmd } from "../lib/weeklyReports.js";

let running = false;
export const isBoardRefreshing = () => running;

const addDays = (ymd, n) => {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * @param {object} o - { days=7, hours=6, concurrency=4, now }
 * @returns a summary including how many leads flipped to "contacted"
 */
export async function refreshBoards({ days = 7, hours = 6, concurrency = 4, now = new Date() } = {}) {
  if (running) return { skipped: true, reason: "already_running" };
  running = true;
  const started = Date.now();
  const today = dubaiYmd(now);
  const since = addDays(today, -(Math.min(Math.max(parseInt(days, 10) || 7, 1), 90) - 1));
  const out = {
    window: { since, until: today }, stages: {},
    contacts_updated: 0, conversations_reread: 0, reread_failed: 0,
    // The number the argument is actually about.
    flipped_to_contacted: 0, flipped_ids: [],
    before: null, after: null, errors: [],
  };

  try {
    // Snapshot the contact picture BEFORE touching anything, so the effect of
    // this refresh is measurable rather than asserted.
    const pre = await gatherContactStatus(since, today, { now });
    const preContacted = new Set(pre.leads.filter((l) => l.contacted).map((l) => l.wa_id));
    out.before = { leads: pre.leads.length, contacted: preContacted.size };

    // 1. Pull anything new from Wati's contact list.
    try {
      const w = await ingestWati({ incremental: true, hours: Math.min(Math.max(parseInt(hours, 10) || 6, 1), 72), messages: true });
      out.contacts_updated = w.kept ?? w.updated ?? 0;
      out.stages.wati = "ok";
    } catch (e) {
      out.stages.wati = "ERR: " + e.message;
      out.errors.push("wati: " + e.message);
    }

    // 2. Re-read every conversation in the window. This is the uncapped part —
    //    it is why the button exists.
    const ids = (await query(
      `select wa_id from ads_wati_contacts
       where created_date >= ? and created_date <= ? and num_messages > 0
       order by last_message_at desc`, [since, today])).map((r) => r.wa_id);

    let i = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try {
          const r = await cmeta.syncOne(id);
          // A failed Wati fetch returns partial:true and keeps the stored row —
          // counting it as re-read would overstate how fresh the board now is.
          if (r?.partial) out.reread_failed++; else out.conversations_reread++;
        } catch { out.reread_failed++; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(parseInt(concurrency, 10) || 4, 1), 8) }, worker));
    out.stages.conversations = "ok";

    // 3. Re-persist the follow-up snapshot the reports read from.
    try {
      const s = await snapshotContactStatus({ now });
      out.stages.followup_snapshot = s.snapshotted ?? "ok";
    } catch (e) {
      out.stages.followup_snapshot = "ERR: " + e.message;
      out.errors.push("snapshot: " + e.message);
    }

    // 4. Measure the effect.
    const post = await gatherContactStatus(since, today, { now });
    const postContacted = post.leads.filter((l) => l.contacted);
    out.after = { leads: post.leads.length, contacted: postContacted.length };
    for (const l of postContacted) {
      if (!preContacted.has(l.wa_id)) {
        out.flipped_to_contacted++;
        if (out.flipped_ids.length < 25) out.flipped_ids.push(l.wa_id);
      }
    }

    await query(
      `insert into ads_report_runs (run_date, summary) values (?, ?)
       as new on duplicate key update built_at=now(), summary=new.summary`,
      [today, "board-refresh: " + JSON.stringify({
        window: out.window, contacts_updated: out.contacts_updated,
        conversations_reread: out.conversations_reread, reread_failed: out.reread_failed,
        flipped_to_contacted: out.flipped_to_contacted,
      }).slice(0, 950)]).catch(() => {});
  } finally {
    running = false;
  }
  out.ms = Date.now() - started;
  return out;
}

export default { refreshBoards, isBoardRefreshing };
