// Runs the customer-tag pass to completion, one line per conversation so a long
// run can be followed and resumed.
//
//   node scripts/tag-conversations.mjs                        # last 30 days
//   node scripts/tag-conversations.mjs 365 500                # last 365 days, cap 500
//   node scripts/tag-conversations.mjs 2026-03-01 2026-03-31  # one specific period
//
// Safe to interrupt and re-run: pendingTagging() only returns conversations with
// no tagging run for the current TAG_VERSION, so a second run picks up where
// this one stopped. Shares the DeepSeek daily budget with the live analysis and
// stops cleanly when it runs out.
import { tagBacklog, pendingTagging } from "../src/jobs/tagBacklog.js";
import { TAG_VERSION } from "../src/lib/tagAssign.js";
import { scanWindow } from "../src/lib/qualityBoard.js";
import { budgetRemaining } from "../src/lib/deepseek.js";
import config from "../src/config.js";

const a2 = process.argv[2], a3 = process.argv[3];
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const since = isYmd(a2) ? a2 : null;
const until = isYmd(a2) ? (isYmd(a3) ? a3 : null) : null;
const days = isYmd(a2) ? 30 : (Number(a2) || 30);
const cap = Number(isYmd(a2) ? process.argv[4] : a3) || 5000;

const started = Date.now();
const w = scanWindow({ since, until, days });
const pending = await pendingTagging({ since, until, days, limit: cap });
const budget0 = await budgetRemaining();

console.log(`tagging · model=${config.deepseek.model} · version=${TAG_VERSION} · window=${w.since} → ${w.until}`);
console.log(`pending=${pending.length} · budget=${budget0 == null ? "no guard" : "$" + budget0.toFixed(2)}`);
console.log(`estimate ~${Math.round((pending.length * 9) / 60)} min · ~$${(pending.length * 0.0015).toFixed(2)}\n`);

const t0 = Date.now();
const result = await tagBacklog({
  since, until, days, limit: cap, throttleMs: 120,
  onProgress: ({ done, total, tagged, failed, ok, wrote, waId, error }) => {
    const elapsed = (Date.now() - t0) / 1000;
    const rate = done ? elapsed / done : 0;
    const eta = Math.round(((total - done) * rate) / 60);
    console.log(
      `[${String(done).padStart(4)}/${total}] ${ok ? "ok  " : "FAIL"} ${waId}`
      + ` · ${wrote} tags · ${tagged} tagged, ${failed} failed`
      + ` · ${rate.toFixed(1)}s/conv · ETA ~${eta}m`
      + (error ? ` · ${error}` : ""));
  },
});

const budget1 = await budgetRemaining();
console.log(`\ndone in ${Math.round((Date.now() - started) / 60000)} min`);
console.log(JSON.stringify({ ...result, errors: result.errors.slice(0, 5) }, null, 1));
console.log(`spent this run: $${budget0 != null && budget1 != null ? (budget0 - budget1).toFixed(2) : "?"}`);
if (result.budgetStopped) {
  const left = await pendingTagging({ since, until, days, limit: cap });
  console.log(`STOPPED ON BUDGET — ${left.length} still pending. Re-run tomorrow to continue.`);
}
process.exit(0);
