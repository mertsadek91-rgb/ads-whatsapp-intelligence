// Editing the business profile after installation.
//
// The wizard reviews the generated profile once; this is how it is changed
// afterwards — when the business adds a service, a rule turns out to be wrong,
// or a compliance issue needs a different severity.
//
// Admin-only, because these values decide how every employee is scored.
import { Router } from "express";
import * as bp from "../lib/businessProfile.js";
import { validateProfile } from "../lib/profileSchema.js";
import { generateBusinessProfile } from "../lib/profileGen.js";
import { budgetRemaining, hasKey } from "../lib/deepseek.js";
import { query } from "../db.js";
import { wrap } from "../lib/wrap.js";

const router = Router();

const summarise = (p) => ({
  issueTypes: p.issue_types?.length || 0,
  tags: (p.tags?.categories || []).reduce((n, c) => n + (c.tags?.length || 0), 0),
  aiTags: (p.tags?.categories || []).filter((c) => c.source === "ai")
    .reduce((n, c) => n + (c.tags?.length || 0), 0),
  stages: p.lifecycle?.stages?.length || 0,
  facts: p.identity?.facts?.length || 0,
  unverifiedFacts: (p.identity?.facts || []).filter((f) => !f.verified_by_human && f.source !== "website").length,
  calibrationCases: p.calibration_cases?.length || 0,
});

/** The live profile, plus whether a draft is waiting. */
router.get("/", wrap(async (req, res) => {
  const draft = await bp.getDraft();
  const profile = bp.getProfile();
  res.json({
    profile,
    meta: bp.getMeta(),
    summary: summarise(profile),
    hasDraft: !!draft,
    aiAvailable: hasKey(),
  });
}));

router.get("/draft", wrap(async (req, res) => {
  const draft = await bp.getDraft();
  if (!draft) return res.json({ draft: null });
  const { errors, warnings, repairs } = validateProfile(draft.profile);
  res.json({ draft: draft.profile, version: draft.version, errors, warnings, repairs,
    summary: summarise(draft.profile) });
}));

/**
 * Save a draft. Validation runs on every save and is returned rather than
 * thrown: an operator editing a 300-line document needs to see what is wrong
 * while they work, not lose the edit.
 */
router.put("/draft", wrap(async (req, res) => {
  const result = await bp.saveDraft(req.body?.profile, {
    source: "human", createdBy: req.session?.email || null });
  res.json({ ok: result.errors.length === 0, ...result, summary: summarise(result.profile) });
}));

/** Re-generate from the website. Overwrites the draft, never the live profile. */
router.post("/generate", wrap(async (req, res) => {
  const remaining = await budgetRemaining().catch(() => null);
  if (remaining != null && remaining < 0.5) {
    return res.status(400).json({ ok: false,
      detail: "ميزانية الذكاء الاصطناعي اليومية شبه مستنفدة (the daily AI budget is nearly exhausted)" });
  }
  // Reuse what the wizard was told about the business unless new values are given.
  const stored = await query("select v from ads_settings where k = 'business_input'")
    .then((r) => (r.length ? JSON.parse(r[0].v) : {}))
    .catch(() => ({}));
  const out = await generateBusinessProfile({
    websiteUrl: req.body?.websiteUrl ?? stored.websiteUrl,
    description: req.body?.description ?? stored.description,
    language: req.body?.language ?? stored.language ?? "ar",
  });
  await bp.saveDraft(out.profile, { source: "ai", generatedFrom: out.evidence,
    createdBy: req.session?.email || null });
  res.json({ ok: true, profile: out.profile, warnings: out.warnings, repairs: out.repairs,
    errors: out.errors, evidence: out.evidence, summary: summarise(out.profile) });
}));

/**
 * Make the draft live.
 *
 * The response says plainly whether this costs a re-analysis, because that is
 * the difference between a free label fix and re-scoring a month of
 * conversations against the AI budget.
 */
router.post("/activate", wrap(async (req, res) => {
  if (req.body?.profile) {
    const saved = await bp.saveDraft(req.body.profile, {
      source: "human", createdBy: req.session?.email || null });
    if (saved.errors.length) {
      return res.status(400).json({ ok: false, errors: saved.errors });
    }
  }
  const r = await bp.activateDraft({ activatedBy: req.session?.email || null });
  res.json({ ok: true, ...r });
}));

router.get("/versions", wrap(async (req, res) => res.json(await bp.listVersions())));

export default router;
