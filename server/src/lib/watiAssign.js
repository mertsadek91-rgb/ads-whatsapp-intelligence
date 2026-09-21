// Conversation re-assignment: moves customers to a different employee in Wati
// and records every attempt in ads_assignment_log.
//
// This is the one place in the app that WRITES to the live customer system, so
// it is deliberately conservative:
//  - never sends an empty email (Wati would hand the chat back to the Bot),
//  - refuses an employee who has no verified Wati login email,
//  - runs sequentially with a delay (Wati rate-limits, and a burst of
//    thousands of assignments is exactly how you get throttled mid-run),
//  - logs sent/error/skipped per contact so a partial run is resumable and
//    undoable (the log is the only record of the previous owner).
import { randomUUID } from "crypto";
import { query } from "../db.js";
import * as wati from "./wati.js";

const DELAY_MS = 350;            // between assignments — gentle on the API
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Wati refuses to assign (or even re-open) a conversation once its 24-hour
// WhatsApp window has closed: "Could not assign operator because the ticket is
// Expired". Verified against the live account. Only a new inbound message from
// the customer — or an outbound template — reopens it. So a contact whose last
// activity is older than this is unassignable and we must not waste an API
// call (and rate-limit budget) discovering that thousands of times.
export const WA_WINDOW_HOURS = 24;
export function windowOpen(lastMessageAt, now = new Date()) {
  if (!lastMessageAt) return false;
  const t = new Date(lastMessageAt).getTime();
  if (Number.isNaN(t)) return false;
  return (new Date(now).getTime() - t) / 3600000 < WA_WINDOW_HOURS;
}

export const newBatchId = () => randomUUID().slice(0, 18);

/** Employees that can receive an assignment (have a usable Wati login email). */
export async function assignableEmployees() {
  const rows = await query(
    `select owner_name, full_name, wati_email, active, countries
     from ads_employees where owner_name is not null and owner_name <> '' order by owner_name`);
  return rows.map((r) => ({
    owner_name: r.owner_name,
    full_name: r.full_name || r.owner_name,
    wati_email: r.wati_email || null,
    active: r.active === 1,
    assignable: !!(r.wati_email && EMAIL_RE.test(r.wati_email)),
    countries: typeof r.countries === "string" ? safeJson(r.countries) : (r.countries || []),
  }));
}
const safeJson = (s) => { try { return JSON.parse(s) || []; } catch { return []; } };

/** Resolve an employee's Wati login email; throws if unusable (never silently bot-assigns). */
export async function resolveEmail(ownerName) {
  const [r] = await query("select wati_email from ads_employees where owner_name = ?", [ownerName]);
  const email = r?.wati_email?.trim();
  if (!email || !EMAIL_RE.test(email)) {
    throw new Error(`لا يوجد إيميل Wati صالح للموظف "${ownerName}" — أضِفه في صفحة الموظفين أولاً`);
  }
  return email;
}

async function logRow(o) {
  await query(
    `insert into ads_assignment_log
       (wa_id, from_owner, to_owner, to_email, batch_id, reason, performed_by, status, error)
     values (?,?,?,?,?,?,?,?,?)`,
    [o.wa_id, o.from_owner ?? null, o.to_owner ?? null, o.to_email ?? null, o.batch_id ?? null,
      o.reason ?? "manual", o.performed_by ?? null, o.status, o.error ?? null]).catch(() => {});
}

/**
 * Assign many contacts to one employee.
 * @param {string[]} waIds
 * @param {object} opts - { toOwner, reason, performedBy, batchId, onProgress }
 * @returns {{batchId, total, sent, failed, skipped, results[]}}
 */
export async function assignMany(waIds, { toOwner, reason = "manual", performedBy = null,
  batchId = newBatchId(), onProgress = null } = {}) {
  const toEmail = await resolveEmail(toOwner); // throws before ANY write if unusable
  const ids = [...new Set(waIds.filter(Boolean))];
  const results = [];
  let sent = 0, failed = 0, skipped = 0;

  for (let i = 0; i < ids.length; i++) {
    const waId = ids[i];
    const [c] = await query(
      "select contact_owner, business_channel, last_message_at from ads_wati_contacts where wa_id = ?", [waId]);
    const fromOwner = c?.contact_owner || null;

    if (fromOwner && fromOwner === toOwner) { // already there — don't burn an API call
      skipped++; results.push({ waId, status: "skipped", info: "already-owner" });
      await logRow({ wa_id: waId, from_owner: fromOwner, to_owner: toOwner, to_email: toEmail,
        batch_id: batchId, reason, performed_by: performedBy, status: "skipped", error: "already-owner" });
    } else if (!windowOpen(c?.last_message_at)) {
      // Guaranteed rejection — skip locally rather than calling the API.
      skipped++; results.push({ waId, status: "skipped", info: "window-expired" });
      await logRow({ wa_id: waId, from_owner: fromOwner, to_owner: toOwner, to_email: toEmail,
        batch_id: batchId, reason, performed_by: performedBy, status: "skipped", error: "window-expired" });
    } else {
      const r = await wati.assignOperator(waId, toEmail, c?.business_channel || null);
      const ok = r?.result === true || r?.result === "success";
      if (ok) {
        sent++;
        // Reflect it locally so the UI/reports are consistent before the next sync.
        await query("update ads_wati_contacts set contact_owner = ? where wa_id = ?", [toOwner, waId]).catch(() => {});
        results.push({ waId, status: "sent" });
      } else {
        failed++;
        results.push({ waId, status: "error", info: r?.info || "unknown" });
      }
      await logRow({ wa_id: waId, from_owner: fromOwner, to_owner: toOwner, to_email: toEmail,
        batch_id: batchId, reason, performed_by: performedBy,
        status: ok ? "sent" : "error", error: ok ? null : (r?.info || "unknown") });
    }
    if (onProgress) onProgress({ done: i + 1, total: ids.length, sent, failed, skipped });
    if (i < ids.length - 1) await sleep(DELAY_MS);
  }
  return { batchId, total: ids.length, sent, failed, skipped, results };
}

/**
 * Undo a batch: send every successfully-moved contact back to its previous owner.
 * Contacts whose previous owner was unassigned/bot can't be "unassigned" via the
 * API without handing them to the Bot, so they're reported as not-undoable.
 */
export async function undoBatch(batchId, { performedBy = null } = {}) {
  const rows = await query(
    "select wa_id, from_owner from ads_assignment_log where batch_id = ? and status = 'sent'", [batchId]);
  const byOwner = new Map();
  const notUndoable = [];
  for (const r of rows) {
    if (!r.from_owner) { notUndoable.push(r.wa_id); continue; } // was unassigned/bot
    if (!byOwner.has(r.from_owner)) byOwner.set(r.from_owner, []);
    byOwner.get(r.from_owner).push(r.wa_id);
  }
  const undoBatchId = newBatchId();
  let sent = 0, failed = 0;
  for (const [owner, ids] of byOwner) {
    try {
      const r = await assignMany(ids, { toOwner: owner, reason: "undo", performedBy, batchId: undoBatchId });
      sent += r.sent; failed += r.failed;
    } catch (e) { failed += ids.length; console.error("[assign] undo failed for", owner, e.message); }
  }
  return { undoBatchId, restored: sent, failed, not_undoable: notUndoable };
}

/**
 * Discover real Wati login emails from ticket events and fill in
 * ads_employees.wati_email where it's still blank. Only fills a blank — never
 * overwrites an address a human already set. Returns what it found//wrote.
 */
export async function harvestOperatorEmails({ perOwner = 6 } = {}) {
  const owners = await query(
    `select owner_name from ads_employees
     where owner_name is not null and owner_name <> '' and (wati_email is null or wati_email = '')`);
  const found = [];
  for (const { owner_name } of owners) {
    // Whitespace-tolerant match: Wati owner strings carry stray double spaces
    // (e.g. "Yaser  Kamoun"), so an exact compare silently finds nothing.
    const contacts = await query(
      `select wa_id, business_channel from ads_wati_contacts
       where trim(regexp_replace(contact_owner, '[[:space:]]+', ' ')) = trim(regexp_replace(?, '[[:space:]]+', ' '))
         and num_messages > 0 order by last_message_at desc limit ?`,
      [owner_name, perOwner]);
    const tally = new Map();
    for (const c of contacts) {
      for (const e of await wati.operatorEmailsOf(c.wa_id, c.business_channel || null)) {
        tally.set(e, (tally.get(e) || 0) + 1);
      }
      await sleep(150);
    }
    // Ignore addresses that show up for many different owners (shared/admin
    // accounts) by taking the single most frequent one for THIS owner.
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) {
      await query("update ads_employees set wati_email = ? where owner_name = ? and (wati_email is null or wati_email = '')",
        [best[0], owner_name]);
      found.push({ owner_name, wati_email: best[0], seen: best[1] });
    }
  }
  return { checked: owners.length, filled: found.length, found };
}

export default { assignMany, undoBatch, harvestOperatorEmails, assignableEmployees, resolveEmail, newBatchId };
