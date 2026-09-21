// Cheap (no-AI) conversation classification + engagement metrics.
import * as wati from "./wati.js";
import { scoreContact } from "./score.js";
import { query } from "../db.js";

const isBot = (s) => String(s || "").trim().toLowerCase() === "bot";

export function computeMeta(thread) {
  let customer = 0, agent = 0, bot = 0;
  let firstCustomerTs = null, firstHumanReplyMin = null;
  // Did the customer say anything AFTER a human employee replied?
  //
  // Read from the message ORDER, not from the counts: a customer who sends "hi"
  // then "hello?" before anyone answers has two messages and has still never
  // responded to us. That distinction decides whether the employee ever got a
  // conversation to work with, so it must not be approximated.
  let sawHumanReply = false, repliedAfterAgent = false;
  for (const m of thread) {
    if (m.dir === "in") {
      customer++;
      if (sawHumanReply) repliedAfterAgent = true;
      if (!firstCustomerTs) firstCustomerTs = m.ts;
    } else {
      if (isBot(m.sender)) bot++;
      else {
        agent++;
        sawHumanReply = true;
        if (firstCustomerTs && firstHumanReplyMin == null && m.ts) {
          const g = (new Date(m.ts) - new Date(firstCustomerTs)) / 60000;
          if (g >= 0) firstHumanReplyMin = Math.round(g * 10) / 10;
        }
      }
    }
  }
  const last = thread[thread.length - 1] || null;
  const lastDir = last ? last.dir : null;
  const humanReplied = agent > 0;
  let convType;
  if (customer === 0) convType = "no_customer";
  else if (humanReplied) convType = "human_handled";
  else if (lastDir === "in") convType = "awaiting_human";  // customer waiting, no human ever
  else convType = "bot_only";
  return {
    msg_total: thread.length, customer_msgs: customer, agent_msgs: agent, bot_msgs: bot,
    human_replied: humanReplied ? 1 : 0, conv_type: convType, last_dir: lastDir,
    replied_after_agent: repliedAfterAgent ? 1 : 0,
    first_human_response_min: firstHumanReplyMin, last_activity: last ? last.ts : null,
  };
}

const COLS = ["wa_id", "msg_total", "customer_msgs", "agent_msgs", "bot_msgs", "human_replied",
  "conv_type", "last_dir", "replied_after_agent", "first_human_response_min", "last_activity"];

export async function syncOne(waId, thread) {
  if (!thread) {
    const r = await query("select business_channel from ads_wati_contacts where wa_id = ?", [waId]);
    thread = await wati.getThread(waId, r.length ? r[0].business_channel || null : null);
  }
  // BUG-026 fix: a FAILED fetch used to look exactly like an empty thread and
  // would overwrite a real conversation's stored classification with
  // no_customer/0 messages. On failure, keep whatever is stored and report
  // partial instead of persisting wrong emptiness.
  if (thread.failed) {
    const existing = await getMeta(waId);
    return { wa_id: waId, ...(existing || computeMeta([])), thread, partial: true };
  }
  const m = computeMeta(thread);
  const la = m.last_activity ? new Date(m.last_activity).toISOString().slice(0, 19).replace("T", " ") : null;
  await query(
    `insert into ads_conversation_meta (${COLS.join(",")}) values (?,?,?,?,?,?,?,?,?,?,?)
     as new on duplicate key update msg_total=new.msg_total, customer_msgs=new.customer_msgs,
       agent_msgs=new.agent_msgs, bot_msgs=new.bot_msgs, human_replied=new.human_replied,
       conv_type=new.conv_type, last_dir=new.last_dir, replied_after_agent=new.replied_after_agent,
       first_human_response_min=new.first_human_response_min, last_activity=new.last_activity, synced_at=now()`,
    [waId, m.msg_total, m.customer_msgs, m.agent_msgs, m.bot_msgs, m.human_replied,
     m.conv_type, m.last_dir, m.replied_after_agent, m.first_human_response_min, la]
  );
  // recompute lead_score using the REAL bot/human split (post-bot engagement matters)
  const [ct] = await query(
    "select stage, deposit_flag, source_ad_id, created_at from ads_wati_contacts where wa_id=?", [waId]);
  let sc = null;
  if (ct) {
    sc = scoreContact({
      stage: ct.stage, deposit_flag: !!ct.deposit_flag, source_ad_id: ct.source_ad_id,
      created_at: ct.created_at ? new Date(ct.created_at) : null,
      human_replied: m.human_replied, agent_msgs: m.agent_msgs, customer_msgs: m.customer_msgs,
    });
  }
  // enrich the contact record so the conversations list reflects real activity + score
  await query(
    `update ads_wati_contacts set num_messages=?, last_message_at=coalesce(?, last_message_at),
        lead_score=coalesce(?, lead_score), score_band=coalesce(?, score_band), score_reasons=coalesce(?, score_reasons)
     where wa_id=?`,
    [m.msg_total, la, sc ? sc.score : null, sc ? sc.band : null, sc ? sc.reasons : null, waId]
  );
  return { wa_id: waId, ...m, thread, score: sc };
}

export async function getMeta(waId) {
  const r = await query("select * from ads_conversation_meta where wa_id=?", [waId]);
  return r[0] || null;
}

export default { computeMeta, syncOne, getMeta };
