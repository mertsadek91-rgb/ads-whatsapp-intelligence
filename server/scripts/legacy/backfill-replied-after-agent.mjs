// Fills ads_conversation_meta.replied_after_agent for conversations whose
// thread we already stored. Free — no AI, no Wati calls.
//
//   node scripts/backfill-replied-after-agent.mjs
//
// The flag is computed from message ORDER, so it can only be derived from a
// real thread. Conversations with no stored snapshot keep the default 0 and are
// reported at the end: they are excluded from the conversion denominator until
// their next analysis fills the thread in, which is the safe direction — it
// never invents engagement that was not observed.
import { query } from "../src/db.js";
import { computeMeta } from "../src/lib/conversationMeta.js";

const rows = await query(
  `select a.wa_id, a.thread_snapshot
   from ads_conversation_analysis a
   join ads_conversation_meta m on m.wa_id = a.wa_id
   where a.thread_snapshot is not null and json_length(a.thread_snapshot) > 0`);

console.log(`recomputing engagement for ${rows.length} stored threads (free — no AI)\n`);

let done = 0, replied = 0, failed = 0;
for (const r of rows) {
  try {
    const thread = typeof r.thread_snapshot === "string" ? JSON.parse(r.thread_snapshot) : r.thread_snapshot;
    const m = computeMeta(thread || []);
    await query("update ads_conversation_meta set replied_after_agent=? where wa_id=?", [m.replied_after_agent, r.wa_id]);
    if (m.replied_after_agent) replied++;
  } catch (e) {
    failed++;
    if (failed <= 5) console.log(`FAIL ${r.wa_id}: ${e.message}`);
  }
  if (++done % 250 === 0) console.log(`[${done}/${rows.length}] ${replied} engaged, ${failed} failed`);
}

const [gap] = await query(
  `select count(*) n from ads_conversation_meta m
   left join ads_conversation_analysis a on a.wa_id = m.wa_id and a.thread_snapshot is not null
   where m.human_replied = 1 and a.wa_id is null`);

console.log(`\ndone · ${done} threads · ${replied} where the customer replied after the employee · ${failed} failed`);
console.log(`no stored thread yet (flag stays 0 until next analysis): ${gap.n}`);
process.exit(0);
