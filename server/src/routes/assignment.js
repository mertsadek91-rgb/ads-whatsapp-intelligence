// Customers & assignment: the read side. Lists every contact with its current
// owner, phone-derived country and conversation state, filtered + paginated so
// it stays fast over the full ~8.6k-contact table, and exposes the facets the
// UI needs (countries, owners, campaigns) plus the assignable-employee roster.
//
// Nothing here writes to Wati — reassignment lands in the next batch.
import { Router } from "express";
import { wrap } from "../lib/wrap.js";
import { query } from "../db.js";
import { streamCsv } from "../lib/csvStream.js";
import { langOf, headers, cellMapper } from "../lib/reportI18n.js";
import { assignableEmployees, assignMany, undoBatch, resolveEmail, newBatchId,
  windowOpen, WA_WINDOW_HOURS } from "../lib/watiAssign.js";
import { countryOf, flagEmoji, COUNTRIES } from "../lib/phoneCountry.js";

const COUNTRY_BY_ISO = new Map(COUNTRIES.map((c) => [c.iso2, c]));

const router = Router();

// Wati owner strings carry stray double spaces ("Yaser  Kamoun"), so every
// owner comparison must be whitespace-normalised or it silently matches nothing.
const NORM_OWNER = "trim(regexp_replace(coalesce(c.contact_owner,''), '[[:space:]]+', ' '))";
const AUTOMATION = "bot|qualifier|inquiry|counsel|[0-9a-f]{8}-[0-9a-f]{4}-";
const IS_BOT = `c.contact_owner regexp '${AUTOMATION}'`;
const IS_UNASSIGNED = "(c.contact_owner is null or c.contact_owner = '')";

/** Build the WHERE clause shared by the list, the count and "select all". */
function buildFilter(q) {
  const where = ["1=1"], params = [];
  // owner: a specific person | __unassigned__ | __bot__ | __unhandled__ (either)
  if (q.owner === "__unassigned__") where.push(IS_UNASSIGNED);
  else if (q.owner === "__bot__") where.push(IS_BOT);
  else if (q.owner === "__unhandled__") where.push(`(${IS_UNASSIGNED} or ${IS_BOT})`);
  else if (q.owner) { where.push(`${NORM_OWNER} = trim(regexp_replace(?, '[[:space:]]+', ' '))`); params.push(q.owner); }

  if (q.country) { where.push("c.country_iso2 = ?"); params.push(String(q.country).toUpperCase()); }
  if (q.campaign) { where.push("p.campaign_id = ?"); params.push(q.campaign); }
  if (q.stage) { where.push("c.stage = ?"); params.push(q.stage); }
  if (q.since) { where.push("c.created_date >= ?"); params.push(q.since); }
  if (q.until) { where.push("c.created_date <= ?"); params.push(q.until); }
  if (q.channel) { where.push("c.business_channel = ?"); params.push(q.channel); }
  // conversation state
  if (q.state === "contacted") where.push("(m.conv_type = 'human_handled' or m.human_replied = 1)");
  if (q.state === "not_contacted") where.push("(m.conv_type is null or (m.conv_type <> 'human_handled' and coalesce(m.human_replied,0) = 0))");
  if (q.state === "bot_only") where.push("m.conv_type = 'bot_only'");

  // Chat status is a SEPARATE axis from contact state, so the two can be
  // combined — "not contacted AND still open" is the actionable work list.
  // Authoritative source is the 24h window: Wati reports a closed window as an
  // Expired ticket and refuses to assign or even reopen it. (The ticket-status
  // events in getMessages only record explicit changes and still read "Open"
  // long after expiry, so they can't be trusted for current state.)
  const OPEN = `c.last_message_at >= (now() - interval ${WA_WINDOW_HOURS} hour)`;
  const CLOSED = `(c.last_message_at is null or c.last_message_at < (now() - interval ${WA_WINDOW_HOURS} hour))`;
  if (q.chat === "open") where.push(OPEN);
  if (q.chat === "closed") where.push(CLOSED);
  // back-compat: the window used to live on `state`
  if (q.state === "assignable") where.push(OPEN);
  if (q.state === "expired") where.push(CLOSED);
  if (q.q) {
    where.push("(c.full_name like ? or c.phone like ? or c.wa_id like ?)");
    const like = `%${String(q.q).slice(0, 60)}%`;
    params.push(like, like, like);
  }
  return { clause: where.join(" and "), params };
}

const FROM = `from ads_wati_contacts c
  left join ads_meta_ad_perf p on p.ad_id = c.source_ad_id
  left join ads_conversation_meta m on m.wa_id = c.wa_id`;

router.get("/contacts", async (req, res) => {
  try {
    const f = buildFilter(req.query);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);
    const [rows, [cnt]] = await Promise.all([
      query(
        `select c.wa_id, c.full_name, c.phone, c.contact_owner, c.country_iso2, c.stage,
                c.num_messages, c.last_message_at, c.created_date, c.business_channel,
                c.msg_unavailable, p.campaign_name,
                m.conv_type, m.human_replied
         ${FROM} where ${f.clause}
         order by coalesce(c.last_message_at, c.created_at) desc
         limit ${limit} offset ${offset}`, f.params),
      query(`select count(*) total ${FROM} where ${f.clause}`, f.params),
    ]);
    res.json({
      total: Number(cnt?.total || 0), limit, offset,
      rows: rows.map((r) => {
        const iso2 = r.country_iso2 || countryOf(r.phone).iso2;
        return {
          ...r,
          country_iso2: iso2,
          flag: iso2 ? flagEmoji(iso2) : "",
          contacted: r.conv_type === "human_handled" || r.human_replied === 1,
          unassigned: !r.contact_owner,
          // whether Wati will accept an assignment for this conversation
          window_open: windowOpen(r.last_message_at),
        };
      }),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Just the ids matching the current filter — powers "select all N results". */
router.get("/contacts/ids", async (req, res) => {
  try {
    const f = buildFilter(req.query);
    const cap = Math.min(Math.max(parseInt(req.query.cap || "5000", 10) || 5000, 1), 20000);
    const rows = await query(`select c.wa_id ${FROM} where ${f.clause} limit ${cap}`, f.params);
    res.json({ ids: rows.map((r) => r.wa_id), capped: rows.length === cap });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Country distribution of the CURRENT filter — e.g. "of the 3,585 unassigned,
 * 1,477 are Moroccan". Uses the same WHERE clause as the list so the numbers
 * always agree with what's on screen.
 */
router.get("/breakdown", async (req, res) => {
  try {
    const f = buildFilter(req.query);
    const rows = await query(
      `select c.country_iso2 iso2, count(*) n ${FROM} where ${f.clause}
       group by c.country_iso2 order by n desc limit 40`, f.params);
    res.json({
      countries: rows.map((r) => {
        const meta = r.iso2 ? COUNTRY_BY_ISO.get(r.iso2) : null;
        return { iso2: r.iso2 || null, n: Number(r.n), flag: r.iso2 ? flagEmoji(r.iso2) : "🏳",
          ar: meta?.ar || (r.iso2 || "غير معروف"), en: meta?.en || (r.iso2 || "Unknown") };
      }),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** The filtered list as CSV — for handing a work list to someone offline. */
router.get("/export.csv", wrap(async (req, res) => {
  const f = buildFilter(req.query);
  const lang = langOf(req);
  const cols = ["wa_id", "full_name", "phone", "country_iso2", "contact_owner",
    "stage", "num_messages", "last_message_at", "created_date", "campaign_name"];
  await streamCsv(res, {
    sql: `select c.wa_id, c.full_name, c.phone, c.country_iso2, c.contact_owner,
                 c.stage, c.num_messages, c.last_message_at, c.created_date, p.campaign_name
          ${FROM} where ${f.clause}
          order by coalesce(c.last_message_at, c.created_at) desc`,
    params: f.params, cols, headers: headers(cols, lang), map: cellMapper(lang),
    filename: lang === "en" ? "assignment-contacts.csv" : "إسناد-المحادثات.csv",
    filenameAscii: "assignment-contacts.csv",
  });
}));

/** Dropdown facets + the assignable roster, in one call. */
router.get("/facets", async (req, res) => {
  try {
    const [countries, owners, campaigns, buckets, employees] = await Promise.all([
      query(`select country_iso2 iso2, count(*) n from ads_wati_contacts
             where country_iso2 is not null and country_iso2 <> '' group by iso2 order by n desc`),
      query(`select ${NORM_OWNER} owner, count(*) n from ads_wati_contacts c
             where c.contact_owner is not null and c.contact_owner <> ''
               and c.contact_owner not regexp '${AUTOMATION}'
             group by owner order by n desc`),
      query(`select p.campaign_id id, p.campaign_name name, count(*) n
             from ads_wati_contacts c join ads_meta_ad_perf p on p.ad_id = c.source_ad_id
             group by p.campaign_id, p.campaign_name order by n desc limit 60`),
      query(`select sum(case when ${IS_UNASSIGNED} then 1 else 0 end) unassigned,
                    sum(case when ${IS_BOT} then 1 else 0 end) bot,
                    sum(case when c.last_message_at >= (now() - interval ${WA_WINDOW_HOURS} hour)
                             then 1 else 0 end) open_chats,
                    count(*) total
             from ads_wati_contacts c`),
      assignableEmployees(),
    ]);
    res.json({
      countries: countries.map((c) => {
        const meta = COUNTRY_BY_ISO.get(c.iso2);
        return { iso2: c.iso2, n: c.n, flag: flagEmoji(c.iso2), ar: meta?.ar || c.iso2, en: meta?.en || c.iso2 };
      }),
      owners, campaigns, employees,
      counts: {
        total: Number(buckets[0]?.total || 0),
        unassigned: Number(buckets[0]?.unassigned || 0),
        bot: Number(buckets[0]?.bot || 0),
        open_chats: Number(buckets[0]?.open_chats || 0),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------------------------------------------------------------------------
// Write side. Reassignment pushes to the live customer system, so it is a
// two-step flow on purpose: /preview never touches Wati and returns exactly
// what would change; /execute refuses to run without an explicit confirm and
// a batch that matches the preview's size.
// ---------------------------------------------------------------------------
const MAX_BATCH = 2000;   // hard ceiling on one operation
const performer = (req) => req.session?.email || `user#${req.session?.userId || "?"}`;

/** Normalise + validate the id list shared by preview and execute. */
function idsOf(body) {
  const ids = [...new Set((Array.isArray(body?.waIds) ? body.waIds : [])
    .map((s) => String(s || "").trim()).filter(Boolean))];
  return ids;
}

router.post("/preview", async (req, res) => {
  const ids = idsOf(req.body);
  const toOwner = String(req.body?.toOwner || "").trim();
  if (!ids.length) return res.status(400).json({ error: "لم تحدّد أي عميل" });
  if (!toOwner) return res.status(400).json({ error: "اختر الموظف المُسنَد إليه" });
  if (ids.length > MAX_BATCH) return res.status(400).json({ error: `الحد الأقصى ${MAX_BATCH} محادثة في العملية الواحدة` });
  try {
    // Throws (before anything is shown as doable) if the target has no Wati email.
    const toEmail = await resolveEmail(toOwner);
    const rows = await query(
      `select c.wa_id, c.full_name, c.phone, c.contact_owner, c.country_iso2, c.msg_unavailable,
              c.last_message_at
       from ads_wati_contacts c where c.wa_id in (${ids.map(() => "?").join(",")})`, ids);
    const found = new Set(rows.map((r) => r.wa_id));
    const notOwned = rows.filter((r) => (r.contact_owner || null) !== toOwner);
    const alreadyOwned = rows.filter((r) => (r.contact_owner || null) === toOwner);
    // Wati rejects an expired ticket outright, so those are reported as
    // blocked rather than counted as movable — otherwise the confirmation
    // promises a move that cannot happen.
    const willMove = notOwned.filter((r) => windowOpen(r.last_message_at));
    const expired = notOwned.length - willMove.length;
    // Group the "from" side so the confirmation reads as a sentence, not a list.
    const fromCounts = {};
    for (const r of willMove) {
      const k = r.contact_owner || "__unassigned__";
      fromCounts[k] = (fromCounts[k] || 0) + 1;
    }
    res.json({
      toOwner, toEmail,
      requested: ids.length,
      missing: ids.filter((i) => !found.has(i)),
      already_owned: alreadyOwned.length,
      will_move: willMove.length,
      expired,                       // window closed -> Wati will refuse these
      window_hours: WA_WINDOW_HOURS,
      from_counts: fromCounts,
      unlinked_channel: willMove.filter((r) => r.msg_unavailable === 1).length,
      sample: willMove.slice(0, 25).map((r) => ({
        wa_id: r.wa_id, full_name: r.full_name, phone: r.phone,
        from: r.contact_owner || null, country_iso2: r.country_iso2,
      })),
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/execute", async (req, res) => {
  const ids = idsOf(req.body);
  const toOwner = String(req.body?.toOwner || "").trim();
  const reason = ["manual", "employee_exit", "bot_cleanup"].includes(req.body?.reason) ? req.body.reason : "manual";
  if (!req.body?.confirm) return res.status(400).json({ error: "التنفيذ يتطلّب تأكيداً صريحاً" });
  if (!ids.length) return res.status(400).json({ error: "لم تحدّد أي عميل" });
  if (!toOwner) return res.status(400).json({ error: "اختر الموظف المُسنَد إليه" });
  if (ids.length > MAX_BATCH) return res.status(400).json({ error: `الحد الأقصى ${MAX_BATCH} محادثة في العملية الواحدة` });
  // The client echoes back what the preview told it; a mismatch means the
  // selection changed after the preview and the confirmation is stale.
  if (req.body.expected != null && Number(req.body.expected) !== ids.length) {
    return res.status(409).json({ error: "تغيّر التحديد بعد المعاينة — أعد المعاينة" });
  }
  try {
    const r = await assignMany(ids, { toOwner, reason, performedBy: performer(req), batchId: newBatchId() });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/undo/:batchId", async (req, res) => {
  const batchId = String(req.params.batchId || "").trim();
  if (!batchId) return res.status(400).json({ error: "معرّف عملية غير صالح" });
  try { res.json(await undoBatch(batchId, { performedBy: performer(req) })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/**
 * Handover view for a departing employee: what they still hold, broken down by
 * country and contact state, so their book can be split sensibly rather than
 * dumped on one person. Read-only — the actual move goes through /execute.
 */
router.get("/handover/:owner", async (req, res) => {
  const owner = String(req.params.owner || "").trim();
  if (!owner) return res.status(400).json({ error: "اختر الموظف" });
  const NEQ = `${NORM_OWNER} = trim(regexp_replace(?, '[[:space:]]+', ' '))`;
  try {
    const [byCountry, [totals], [emp]] = await Promise.all([
      query(
        `select c.country_iso2 iso2, count(*) n,
                sum(case when m.conv_type='human_handled' or m.human_replied=1 then 1 else 0 end) contacted,
                max(c.last_message_at) last_at
         from ads_wati_contacts c left join ads_conversation_meta m on m.wa_id = c.wa_id
         where ${NEQ} group by c.country_iso2 order by n desc`, [owner]),
      query(
        `select count(*) total, max(c.last_message_at) last_at,
                sum(case when c.stage in ('qualified','interested','demo','deposit') then 1 else 0 end) interested
         from ads_wati_contacts c where ${NEQ}`, [owner]),
      query(`select owner_name, full_name, active, wati_email from ads_employees
             where trim(regexp_replace(owner_name, '[[:space:]]+', ' ')) = trim(regexp_replace(?, '[[:space:]]+', ' '))`, [owner]),
    ]);
    res.json({
      owner,
      // A departed agent may not exist in ads_employees at all (Wati owns the
      // name, our roster is separate) — that must not break the handover view.
      employee: emp || null,
      total: Number(totals?.total || 0),
      interested: Number(totals?.interested || 0),
      last_activity: totals?.last_at || null,
      by_country: byCountry.map((r) => {
        const meta = COUNTRY_BY_ISO.get(r.iso2);
        return { iso2: r.iso2 || null, flag: r.iso2 ? flagEmoji(r.iso2) : "",
          ar: meta?.ar || r.iso2 || "—", en: meta?.en || r.iso2 || "—",
          n: Number(r.n), contacted: Number(r.contacted || 0), last_at: r.last_at };
      }),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Deactivate an employee once their book has been handed over. */
router.post("/deactivate", async (req, res) => {
  const owner = String(req.body?.owner || "").trim();
  if (!owner) return res.status(400).json({ error: "اختر الموظف" });
  try {
    const [left] = await query(
      `select count(*) n from ads_wati_contacts c
       where ${NORM_OWNER} = trim(regexp_replace(?, '[[:space:]]+', ' '))`, [owner]);
    // Refuse while they still hold conversations — deactivating first would
    // strand those customers with an owner nobody is watching.
    if (Number(left?.n || 0) > 0 && !req.body?.force) {
      return res.status(409).json({ error: `ما زال لديه ${left.n} محادثة — انقلها أولاً`, remaining: Number(left.n) });
    }
    await query(`update ads_employees set active=0
      where trim(regexp_replace(owner_name, '[[:space:]]+', ' ')) = trim(regexp_replace(?, '[[:space:]]+', ' '))`, [owner]);
    res.json({ ok: true, owner, remaining: Number(left?.n || 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** Recent assignment activity, newest batch first. */
router.get("/log", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10) || 20, 1), 100);
  try {
    const batches = await query(
      `select batch_id, reason, performed_by, to_owner, min(created_at) at,
              sum(status='sent') sent, sum(status='error') failed, sum(status='skipped') skipped,
              count(*) total
       from ads_assignment_log where batch_id is not null
       group by batch_id, reason, performed_by, to_owner
       order by at desc limit ${limit}`);
    res.json({ batches });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
