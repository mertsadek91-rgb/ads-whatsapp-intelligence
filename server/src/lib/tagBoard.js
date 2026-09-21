// Reading the tags back out: the taxonomy with live counts, customers filtered
// by tag, and employees ranked by the tags their customers carry.
//
// Two decisions shape everything here:
//
// 1. A rejected tag is invisible to every filter. It stays in the table as a
//    training signal, but a supervisor who said "this is not a HOT lead" must
//    not see that lead in the HOT list afterwards, or the review is theatre.
//
// 2. `match=all` means the customer carries EVERY selected tag, `match=any`
//    means at least one. That is not a nicety — "hot AND wants gold AND objected
//    to the minimum deposit" is the question a sales manager actually asks, and
//    an OR-only filter cannot express it.
import { query } from "../db.js";
import { CATEGORIES, TAG_INDEX, tagLabel, categoryLabel, DEPARTMENTS, SOURCES } from "./tagTaxonomy.js";
import { normalizeAgentName } from "./agentName.js";

const VISIBLE = "t.review_status <> 'rejected'";

const clean = (list) => [...new Set((Array.isArray(list) ? list : String(list || "").split(","))
  .map((s) => String(s || "").trim().toUpperCase())
  .filter((s) => TAG_INDEX.has(s)))];

/**
 * The whole taxonomy with how many customers actually carry each tag.
 *
 * Tags with a zero count are still returned. Hiding them would hide the most
 * useful fact on the page — that 107 of the 294 tags will stay empty until the
 * trading platform and the compliance system start writing to Wati.
 */
export async function tagCatalog({ since = null, until = null } = {}) {
  const args = [];
  let where = VISIBLE;
  if (since) { where += " and c.created_date >= ?"; args.push(since); }
  if (until) { where += " and c.created_date <= ?"; args.push(until); }

  const rows = await query(
    `select t.tag, count(distinct t.wa_id) n
     from ads_conversation_tag t
     join ads_wati_contacts c on c.wa_id = t.wa_id
     where ${where}
     group by t.tag`, args);
  const counts = new Map(rows.map((r) => [r.tag, Number(r.n)]));

  const categories = CATEGORIES.map((c) => ({
    key: c.key, name_ar: c.name_ar, name_en: c.name_en,
    dept: c.dept, platform: c.platform, source: c.source,
    why_ar: c.why_ar || null,
    tagged: c.tags.reduce((s, [code]) => s + (counts.get(code) || 0), 0),
    tags: c.tags.map(([code, en, ar]) => ({
      tag: code, en, ar, source: TAG_INDEX.get(code).source,
      // Marks a tag this app added on top of the owner's sheet — it does not
      // exist in Wati yet, and the page says so rather than implying it does.
      added: TAG_INDEX.get(code).added,
      count: counts.get(code) || 0,
    })),
  }));

  return {
    departments: DEPARTMENTS, sources: SOURCES, categories,
    totals: {
      tags: TAG_INDEX.size,
      tags_in_use: [...counts.values()].filter((n) => n > 0).length,
      assignments: rows.reduce((s, r) => s + Number(r.n), 0),
      customers_tagged: (await query(
        `select count(distinct t.wa_id) n from ads_conversation_tag t
         join ads_wati_contacts c on c.wa_id = t.wa_id where ${where}`, args))[0]?.n || 0,
    },
  };
}

/**
 * Customers matching a tag filter.
 *
 * The AND case is a HAVING on the number of DISTINCT matched tags, which is the
 * only form that stays correct when a customer carries the same tag twice from
 * two sources.
 */
export async function customersByTag({
  tags = [], match = "any", owner = null, since = null, until = null,
  page = 1, pageSize = 50, lang = "ar",
} = {}) {
  const want = clean(tags);
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);
  const off = (Math.max(parseInt(page, 10) || 1, 1) - 1) * size;

  const args = [];
  const conds = [];
  if (since) { conds.push("c.created_date >= ?"); args.push(since); }
  if (until) { conds.push("c.created_date <= ?"); args.push(until); }
  if (owner) { conds.push("c.contact_owner = ?"); args.push(owner); }

  let join = "", having = "";
  if (want.length) {
    join = `join ads_conversation_tag t on t.wa_id = c.wa_id
            and ${VISIBLE} and t.tag in (${want.map(() => "?").join(",")})`;
    args.unshift(...want); // the join's placeholders come before the where's
    if (match === "all") having = `having count(distinct t.tag) = ${want.length}`;
  }
  const where = conds.length ? `where ${conds.join(" and ")}` : "";

  const rows = await query(
    `select c.wa_id, c.full_name, c.phone, c.contact_owner, c.stage, c.created_date,
            c.last_message_at, c.num_messages,
            group_concat(distinct at.tag order by at.tag) all_tags
     from ads_wati_contacts c
     ${join}
     left join ads_conversation_tag at on at.wa_id = c.wa_id and at.review_status <> 'rejected'
     ${where}
     group by c.wa_id
     ${having}
     order by c.last_message_at desc
     limit ${size} offset ${off}`, args);

  // The total needs the same filter but not the tag-listing join, or the count
  // would be inflated by one row per tag.
  const totalRows = await query(
    `select count(*) n from (
       select c.wa_id from ads_wati_contacts c ${join} ${where}
       group by c.wa_id ${having}) x`, args);

  return {
    total: Number(totalRows[0]?.n || 0), page: Math.max(parseInt(page, 10) || 1, 1), page_size: size,
    match, tags: want,
    rows: rows.map((r) => {
      const list = String(r.all_tags || "").split(",").filter(Boolean);
      return {
        wa_id: r.wa_id, name: r.full_name || null, phone: r.phone || null,
        owner: r.contact_owner || null, owner_label: normalizeAgentName(r.contact_owner) || null,
        stage: r.stage || null, created_date: r.created_date, last_message_at: r.last_message_at,
        messages: Number(r.num_messages || 0),
        tags: list.map((tag) => ({ tag, label: tagLabel(tag, lang), category: TAG_INDEX.get(tag)?.category || null })),
      };
    }),
  };
}

/**
 * Employees, by the tags their customers carry.
 *
 * The share is out of the employee's own tagged customers, not out of everyone —
 * an employee with 12 leads and 6 HOT ones is at 50%, and comparing their raw 6
 * against someone else's raw 40 would say nothing.
 */
export async function employeesByTag({ tags = [], match = "any", since = null, until = null, lang = "ar" } = {}) {
  const want = clean(tags);
  const args = [];
  const conds = ["c.contact_owner is not null", "c.contact_owner <> ''"];
  if (since) { conds.push("c.created_date >= ?"); args.push(since); }
  if (until) { conds.push("c.created_date <= ?"); args.push(until); }

  // Denominator: every customer this employee owns in the window.
  const owned = await query(
    `select c.contact_owner owner, count(*) n from ads_wati_contacts c
     where ${conds.join(" and ")} group by c.contact_owner`, args);

  // Numerator: those matching the filter. With no filter selected the numerator
  // is "has any tag at all", which answers "whose customers have we profiled?".
  const mArgs = [...args];
  let tagCond = VISIBLE;
  if (want.length) { tagCond += ` and t.tag in (${want.map(() => "?").join(",")})`; mArgs.unshift(...want); }
  const matched = await query(
    `select owner, count(*) n from (
       select c.contact_owner owner, c.wa_id
       from ads_wati_contacts c
       join ads_conversation_tag t on t.wa_id = c.wa_id and ${tagCond}
       where ${conds.join(" and ")}
       group by c.contact_owner, c.wa_id
       ${match === "all" && want.length ? `having count(distinct t.tag) = ${want.length}` : ""}) x
     group by owner`, mArgs);
  const mBy = new Map(matched.map((r) => [r.owner, Number(r.n)]));

  // Each employee's most common tags — what kind of customer they actually work.
  const top = await query(
    `select c.contact_owner owner, t.tag, count(distinct t.wa_id) n
     from ads_wati_contacts c
     join ads_conversation_tag t on t.wa_id = c.wa_id and ${VISIBLE}
     where ${conds.join(" and ")}
     group by c.contact_owner, t.tag`, args);
  const topBy = new Map();
  for (const r of top) {
    if (!topBy.has(r.owner)) topBy.set(r.owner, []);
    topBy.get(r.owner).push({ tag: r.tag, label: tagLabel(r.tag, lang), count: Number(r.n) });
  }

  return owned.map((o) => {
    const m = mBy.get(o.owner) || 0;
    const customers = Number(o.n);
    return {
      owner: o.owner, owner_label: normalizeAgentName(o.owner) || o.owner,
      customers, matched: m,
      // null, not 0 — an employee with no customers in the window has no share,
      // and 0% would read as a failure rather than as an empty window.
      share_pct: customers ? Math.round((m / customers) * 1000) / 10 : null,
      top_tags: (topBy.get(o.owner) || []).sort((a, b) => b.count - a.count).slice(0, 6),
    };
  }).sort((a, b) => b.matched - a.matched || b.customers - a.customers);
}

/**
 * Customers who have asked us to stop messaging them on WhatsApp.
 *
 * Only two tags qualify, and the omissions are the point: ENG_DO_NOT_CALL and
 * ENG_DO_NOT_EMAIL are refusals of OTHER channels, and suppressing a WhatsApp
 * follow-up because someone dislikes phone calls would quietly bury real leads.
 * ENG_SPAM is our judgement of them, not their request of us.
 *
 * A rejected tag does not suppress: if a supervisor looked at the evidence and
 * said the customer never asked that, the customer never asked that.
 *
 * An unreviewed tag DOES suppress, because the two errors are not symmetrical —
 * failing to message someone for a day costs a follow-up, messaging someone who
 * asked you to stop costs their trust and can breach WhatsApp's own policy. The
 * safety net is that nothing disappears silently: whoever consumes this is
 * expected to show the customer with the quote behind the tag.
 *
 * @returns Map<wa_id, { tags: string[], evidence: string|null }>
 */
export const DO_NOT_WHATSAPP_TAGS = ["ENG_OPTED_OUT", "ENG_DO_NOT_WHATSAPP"];

export async function doNotWhatsapp(waIds = []) {
  const ids = [...new Set(waIds.filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const rows = await query(
    `select wa_id, tag, evidence, review_status
     from ads_conversation_tag
     where review_status <> 'rejected'
       and tag in (${DO_NOT_WHATSAPP_TAGS.map(() => "?").join(",")})
       and wa_id in (${ids.map(() => "?").join(",")})`,
    [...DO_NOT_WHATSAPP_TAGS, ...ids]);

  const out = new Map();
  for (const r of rows) {
    const e = out.get(r.wa_id) || { tags: [], evidence: null, confirmed: false };
    e.tags.push(r.tag);
    // Keep the first quote we see — the employee needs one reason, not all of them.
    if (!e.evidence && r.evidence) e.evidence = r.evidence;
    if (r.review_status === "confirmed") e.confirmed = true;
    out.set(r.wa_id, e);
  }
  return out;
}

/** One customer's full tag record, with evidence — the drill-down. */
export async function customerTags(waId, { lang = "ar" } = {}) {
  const rows = await query(
    `select tag, category, source, confidence, evidence, review_status, reviewed_by, reviewed_at
     from ads_conversation_tag where wa_id=? order by source, tag`, [waId]);
  const [c] = await query(
    "select wa_id, full_name, phone, contact_owner, stage, created_date from ads_wati_contacts where wa_id=?", [waId]);
  const [run] = await query("select tag_version, tags_found, model, tagged_at from ads_conversation_tag_run where wa_id=?", [waId]);
  return {
    customer: c ? {
      wa_id: c.wa_id, name: c.full_name, phone: c.phone,
      owner_label: normalizeAgentName(c.contact_owner) || null, stage: c.stage, created_date: c.created_date,
    } : null,
    run: run || null,
    tags: rows.map((r) => ({
      tag: r.tag, label: tagLabel(r.tag, lang),
      category: r.category, category_label: categoryLabel(r.category, lang),
      source: r.source, confidence: r.confidence == null ? null : Number(r.confidence),
      evidence: r.evidence, review_status: r.review_status,
      reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at,
    })),
  };
}

export default { tagCatalog, customersByTag, employeesByTag, customerTags };
