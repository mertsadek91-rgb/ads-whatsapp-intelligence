// Lead scoring + stage normalization — literal port of score.py.

export const STAGE_MAP = {
  "new lead": "new", new: "new", lead: "new",
  contacted: "engaged", engaged: "engaged", "in progress": "engaged", open: "engaged",
  interested: "interested", serious: "interested", hot: "interested",
  qualified: "qualified", demo: "demo", "demo account": "demo",
  deposit: "deposit", deposited: "deposit", customer: "deposit", funded: "deposit",
  won: "deposit", client: "deposit",
  // Wati's actual sales-pipeline lead_stage values (observed live, not covered
  // above because the raw string is multi-word, e.g. "Deal Won" != "won").
  // Bug found writing REG-106 tests: every real "Deal Won" contact (converted
  // customers) was silently falling through to "new" (weight 5, band cold).
  "deal won": "deposit",
  "proposal sent": "interested",
  // "Deal Lost" has no dedicated weight tier (full lost-lead taxonomy is a
  // future scoring redesign — planning/14 §3). "engaged" avoids the worse
  // misrepresentation of implying the lead is still fresh/untouched.
  "deal lost": "engaged",
};

export function normalizeStage(leadStage, tags = []) {
  const s = (leadStage || "").trim().toLowerCase();
  if (STAGE_MAP[s]) return STAGE_MAP[s];
  for (const t of tags || []) {
    const tl = String(t).trim().toLowerCase();
    if (STAGE_MAP[tl]) return STAGE_MAP[tl];
  }
  return "new";
}

const STAGE_WEIGHT = { deposit: 50, qualified: 35, interested: 30, demo: 25, engaged: 15, new: 5 };

// Philosophy: answering the automated BOT is a weak signal (the customer just
// taps quick replies). Real value is human sales/support engagement AFTER the bot.
// A lead that replied to the bot but got NO human follow-up is a MISSED opportunity,
// not a hot lead, so its score is capped low.
export function scoreContact(c) {
  let pts = 0;
  const why = [];
  const stage = c.stage || "new";
  const sw = STAGE_WEIGHT[stage] ?? 5;
  pts += sw; why.push(`stage=${stage}(+${sw})`);
  if (c.deposit_flag) { pts += 20; why.push("deposited(+20)"); }

  // Do we know the bot/human split (from conversation sync)?
  const knowSplit = c.human_replied != null || c.agent_msgs != null;
  const humanMsgs = parseInt(c.agent_msgs || 0, 10);
  const custMsgs = parseInt(c.customer_msgs || 0, 10);

  if (knowSplit) {
    if (humanMsgs > 0) {
      pts += 15; why.push("human-engaged(+15)");
      const d = Math.min(custMsgs, 8) * 1.5; // substantive dialogue WITH a human
      if (d) { pts += d; why.push(`human-dialogue(+${d})`); }
    } else {
      const b = Math.min(custMsgs, 5); // replied to bot only — weak value
      if (b) { pts += b; why.push(`bot-only-replies(+${b})`); }
    }
  } else {
    // ingest-time fallback (no split yet): keep it modest
    if (c.is_answered) { pts += 4; why.push("answered(+4)"); }
    const n = Math.min(parseInt(c.num_messages || 0, 10), 8);
    if (n) { pts += n; why.push(`msgs(+${n})`); }
  }

  if (c.source_ad_id) { pts += 3; why.push("attributed(+3)"); }
  if (c.created_at instanceof Date && !isNaN(c.created_at)) {
    const age = (Date.now() - c.created_at.getTime()) / 86400000;
    if (age <= 7) { pts += 5; why.push("recent(+5)"); }
  }

  // Cap: replied to bot but no human follow-up → not a validated lead.
  if (knowSplit && humanMsgs === 0 && !c.deposit_flag) {
    if (pts > 40) { pts = 40; why.push("cap:no-human-followup(≤40)"); }
  }

  pts = Math.max(0, Math.min(100, Math.round(pts)));
  const band = pts >= 70 ? "hot" : pts >= 45 ? "warm" : "cold";
  return { score: pts, band, reasons: why.join(", ") };
}

export default { STAGE_MAP, normalizeStage, scoreContact };
