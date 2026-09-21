import { Router } from "express";
import { query } from "../db.js";
import { streamCsv } from "../lib/csvStream.js";
import { langOf, headers, cellMapper } from "../lib/reportI18n.js";
import { wrap } from "../lib/wrap.js";

const router = Router();

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

function buildFilter(q) {
  const where = [];
  const params = [];
  if (q.stage) { where.push("stage = ?"); params.push(q.stage); }
  if (q.band) { where.push("score_band = ?"); params.push(q.band); }
  if (q.accountType) { where.push("account_type = ?"); params.push(q.accountType); }
  if (q.reviewStatus) { where.push("review_status = ?"); params.push(q.reviewStatus); }
  if (q.country) { where.push("country = ?"); params.push(q.country); }
  if (q.owner) { where.push("contact_owner = ?"); params.push(q.owner); }
  if (q.hasDeposit === "1") where.push("deposit_total_aed > 0");
  if (q.hasDeposit === "0") where.push("(deposit_total_aed = 0 or deposit_total_aed is null)");
  if (q.minScore) { where.push("lead_score >= ?"); params.push(Number(q.minScore) || 0); }
  if (isDate(q.since)) { where.push("created_date >= ?"); params.push(q.since); }
  if (isDate(q.until)) { where.push("created_date <= ?"); params.push(q.until); }
  if (q.q) { where.push("(full_name like ? or phone like ? or ad_name like ?)"); params.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  return { clause: where.length ? "where " + where.join(" and ") : "", params };
}

router.get("/", wrap(async (req, res) => {
  const { clause, params } = buildFilter(req.query);
  const limit = Math.min(parseInt(req.query.limit || "500", 10), 2000);
  const rows = await query(
    `select * from ads_v_customer_360 ${clause} order by lead_score desc limit ${limit}`, params);
  res.json(rows);
}));

router.get("/export.csv", wrap(async (req, res) => {
  const { clause, params } = buildFilter(req.query);
  const cols = ["full_name","phone","stage","lead_score","score_band","country","ad_name","campaign_name",
    "post_url","contact_owner","created_date","account_type","deposit_count","deposit_total_aed","review_status","notes"];
  const lang = langOf(req);
  await streamCsv(res, {
    sql: `select * from ads_v_customer_360 ${clause} order by lead_score desc`,
    params, cols, headers: headers(cols, lang), map: cellMapper(lang),
    filename: lang === "en" ? "qualified-leads.csv" : "العملاء-المؤهلون.csv",
    filenameAscii: "qualified-leads.csv",
  });
}));

router.get("/:waId", wrap(async (req, res) => {
  const rows = await query("select * from ads_v_customer_360 where wa_id = ?", [req.params.waId]);
  if (!rows.length) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
}));

router.patch("/:waId", wrap(async (req, res) => {
  const waId = req.params.waId;
  const b = req.body || {};
  // get phone from the contact for the review row
  const [c] = await query("select phone from ads_wati_contacts where wa_id = ?", [waId]);
  const phone = c ? c.phone : null;
  const accountType = ["unknown", "demo", "real"].includes(b.account_type) ? b.account_type : "unknown";
  const reviewStatus = ["new", "reviewing", "contacted", "converted", "lost"].includes(b.review_status)
    ? b.review_status : "new";
  const depositCount = parseInt(b.deposit_count || 0, 10) || 0;
  const depositTotal = Number(b.deposit_total_aed || 0) || 0;
  const notes = b.notes || null;
  // BUG-025 fix: the author is the AUTHENTICATED session, never a
  // client-supplied value — a client claiming to be someone else was
  // previously possible (and always fell back to the literal "admin").
  const changedBy = req.session?.email || "unknown";

  await query(
    `insert into ads_lead_review
       (wa_id, phone, account_type, deposit_count, deposit_total_aed, review_status, reviewed_by, reviewed_at, notes)
     values (?,?,?,?,?,?,?,now(),?)
     as new on duplicate key update
       phone=new.phone, account_type=new.account_type, deposit_count=new.deposit_count,
       deposit_total_aed=new.deposit_total_aed, review_status=new.review_status,
       reviewed_by=new.reviewed_by, reviewed_at=now(), notes=new.notes`,
    [waId, phone, accountType, depositCount, depositTotal, reviewStatus, changedBy, notes]
  );
  await query(
    `insert into ads_lead_review_events
       (wa_id, account_type, deposit_count, deposit_total_aed, review_status, notes, changed_by)
     values (?,?,?,?,?,?,?)`,
    [waId, accountType, depositCount, depositTotal, reviewStatus, notes, changedBy]
  );

  const [row] = await query("select * from ads_v_customer_360 where wa_id = ?", [waId]);
  res.json(row || { ok: true });
}));

router.get("/:waId/history", wrap(async (req, res) => {
  const rows = await query(
    `select account_type, deposit_count, deposit_total_aed, review_status, notes, changed_by, changed_at
     from ads_lead_review_events where wa_id = ? order by changed_at desc`,
    [req.params.waId]
  );
  res.json(rows);
}));

export default router;
