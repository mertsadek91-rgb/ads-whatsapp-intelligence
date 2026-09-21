// Wati -> MySQL ingestion (full backfill + 24h incremental). Port of ingest_wati.py.
import * as wati from "../lib/wati.js";
import { normalizeStage, scoreContact } from "../lib/score.js";
import { countryOf } from "../lib/phoneCountry.js";
import { upsert } from "../db.js";
import config from "../config.js";
import { watiSince, describeRange } from "../lib/dataRange.js";

export const WATI_COLS = [
  "wa_id", "bsuid", "full_name", "phone", "created_date", "created_at", "country",
  "source", "ctwa_clid", "source_ad_id", "source_url", "source_headline", "lead_stage",
  "stage", "contact_owner", "assigned_agent", "tags", "attributes", "first_response_min", "num_messages",
  "is_answered", "last_status", "last_message_at", "cx_score", "lead_score", "score_band",
  "score_reasons", "deposit_flag", "business_channel", "msg_unavailable", "country_iso2",
  "wati_contact_id", "allow_broadcast", "raw",
];
// Keep the stored value when this run did not fetch the fact (incoming NULL).
// is_answered and msg_unavailable were missing here, so a `messages:false` run
// — which is what a FULL backfill does by default — overwrote both with
// null/0 for every contact that already had real values.
const COALESCE = [
  "created_date", "created_at", "first_response_min", "num_messages",
  "last_message_at", "is_answered", "msg_unavailable",
];

// The lead score is DERIVED from the message facts above. When we did not fetch
// them, scoreContact() falls through to its ingest-time branch and silently
// loses answered(+4) and msgs(+8) — up to 12 points off 100, enough to move a
// contact out of the hot (>=70) or warm (>=45) band. COALESCE cannot protect
// these: the recomputed value is not null, just wrong. So on a partial run they
// are written for brand-new rows (where a stage/attribution/recency score is
// still better than nothing) and left untouched for existing ones.
const SCORE_COLS = ["lead_score", "score_band", "score_reasons"];

// Full attribute map from customParams (excludes the noisy per-contact whatsapp_<number>).
function allAttributes(c) {
  const out = {};
  for (const p of c.customParams || []) {
    if (!p.name || /^whatsapp_\d+$/i.test(p.name)) continue;
    out[p.name] = p.value;
  }
  return out;
}

const ymd = (d) => (d ? d.toISOString().slice(0, 10) : null);

async function buildRow(c, wantMessages) {
  const waId = c.wAid || c.phone || wati.field(c, "whatsapp", "wa_id") || c.id;
  const created = wati.parseCreated(c);
  let tags = c.contactTags || c.tags || [];
  tags = tags.map((t) => (t && typeof t === "object" ? t.name : t)).filter(Boolean);
  const leadStage = wati.field(c, "Lead Stage", "lead_stage", "leadStage", "stage");
  const stage = normalizeStage(leadStage, tags);
  const srcAd = wati.field(c, "source_id", "source_ad_id", "ad_id");
  const channel = wati.channelOf(c);
  let fr = null, answered = null, n = null, last = null, unavailable = false;
  if (wantMessages && waId) {
    ({ fr, answered, n, last, unavailable } = await wati.firstResponse(waId, channel));
  }
  const deposit = stage === "deposit" || tags.map((t) => String(t).toLowerCase()).includes("deposit");
  const { score, band, reasons } = scoreContact({
    stage, is_answered: answered, num_messages: n, source_ad_id: srcAd,
    created_at: created, deposit_flag: deposit,
  });
  return [
    waId, wati.field(c, "BSUID", "bsuid"), c.fullName || wati.field(c, "name", "full_name"),
    c.phone || wati.field(c, "phone"), ymd(created), created,
    wati.field(c, "country") || c.country, wati.field(c, "Source", "source"),
    wati.field(c, "ctwa_clid", "ctwaclid"), srcAd, wati.field(c, "source_url", "sourceurl", "post_url"),
    wati.field(c, "source_headline", "ad_headline"), leadStage, stage,
    wati.field(c, "Contact Owner", "contact_owner", "owner", "assignedTo"),
    wati.field(c, "assignedTo", "assignee"), tags, allAttributes(c), fr, n, answered,
    c.lastMessageStatus, wati.toDate(last), wati.field(c, "CX Score", "cx_score"),
    score, band, reasons, deposit, channel, wantMessages ? (unavailable ? 1 : 0) : null,
    countryOf(c.phone || wati.field(c, "phone")).iso2 || null,
    c.id || null, c.allowBroadcast === false ? 0 : 1, c,
  ];
}

async function flush(rows, wantMessages) {
  await upsert("ads_wati_contacts", WATI_COLS, rows, ["wa_id"], {
    coalesceCols: COALESCE,
    insertOnlyCols: wantMessages ? [] : SCORE_COLS,
  });
  const attributed = rows.filter((r) => r[9]).length;
  console.log(`[wati] flushed ${rows.length} (${attributed} with source_ad_id)`);
}

/**
 * opts: { incremental:bool, hours:24, messages:bool, since:Date|null }
 *
 * `since` bounds the EXPENSIVE half only. Wati's getContacts has no date
 * filter, so every contact is read and stored whatever the range — but the
 * message thread behind each one is a separate request, and fetching forty
 * thousand of them to report on the last quarter is the difference between a
 * ten-minute import and an overnight one. Contacts created before `since`
 * therefore keep their row and skip their thread.
 */
export async function ingestWati(opts = {}) {
  const { incremental = false, hours = 24, messages = !incremental ? false : true } = opts;
  const since = opts.since !== undefined ? opts.since : (messages ? watiSince(config) : null);
  const cutoff = incremental ? new Date(Date.now() - hours * 3600000) : null;
  if (incremental) console.log(`[wati] INCREMENTAL — updated since ${cutoff.toISOString()} (last ${hours}h)`);
  else console.log(`[wati] FULL backfill (${describeRange(config).en})`);

  // Rows are flushed in two groups because whether the message facts were
  // fetched decides how the upsert treats the derived score columns, and with
  // a `since` date in play that now differs per contact rather than per run.
  const batch = { true: [], false: [] };
  let scanned = 0, kept = 0;
  for await (const c of wati.iterContacts()) {
    scanned++;
    if (cutoff) {
      // BUG-013 fix: a contact with no lastUpdated/updatedAt field used to be
      // silently SKIPPED on every incremental run forever (only a full
      // backfill would ever pick it up again) — the opposite of the safe
      // default. Missing freshness info now means "always include" instead
      // of "always exclude". (True early-exit paging isn't possible: Wati's
      // getContacts has no sort/order param, so every page must still be
      // scanned regardless — this only fixes which contacts survive the
      // in-memory filter, not the scan cost itself.)
      const lu = wati.lastUpdated(c);
      if (lu && lu < cutoff) continue;
    }
    // BUG-015 defensive fix: Wati contacts carry an `isMerged` flag (and
    // `mergedIntoContactId`) for contacts merged into another wa_id — a
    // merged contact was previously ingested as its own separate row,
    // creating a duplicate. As of 2026-07-03 this is `false` for 100% of
    // contacts in the live dataset (no repro today), but the check is
    // essentially free — cheap insurance against a real duplicate the day
    // Wati actually sends one, without building the larger "customers"
    // folding table doc 04/06 describes (deferred until real merge data
    // is observed).
    if (wati.field(c, "isMerged")) continue;
    // Older than the chosen start date: keep the contact, skip its thread. A
    // contact with no creation date is included rather than excluded — same
    // safe default as the incremental filter above.
    const created = wati.parseCreated(c);
    const wantMessages = messages && !(since && created && created < since);
    const r = await buildRow(c, wantMessages);
    if (r[0]) { batch[String(wantMessages)].push(r); kept++; }
    for (const k of ["true", "false"]) {
      if (batch[k].length >= 500) { await flush(batch[k], k === "true"); batch[k] = []; }
    }
  }
  for (const k of ["true", "false"]) {
    if (batch[k].length) await flush(batch[k], k === "true");
  }
  console.log(`[wati] scanned ${scanned}, upserted ${kept}`);
  return { scanned, kept };
}

export default ingestWati;
