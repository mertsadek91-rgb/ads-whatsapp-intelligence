// Sales-floor leaderboard — authed endpoints: fetch the board data for the
// in-app view, and manage the SHORT, STABLE kiosk code used by the public
// wall-display link (/tv/<code>). The code is stored once and never changes on
// its own — the owner picks an easy one to type on the TV.
import { Router } from "express";
import { randomBytes } from "crypto";
import { query } from "../db.js";
import { gatherSalesboard } from "../lib/salesboard.js";
import { gatherQualityBoard, pendingEvaluation, scanWindow } from "../lib/qualityBoard.js";
import { evaluateBacklog, isEvaluating } from "../jobs/evaluateBacklog.js";
import { policyVersion as activePolicyVersion } from "../lib/businessProfile.js";
import { budgetRemaining } from "../lib/deepseek.js";

const router = Router();
const shortCode = () => randomBytes(4).toString("hex"); // 8 chars
const CODE_RE = /^[A-Za-z0-9_-]{3,40}$/;

async function getCode() {
  const r = await query("select v from ads_settings where k='salesboard_token'");
  return r.length && r[0].v ? r[0].v : null;
}
async function setCode(code) {
  await query(
    "insert into ads_settings (k, v) values ('salesboard_token', ?) as new on duplicate key update v=new.v",
    [code]);
}
const linkFor = (code) => `/tv/${code}`;

router.get("/", async (req, res) => {
  try { res.json(await gatherSalesboard({ days: Number(req.query.days) || 7 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * The quality board, authenticated — the management view. Unlike the public
 * token route this keeps the full payload: score components, ineligibility
 * reasons and per-severity issue counts.
 */
router.get("/quality", async (req, res) => {
  try { res.json(await gatherQualityBoard({ days: Number(req.query.days) || 7 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/** The evaluation coverage + backlog size, so the owner can see how much of the
 *  window has actually been scored before reading the scores. */
router.get("/quality/status", async (req, res) => {
  try {
    const q = req.query;
    const since = /^\d{4}-\d{2}-\d{2}$/.test(q.since || "") ? q.since : null;
    const until = /^\d{4}-\d{2}-\d{2}$/.test(q.until || "") ? q.until : null;
    const days = Number(q.days) || 30;
    const window = scanWindow({ since, until, days });
    const pending = await pendingEvaluation({ since, until, days, limit: 2000 });
    res.json({
      policy_version: activePolicyVersion(), window, backfill_days: days,
      pending: pending.length, running: isEvaluating(),
      budget_remaining_usd: await budgetRemaining().catch(() => null),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Run the 30-day evaluation backfill. Fire-and-forget: it shares the DeepSeek
 * daily budget with the live analysis and stops cleanly when that runs out, so
 * the caller gets an immediate ack and watches /quality/status.
 */
router.post("/quality/backfill", (req, res) => {
  if (isEvaluating()) return res.status(409).json({ error: "التقييم قيد التشغيل بالفعل" });
  const b = req.body || {};
  // An explicit since/until points the evaluator at ONE period — "re-check last
  // March" — instead of only ever the trailing N days.
  const since = /^\d{4}-\d{2}-\d{2}$/.test(b.since || "") ? b.since : null;
  const until = /^\d{4}-\d{2}-\d{2}$/.test(b.until || "") ? b.until : null;
  const days = Math.min(Math.max(Number(b.days) || 30, 1), 730);
  const limit = Math.min(Math.max(Number(b.limit) || 200, 1), 2000);
  const window = scanWindow({ since, until, days });
  res.json({ started: true, window, limit });
  evaluateBacklog({ since, until, days, limit })
    .then((r) => console.log("[salesboard] quality backfill done:", JSON.stringify(r)))
    .catch((e) => console.error("[salesboard] quality backfill failed:", e.message));
});

// Current kiosk code + shareable short path (auto-creates a short one on first
// read so there's always a working link).
router.get("/token", async (req, res) => {
  let code = await getCode();
  if (!code) { code = shortCode(); await setCode(code); }
  res.json({ token: code, code, path: linkFor(code) });
});

// Set a CUSTOM easy-to-type code (stays fixed until changed again).
router.post("/code", async (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (!CODE_RE.test(code)) return res.status(400).json({ error: "الرمز: 3–40 حرفاً/رقماً (إنجليزية، بدون فراغات)، يُسمح - و _" });
  await setCode(code);
  res.json({ token: code, code, path: linkFor(code) });
});

// Generate a fresh random short code (invalidates the old link).
router.post("/token/rotate", async (req, res) => {
  const code = shortCode();
  await setCode(code);
  res.json({ token: code, code, path: linkFor(code) });
});

export default router;
