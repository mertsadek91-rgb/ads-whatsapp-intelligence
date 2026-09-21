// Waits for the DeepSeek key's balance to become usable, then runs the tagging
// pass. Written because the dashboard and the API disagreed: the account page
// showed a topped-up balance while /user/balance answered is_available:false for
// the key we actually call with, and every request came back "Insufficient
// Balance".
//
//   node scripts/tag-when-funded.mjs [days] [maxWaitMinutes]
//
// Polls a free endpoint — no tokens, no cost — and starts the moment the answer
// changes. Gives up cleanly after the wait limit rather than spinning forever.
import axios from "axios";
import config from "../src/config.js";
import { tagBacklog, pendingTagging } from "../src/jobs/tagBacklog.js";
import { TAG_VERSION } from "../src/lib/tagAssign.js";

const days = Number(process.argv[2]) || 30;
const maxWaitMin = Number(process.argv[3]) || 45;
const POLL_MS = 120000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function balance() {
  try {
    const r = await axios.get("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${config.deepseek.apiKey}` }, timeout: 20000,
    });
    const info = r.data?.balance_infos?.[0] || {};
    return { available: !!r.data?.is_available, total: info.total_balance, topped: info.topped_up_balance };
  } catch (e) {
    return { available: false, error: e.response?.status || e.message };
  }
}

const deadline = Date.now() + maxWaitMin * 60000;
let b = await balance();
console.log(`start · available=${b.available} · total=${b.total ?? "?"} · pending=${(await pendingTagging({ days, limit: 5000 })).length}`);

while (!b.available && Date.now() < deadline) {
  const leftMin = Math.round((deadline - Date.now()) / 60000);
  console.log(`waiting for balance… (${leftMin} min left before giving up)`);
  await sleep(POLL_MS);
  b = await balance();
}

if (!b.available) {
  console.log(`\nGAVE UP — the key still reports no usable balance after ${maxWaitMin} min.`);
  console.log("Check that the API key in .env belongs to the DeepSeek account that was topped up.");
  process.exit(0);
}

console.log(`\nbalance is live (total=${b.total}) — starting the tagging pass\n`);
const t0 = Date.now();
const result = await tagBacklog({
  days, limit: 5000, throttleMs: 120,
  onProgress: ({ done, total, tagged, failed, ok, wrote, waId, error }) => {
    const rate = done ? (Date.now() - t0) / 1000 / done : 0;
    console.log(
      `[${String(done).padStart(4)}/${total}] ${ok ? "ok  " : "FAIL"} ${waId} · ${wrote} tags`
      + ` · ${tagged} tagged, ${failed} failed · ${rate.toFixed(1)}s/conv`
      + ` · ETA ~${Math.round(((total - done) * rate) / 60)}m` + (error ? ` · ${error}` : ""));
  },
});
console.log(`\n${JSON.stringify({ ...result, errors: result.errors.slice(0, 5) }, null, 1)}`);
console.log(`version=${TAG_VERSION} · still pending: ${(await pendingTagging({ days, limit: 5000 })).length}`);
process.exit(0);
