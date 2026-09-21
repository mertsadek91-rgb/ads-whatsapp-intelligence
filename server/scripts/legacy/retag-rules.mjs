// Recomputes the RULE tags for every already-tagged conversation. No AI, no
// cost — run this after any change to tagRules.js or to the country map.
//
//   node scripts/retag-rules.mjs
//
// Safe to run at any time, including while an AI tagging pass is in flight:
// saveTags() only ever deletes rule tags that no longer apply, and this pass
// produces no AI tags, so nothing the model wrote is touched and no reviewer's
// confirm or reject is disturbed.
import { query } from "../src/db.js";
import { tagConversation, saveTags } from "../src/lib/tagAssign.js";

const ids = (await query("select wa_id from ads_conversation_tag_run order by tagged_at")).map((r) => r.wa_id);
console.log(`recomputing rule tags for ${ids.length} conversations (free — no AI)\n`);

let done = 0, changed = 0, failed = 0;
const before = new Map();
for (const r of await query("select wa_id, count(*) n from ads_conversation_tag where source='rule' group by wa_id")) {
  before.set(r.wa_id, Number(r.n));
}

for (const waId of ids) {
  try {
    // useAi:false keeps this free; saveTags leaves the AI rows exactly as they are.
    const r = await tagConversation(waId, { useAi: false });
    await saveTags({ ...r, ai: [] });
    if (r.rule.length !== (before.get(waId) || 0)) changed++;
  } catch (e) {
    failed++;
    if (failed <= 5) console.log(`FAIL ${waId}: ${e.message}`);
  }
  if (++done % 100 === 0) console.log(`[${done}/${ids.length}] ${changed} changed, ${failed} failed`);
}

console.log(`\ndone · ${done} scanned · ${changed} with a different rule-tag count · ${failed} failed`);
const geo = await query(
  `select tag, count(*) n from ads_conversation_tag where tag like 'GEO\\_%' and tag not like 'GEO\\_R\\_%'
   group by tag order by n desc limit 15`);
console.log("top country tags:", geo.map((g) => `${g.tag}=${g.n}`).join(" "));
process.exit(0);
