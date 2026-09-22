// Public, UNAUTHENTICATED wall-display endpoint for the sales-floor leaderboard.
// Gated by a shareable kiosk token (ads_settings.salesboard_token) compared in
// constant time. Returns the SAME leaderboard payload as the authed route but
// nothing else — no other data is reachable through this path. The token can be
// rotated from the admin page to invalidate an old link. Note: the board shows
// employee names + aggregate counts only (no phone numbers / customer PII).
import { Router } from "express";
import { wrap } from "../lib/wrap.js";
import { timingSafeEqual } from "crypto";
import { query } from "../db.js";
import { gatherSalesboard } from "../lib/salesboard.js";
import { gatherQualityBoard } from "../lib/qualityBoard.js";

const router = Router();

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || "")), bb = Buffer.from(String(b || ""));
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

async function checkToken(req, res) {
  const r = await query("select v from ads_settings where k='salesboard_token'");
  const stored = r.length ? r[0].v : null;
  if (!stored || !safeEqual(req.query.token, stored)) {
    res.status(401).json({ error: "invalid or missing token" });
    return false;
  }
  return true;
}

router.get("/salesboard", wrap(async (req, res) => {
  if (!(await checkToken(req, res))) return;
  try { res.json(await gatherSalesboard({ days: Number(req.query.days) || 7 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
}));

/**
 * The quality board, for the wall screen. Same token, but the payload is
 * SANITIZED: the public screen gets ranks, scores and issue COUNTS, never the
 * evidence, the violating message or which conversation it came from. Those live
 * behind the authenticated management route — a compliance quote on a screen the
 * whole floor can read would be a disciplinary notice, not a motivator.
 */
router.get("/quality", wrap(async (req, res) => {
  if (!(await checkToken(req, res))) return;
  try {
    const board = await gatherQualityBoard({ days: Number(req.query.days) || 7 });
    res.json(publicView(board));
  } catch (e) { res.status(500).json({ error: e.message }); }
}));

const PUBLIC_ROW_FIELDS = [
  "rank", "name", "leads", "contacted", "not_contacted", "interested", "qualified",
  // convertible/ghosted are the conversion denominator and the leads excluded
  // from it — plain counts, no customer detail, and the screen reads wrong
  // without them: it would divide by the old denominator.
  "convertible", "ghosted",
  "next_step", "contact_rate_pct", "productivity", "persuasion", "compliance",
  "conversion", "response", "overall", "provisional", "confidence", "sample_size",
  "eligible", "delta_overall", "median_response_min", "within_sla", "sla_answerable",
];

/** Whitelist, not blacklist: a field added to the board later cannot leak onto
 *  the public screen by being forgotten here. */
export function publicView(board) {
  const pick = (r) => {
    if (!r) return null;
    const out = {};
    for (const k of PUBLIC_ROW_FIELDS) if (r[k] !== undefined) out[k] = r[k];
    // severity counts only — no types, no quotes, no wa_ids
    out.risk = { critical: r.risk?.critical || 0, major: r.risk?.major || 0, moderate: r.risk?.moderate || 0 };
    return out;
  };
  return {
    window: board.window, days: board.days, coverage: board.coverage,
    target_compliance: board.thresholds.minCompliance,
    min_sample: board.thresholds.minSample,
    totals: board.totals, daily: board.daily,
    rows: board.rows.map(pick),
    highlights: {
      top_performer: pick(board.highlights.top_performer),
      best_persuasion: pick(board.highlights.best_persuasion),
      best_conversion: pick(board.highlights.best_conversion),
      most_improved: pick(board.highlights.most_improved),
    },
    generatedAt: board.generatedAt,
  };
}

export default router;
