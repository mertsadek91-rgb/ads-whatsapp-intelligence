// Customer-type tags: the taxonomy with live counts, the two filtered views
// (customers and employees), one customer's evidence, and the tagging runs.
import { Router } from "express";
import { query } from "../db.js";
import { tagCatalog, customersByTag, employeesByTag, customerTags } from "../lib/tagBoard.js";
import { tagBacklog, pendingTagging, isTagging } from "../jobs/tagBacklog.js";
import { tagConversation, TAG_VERSION } from "../lib/tagAssign.js";
import { TAG_INDEX, isKnownTag } from "../lib/tagTaxonomy.js";
import { scanWindow } from "../lib/qualityBoard.js";
import { budgetRemaining } from "../lib/deepseek.js";

const router = Router();
const langOf = (req) => (/^en/i.test(req.headers["accept-language"] || "") ? "en" : "ar");
const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

router.get("/catalog", async (req, res) => {
  try { res.json(await tagCatalog({ since: ymd(req.query.since), until: ymd(req.query.until) })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/customers", async (req, res) => {
  try {
    res.json(await customersByTag({
      tags: req.query.tags, match: req.query.match === "all" ? "all" : "any",
      owner: req.query.owner || null, since: ymd(req.query.since), until: ymd(req.query.until),
      page: req.query.page, pageSize: req.query.page_size, lang: langOf(req),
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/employees", async (req, res) => {
  try {
    res.json(await employeesByTag({
      tags: req.query.tags, match: req.query.match === "all" ? "all" : "any",
      since: ymd(req.query.since), until: ymd(req.query.until), lang: langOf(req),
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/customer/:waId", async (req, res) => {
  try { res.json(await customerTags(req.params.waId, { lang: langOf(req) })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/** Coverage + backlog, so the size of a tagging run is visible before it starts. */
router.get("/status", async (req, res) => {
  try {
    const since = ymd(req.query.since), until = ymd(req.query.until);
    const days = Number(req.query.days) || 30;
    const window = scanWindow({ since, until, days });
    const pending = await pendingTagging({ since, until, days, limit: 5000 });
    const [cov] = await query(
      `select count(*) total, sum(r.wa_id is not null) tagged
       from ads_wati_contacts c
       join ads_conversation_analysis a on a.wa_id = c.wa_id
       left join ads_conversation_tag_run r on r.wa_id = c.wa_id and r.tag_version = ?
       where c.created_date >= ? and c.created_date <= ?
         and a.thread_snapshot is not null and json_length(a.thread_snapshot) >= 3`,
      [TAG_VERSION, window.since, window.until]);
    res.json({
      tag_version: TAG_VERSION, window, running: isTagging(),
      pending: pending.length,
      taggable: Number(cov?.total || 0), tagged: Number(cov?.tagged || 0),
      budget_remaining_usd: await budgetRemaining().catch(() => null),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Fire-and-forget tagging run over a period. Watched via /status. */
router.post("/run", (req, res) => {
  if (isTagging()) return res.status(409).json({ error: "التوسيم قيد التشغيل بالفعل" });
  const b = req.body || {};
  const since = ymd(b.since), until = ymd(b.until);
  const days = Math.min(Math.max(Number(b.days) || 30, 1), 730);
  const limit = Math.min(Math.max(Number(b.limit) || 500, 1), 5000);
  res.json({ started: true, window: scanWindow({ since, until, days }), limit });
  tagBacklog({ since, until, days, limit })
    .then((r) => console.log("[tags] run done:", JSON.stringify({ ...r, errors: r.errors?.slice(0, 3) })))
    .catch((e) => console.error("[tags] run failed:", e.message));
});

/** Re-tag ONE conversation now — the "why did it tag this?" loop. */
router.post("/customer/:waId/retag", async (req, res) => {
  try {
    const { saveTags } = await import("../lib/tagAssign.js");
    const r = await tagConversation(req.params.waId);
    await saveTags(r);
    res.json(await customerTags(req.params.waId, { lang: langOf(req) }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Confirm or reject one tag on one customer.
 *
 * The reviewer comes from the session, never from the body — a review record
 * that can name anyone is not a review record.
 */
router.post("/customer/:waId/review", async (req, res) => {
  const tag = String(req.body?.tag || "").trim().toUpperCase();
  const action = String(req.body?.action || "");
  if (!isKnownTag(tag)) return res.status(400).json({ error: "وسم غير معروف" });
  if (!["confirm", "reject", "reset"].includes(action)) return res.status(400).json({ error: "إجراء غير معروف" });
  const who = req.session?.email;
  if (!who) return res.status(401).json({ error: "الجلسة منتهية" });
  try {
    const status = action === "confirm" ? "confirmed" : action === "reject" ? "rejected" : "auto";
    const r = await query(
      "update ads_conversation_tag set review_status=?, reviewed_by=?, reviewed_at=now() where wa_id=? and tag=?",
      [status, who, req.params.waId, tag]);
    if (!r.affectedRows) return res.status(404).json({ error: "هذا الوسم غير مُسند لهذا العميل" });
    res.json(await customerTags(req.params.waId, { lang: langOf(req) }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Add a tag by hand.
 *
 * Only tags the AI is not allowed to own can be added this way plus the AI's own
 * vocabulary — what is refused is a tag whose truth lives in the trading
 * platform or the compliance system, because typing COMP_KYC_VERIFIED here
 * would create a compliance record out of nothing.
 */
router.post("/customer/:waId/tag", async (req, res) => {
  const tag = String(req.body?.tag || "").trim().toUpperCase();
  const meta = TAG_INDEX.get(tag);
  if (!meta) return res.status(400).json({ error: "وسم غير معروف" });
  if (meta.source === "external") {
    return res.status(400).json({ error: "هذا الوسم مصدره نظام آخر (منصّة التداول/الالتزام) ولا يُسند من هنا" });
  }
  const who = req.session?.email;
  if (!who) return res.status(401).json({ error: "الجلسة منتهية" });
  try {
    await query(
      `insert into ads_conversation_tag (wa_id, tag, category, source, evidence, review_status, reviewed_by, reviewed_at)
       values (?,?,?,'manual',?,'confirmed',?,now()) as new
       on duplicate key update source='manual', evidence=new.evidence,
         review_status='confirmed', reviewed_by=new.reviewed_by, reviewed_at=now()`,
      [req.params.waId, tag, meta.category, String(req.body?.note || "").slice(0, 500) || null, who]);
    res.json(await customerTags(req.params.waId, { lang: langOf(req) }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
