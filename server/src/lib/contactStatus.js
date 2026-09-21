// Per-lead contact status: did a HUMAN employee actually reply (not the bot),
// and if not — is it because the lead arrived after working hours, and is its
// WhatsApp 24h reply window still open? Drives the country/employee contact
// tables, the daily follow-up email, and the persisted ads_lead_followup table.
//
// Data reality: ads_wati_contacts.created_at is DATE-only (no time-of-day), so
// the arrival TIME is taken from ads_conversation_meta.last_activity (for an
// un-replied lead that's the customer's own last message — a valid proxy).
// Dubai time is UTC+4 (no DST), computed in JS to avoid a MySQL convert_tz dep.
import { query } from "../db.js";
import config from "../config.js";
import { countryOf } from "./phoneCountry.js";

const QUAL = "('qualified','interested','demo','deposit')";
const WA_WINDOW_HOURS = 24;
const QSET = new Set(["qualified", "interested", "demo", "deposit"]);

/**
 * Is this lead interested?
 *
 * Wati's `stage` is a CRM label: somebody or some automation moved the lead to
 * "Qualified" at some point and nothing ever moved it back. The AI's
 * `lead_intent` is a reading of what was actually said. When they disagree, the
 * conversation wins — a customer who refused twice and asked not to be contacted
 * again is not "interested" because a CRM field still says so.
 *
 * This is a VETO, not a replacement. A cold reading removes a lead from the
 * interested set; a warm reading does not add one that never progressed, because
 * "warm" describes most conversations and would turn the metric into a count of
 * everyone who replied. Wati's stage stays the definition of pipeline progress;
 * the AI only stops it from asserting something the transcript contradicts.
 *
 * `interest_conflict` is kept on the row on purpose: a lead parked in "Qualified"
 * who has actually walked away is a pipeline that needs correcting in Wati, and
 * that is worth seeing rather than silently smoothing over.
 */
export function interest(r = {}) {
  const byStage = QSET.has(r.stage);
  const ai = r.ai_intent || null;
  const aiRefused = ai === "cold";
  return {
    interested: byStage && !aiRefused,
    ai_intent: ai,
    ai_status: r.ai_status || null,
    // Only a real disagreement: the CRM says progressed, the transcript says no.
    interest_conflict: byStage && aiRefused,
  };
}

export function sanitizeWorkHours(b = {}) {
  const clampH = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 24 ? Math.floor(Number(v)) : d);
  const start = clampH(b.start, config.workHours.start);
  const end = clampH(b.end, config.workHours.end);
  const offDays = Array.isArray(b.offDays)
    ? [...new Set(b.offDays.map(Number).filter((n) => n >= 0 && n <= 6))]
    : config.workHours.offDays;
  return { start, end: Math.max(end, start + 1), offDays };
}

export async function readWorkHours() {
  const r = await query("select v from ads_settings where k='work_hours'");
  if (!r.length) return { ...config.workHours };
  try { return sanitizeWorkHours(JSON.parse(r[0].v)); } catch { return { ...config.workHours }; }
}

/** Dubai (UTC+4) hour + weekday for a UTC datetime. */
function dubaiParts(dt) {
  const d = new Date(new Date(dt).getTime() + 4 * 3600 * 1000);
  return { hour: d.getUTCHours(), dow: d.getUTCDay() };
}
function isAfterHours(dt, wh) {
  if (!dt) return false;
  const { hour, dow } = dubaiParts(dt);
  return wh.offDays.includes(dow) || hour < wh.start || hour >= wh.end;
}

/**
 * Per-lead contact rows for [since, until] (by arrival date) + country/employee
 * rollups. `now` drives the live 24h-window calc.
 */
export async function gatherContactStatus(since, until, { now = new Date(), workHours = null } = {}) {
  const wh = workHours || (await readWorkHours());
  const nowMs = new Date(now).getTime();

  const rows = await query(
    `select c.wa_id, c.created_date, c.phone, c.contact_owner owner, c.stage, c.source_ad_id,
            c.msg_unavailable,
            m.conv_type, m.human_replied, m.first_human_response_min, m.last_activity, m.last_dir,
            a.lead_intent ai_intent, a.lead_status ai_status
     from ads_wati_contacts c
     left join ads_conversation_meta m on m.wa_id = c.wa_id
     left join ads_conversation_analysis a on a.wa_id = c.wa_id
     where c.created_date >= ? and c.created_date <= ?`, [since, until]);

  // Est. cost per lead = its ad's spend / that ad's total attributed leads.
  const adRows = await query(
    `select p.ad_id, p.spend_aed, count(w.wa_id) leads
     from ads_meta_ad_perf p left join ads_wati_contacts w on w.source_ad_id = p.ad_id
     group by p.ad_id, p.spend_aed`);
  const costPerLead = {};
  for (const a of adRows) costPerLead[a.ad_id] = a.leads > 0 ? (Number(a.spend_aed) || 0) / a.leads : 0;

  const leads = rows.map((r) => {
    const contacted = r.conv_type === "human_handled" || r.human_replied === 1;
    // For an un-replied lead the last activity IS the customer's last message.
    const lastIn = r.last_activity ? new Date(r.last_activity).getTime() : null;
    const hoursSince = lastIn ? (nowMs - lastIn) / 3600000 : null;
    const windowOpen = !contacted && lastIn != null && hoursSince < WA_WINDOW_HOURS;
    // A bot-only chat = a real customer messaged and ONLY the bot replied — the
    // owner's rule: that IS a lead a human never contacted, so it counts as
    // not-contacted (not excluded). Only no_customer (no customer message at
    // all) genuinely needs no human.
    const expired = !contacted && r.conv_type !== "no_customer"
      && lastIn != null && hoursSince >= WA_WINDOW_HOURS;
    const afterHours = !contacted && isAfterHours(r.last_activity, wh);
    const awaiting = !contacted && (r.conv_type === "awaiting_human" || r.conv_type === "abandoned");

    let status = "contacted";
    if (!contacted) {
      // Messages live on a second WhatsApp number we can't read yet — a data
      // gap, excluded from contact metrics.
      if (r.msg_unavailable === 1) status = "channel_unavailable";
      // Only a contact with NO customer message needs no human.
      else if (r.conv_type === "no_customer") status = "no_human_needed";
      else if (expired) status = "expired_no_contact";
      else if (afterHours) status = "pending_after_hours";
      else status = "pending_in_hours";
    }
    return {
      wa_id: r.wa_id, created_date: r.created_date instanceof Date ? r.created_date.toISOString().slice(0, 10) : String(r.created_date).slice(0, 10),
      country: countryOf(r.phone).iso2, owner: r.owner || null, stage: r.stage,
      source_ad_id: r.source_ad_id, contacted, awaiting,
      first_human_response_min: r.first_human_response_min != null ? Number(r.first_human_response_min) : null,
      after_hours: afterHours, wa_window_open: windowOpen,
      wa_hours_left: windowOpen ? Math.max(0, Math.round((WA_WINDOW_HOURS - hoursSince) * 10) / 10) : null,
      ...interest(r),
      status, est_cost_aed: Math.round((costPerLead[r.source_ad_id] || 0) * 100) / 100,
      last_activity: r.last_activity || null,
    };
  });

  return { leads, workHours: wh };
}

/** Group leads by a key into contact-status counts + cost split. */
export function rollup(leads, keyOf) {
  const g = {};
  for (const l of leads) {
    const key = keyOf(l);
    if (key == null) continue;
    const a = (g[key] ||= {
      key, leads: 0, contacted: 0, not_contacted: 0, after_hours: 0, negligence: 0, expired: 0,
      awaiting: 0, interested: 0, cost_contacted: 0, cost_not_contacted: 0,
    });
    // Only count leads where a human was actually needed (exclude bot_only/
    // no_customer and second-number contacts whose chat we can't read yet).
    if (l.status === "no_human_needed" || l.status === "channel_unavailable") { continue; }
    a.leads++;
    if (l.contacted) { a.contacted++; a.cost_contacted += l.est_cost_aed; }
    else {
      a.not_contacted++; a.cost_not_contacted += l.est_cost_aed;
      if (l.status === "expired_no_contact") a.expired++;
      if (l.after_hours) a.after_hours++; else a.negligence++;
      if (l.awaiting) a.awaiting++;
    }
    if (l.interested) a.interested++;
  }
  for (const a of Object.values(g)) {
    a.cost_contacted = Math.round(a.cost_contacted * 100) / 100;
    a.cost_not_contacted = Math.round(a.cost_not_contacted * 100) / 100;
    a.contact_rate_pct = a.leads ? Math.round((1000 * a.contacted) / a.leads) / 10 : 0;
  }
  return Object.values(g).sort((x, y) => y.leads - x.leads);
}

/**
 * Persist the trailing `days` of per-lead status into ads_lead_followup. Upsert
 * stamps contacted_at only on the first not-contacted -> contacted transition,
 * so a later report can flag "late contacts" (contacted after arrival day).
 * Returns { snapshotted }. Safe to run nightly.
 */
export async function snapshotContactStatus({ now = new Date(), days = 30 } = {}) {
  const until = new Date(now).toISOString().slice(0, 10);
  const since = new Date(new Date(now).getTime() - days * 86400000).toISOString().slice(0, 10);
  const { leads } = await gatherContactStatus(since, until, { now });
  if (!leads.length) return { snapshotted: 0 };

  const cols = ["wa_id", "created_date", "country", "owner", "contacted", "first_human_response_min",
    "after_hours", "status", "stage", "source_ad_id", "est_cost_aed", "first_seen_date"];
  const today = until;
  const values = [];
  const params = [];
  for (const l of leads) {
    values.push(`(${cols.map(() => "?").join(",")})`);
    params.push(l.wa_id, l.created_date, l.country, l.owner, l.contacted ? 1 : 0,
      l.first_human_response_min, l.after_hours ? 1 : 0, l.status, l.stage, l.source_ad_id,
      l.est_cost_aed, today);
  }
  // contacted_at: set to now() only when a row flips 0 -> 1; first_seen_date kept.
  await query(
    `insert into ads_lead_followup (${cols.join(",")}) values ${values.join(",")}
     as new on duplicate key update
       created_date=new.created_date, country=new.country, owner=new.owner,
       contacted_at = case when ads_lead_followup.contacted=0 and new.contacted=1 then now() else ads_lead_followup.contacted_at end,
       contacted=new.contacted, first_human_response_min=new.first_human_response_min,
       after_hours=new.after_hours, status=new.status, stage=new.stage,
       source_ad_id=new.source_ad_id, est_cost_aed=new.est_cost_aed, updated_at=now()`,
    params);
  return { snapshotted: leads.length };
}

export default { gatherContactStatus, rollup, snapshotContactStatus, readWorkHours, sanitizeWorkHours };
