// Management review of AI compliance findings. Authenticated only — this is the
// side of the feature that holds the evidence, the customer's name and the exact
// employee message, none of which may appear on the wall display.
import { Router } from "express";
import { wrap } from "../lib/wrap.js";
import { langOf } from "../lib/reportI18n.js";
import {
  listIssues, issueContext, reviewIssue, reviewSummary, trainingInsights,
} from "../lib/qualityReview.js";
import { policyVersion as activePolicyVersion, getProfile } from "../lib/businessProfile.js";
import { issueTypes } from "../lib/profileDerived.js";
import { SEVERITIES } from "../lib/profileConstants.js";
import { readCalibration, saveCalibration, gatherQualityBoard } from "../lib/qualityBoard.js";
import { drill } from "../lib/qualityDrill.js";
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from "../lib/qualityScore.js";

const router = Router();

/** Queue header: counts by status/severity + the filter vocabularies. */
router.get("/summary", wrap(async (req, res) => {
  const lang = langOf(req);
  res.json({
    policy_version: activePolicyVersion(),
    ...(await reviewSummary({ days: Number(req.query.days) || 30 })),
    severities: SEVERITIES,
    types: issueTypes(getProfile()).map((t) => ({ key: t.key, label: lang === "en" ? t.en : t.ar, default_severity: t.default_severity })),
    company: (getProfile().identity.facts || []),
  });
}));

router.get("/issues", wrap(async (req, res) => {
  const q = req.query;
  res.json(await listIssues({
    status: q.status || "pending", severity: q.severity || undefined,
    agent: q.agent || undefined, type: q.type || undefined,
    days: q.days ? Number(q.days) : 30,
    limit: q.limit, offset: q.offset, lang: langOf(req),
  }));
}));

/** The stored thread around the flagged message — what the AI actually saw. */
router.get("/issues/:id/context", wrap(async (req, res) => {
  const ctx = await issueContext(req.params.id, { window: Number(req.query.window) || 6 });
  if (!ctx) return res.status(404).json({ error: "not found" });
  res.json(ctx);
}));

/**
 * Record a decision. The reviewer is the SESSION, never the request body — a
 * compliance decision anyone could attribute to anyone else is worthless as an
 * audit trail.
 */
router.post("/issues/:id/review", wrap(async (req, res) => {
  const reviewer = req.session?.email;
  if (!reviewer) return res.status(401).json({ error: "no session" });
  try {
    const row = await reviewIssue(req.params.id, {
      action: req.body?.action, severity: req.body?.severity,
      note: req.body?.note, reviewer,
    });
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  } catch (e) { res.status(400).json({ error: e.message }); }
}));

/** Current weights + thresholds, and whether they are stored or still defaults. */
router.get("/calibration", wrap(async (req, res) => {
  const cal = await readCalibration();
  res.json({ ...cal, defaults: { weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_THRESHOLDS } });
}));

router.post("/calibration", wrap(async (req, res) => {
  try { res.json(await saveCalibration(req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));

/**
 * What the board WOULD look like under different thresholds, without saving
 * them. Calibration is guesswork otherwise: the owner needs to see who becomes
 * eligible before committing to a number.
 */
router.post("/calibration/preview", wrap(async (req, res) => {
  const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 90);
  const board = await gatherQualityBoard({
    days, thresholds: req.body?.thresholds || {}, weights: req.body?.weights || undefined,
  });
  res.json({
    thresholds: board.thresholds, weights: board.weights,
    eligible: board.rows.filter((r) => r.eligible).map((r) => r.name),
    top_performer: board.highlights.top_performer?.name || null,
    rows: board.rows.map((r) => ({
      name: r.name, overall: r.overall, persuasion: r.persuasion, compliance: r.compliance,
      sample_size: r.sample_size, confidence: r.confidence, eligible: r.eligible, reasons: r.reasons,
    })),
  });
}));

/**
 * Drill-down behind a number on the board: the actual customers.
 *
 * Authenticated only, and that is the privacy boundary the owner asked for
 * without asking for it: the TV runs on a kiosk token with no session, so a
 * passer-by never sees a customer's name or number, while a manager logged in at
 * their desk gets the full list from the same screen.
 */
router.get("/drill", wrap(async (req, res) => {
  try {
    const cal = await readCalibration();
    res.json(await drill({
      metric: req.query.metric,
      agent: req.query.agent || null,
      days: Number(req.query.days) || 7,
      limit: req.query.limit,
      lang: langOf(req),
      slaMinutes: cal.thresholds.slaMinutes,
    }));
  } catch (e) { res.status(400).json({ error: e.message }); }
}));

/** What to coach, per employee — rejected findings excluded. */
router.get("/training", wrap(async (req, res) => {
  res.json(await trainingInsights({
    days: Number(req.query.days) || 30, agent: req.query.agent || undefined, lang: langOf(req),
  }));
}));

export default router;
