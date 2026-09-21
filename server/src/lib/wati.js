// Wati API client — port of ingest_wati.py (tenant resolution, paging, fuzzy field
// lookup, the "Jun-21-2026" date format, messages, lastUpdated for incremental).
import axios from "axios";
import config from "../config.js";

const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

function ensureTenant(base, token) {
  base = (base || "").replace(/\/$/, "");
  if (/https?:\/\/[^/]+\/\d+/.test(base)) return base;
  try {
    const seg = token.split(".")[1];
    const json = JSON.parse(Buffer.from(seg, "base64").toString("utf8"));
    if (json.tenant_id) return `${base}/${json.tenant_id}`;
  } catch { /* ignore */ }
  return base;
}

// The client is rebuilt whenever the endpoint or token changes, rather than
// frozen at import. Memoised on the pair so the common case is still one
// object for the life of the process.
let _client = null, _clientKey = "";

export function watiBase() {
  return ensureTenant(config.wati.endpoint, config.wati.token);
}

function http() {
  const key = `${config.wati.endpoint}|${config.wati.token}`;
  if (!_client || _clientKey !== key) {
    _clientKey = key;
    _client = axios.create({
      baseURL: watiBase(),
      headers: { Authorization: `Bearer ${config.wati.token}`, "Content-Type": "application/json" },
      timeout: 40000,
    });
  }
  return _client;
}

/**
 * The business number a contact belongs to (from the whatsapp_<number> custom
 * param Wati stamps on every contact). Null if absent.
 */
export function channelOf(contact) {
  for (const p of contact.customParams || []) {
    const m = /^whatsapp_(\d+)$/i.exec(p.name || "");
    if (m) return m[1];
  }
  return null;
}

// Multi-number support (per Wati support): the SAME token reads every connected
// number; getMessages just needs ?channelPhoneNumber=<number> to pick which
// number's conversation to read. Without it the API defaults to the primary
// number and returns {result:false} for a contact on any other number.
const channelParams = (channel) => (channel ? { channelPhoneNumber: String(channel) } : {});

async function get(pathname, params = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await http().get(pathname, { params });
      return r.data;
    } catch (e) {
      if (e.response && e.response.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (attempt === 3) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Find a value by fuzzy-matching customParams then top-level keys. */
export function field(contact, ...names) {
  const wanted = new Set(names.map(norm));
  for (const p of contact.customParams || []) {
    if (wanted.has(norm(p.name))) return p.value;
  }
  for (const [k, v] of Object.entries(contact)) {
    if (wanted.has(norm(k)) && typeof v !== "object") return v;
  }
  return null;
}

export function parseCreated(c) {
  const raw = field(c, "created", "createdDate", "createdAt", "created_at", "firstContactDate", "creationTime");
  if (!raw) return null;
  const s = String(raw).trim();
  const mdate = s.match(/\/Date\((\d+)/);
  if (mdate) return new Date(parseInt(mdate[1], 10));
  // "Jun-21-2026" or "Jun 21, 2026"
  const m1 = s.match(/^([A-Za-z]{3})[\s-]+(\d{1,2})[,\s-]+(\d{4})/);
  if (m1 && MONTHS[m1[1].toLowerCase()] !== undefined) {
    return new Date(Date.UTC(+m1[3], MONTHS[m1[1].toLowerCase()], +m1[2]));
  }
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d) ? null : d;
}

export function toDate(s) {
  if (!s) return null;
  const d = new Date(String(s));
  return isNaN(d) ? null : d;
}

export function lastUpdated(c) {
  return toDate(c.lastUpdated || c.updatedAt);
}

/** Async generator over every contact (paged). */
export async function* iterContacts() {
  let page = 1;
  while (true) {
    const data = await get("/api/v1/getContacts", { pageSize: 100, pageNumber: page });
    const items = data.contact_list || data.contacts || data.result || [];
    if (!items.length) break;
    for (const c of items) yield c;
    if (items.length < 100) break;
    if (++page > 1000) break;
  }
}

/** First-response time (min), answered, message count, last message time.
 *  `channel` selects the connected number via ?channelPhoneNumber. Every number
 *  is readable with the primary token, so `unavailable` is always false now —
 *  kept in the return shape for backward compatibility. */
export async function firstResponse(waId, channel = null) {
  let j;
  try { j = await get(`/api/v1/getMessages/${waId}`, channelParams(channel)); }
  catch { return { fr: null, answered: false, n: 0, last: null, unavailable: false }; }
  let items = j?.messages?.items ?? j?.messages ?? [];
  if (!Array.isArray(items)) items = [];
  const inbound = items.find((m) => m.owner === false);
  const outbound = items.find((m) => m.owner === true);
  const last = items.length ? items[0].created : null;
  let fr = null;
  if (inbound?.created && outbound?.created) {
    const t0 = new Date(inbound.created), t1 = new Date(outbound.created);
    if (!isNaN(t0) && !isNaN(t1)) fr = Math.round(((t1 - t0) / 60000) * 10) / 10;
  }
  return { fr, answered: !!outbound, n: items.length, last, unavailable: false };
}

/** Full conversation thread, normalized & ascending. dir: 'in' (customer) | 'out' (agent). */
export async function getThread(waId, channel = null) {
  let j;
  try { j = await get(`/api/v1/getMessages/${waId}`, channelParams(channel)); }
  catch (e) {
    // BUG-026 fix: this used to fail silently, making a real API outage
    // indistinguishable from "this contact genuinely has no messages" —
    // both returned []. The `failed` marker lets callers tell the two apart
    // (JSON.stringify drops array properties, so API responses are unchanged);
    // consumers that only read .length keep working.
    console.error(`[wati] getThread(${waId}) failed: ${e.message}`);
    return Object.assign([], { failed: true });
  }
  let items = j?.messages?.items ?? j?.messages ?? [];
  if (!Array.isArray(items)) items = [];
  const out = [];
  for (const m of items) {
    if (m.eventType && m.eventType !== "message") continue; // skip ticket/system events
    if (m.owner !== true && m.owner !== false) continue;
    const body = m.text || (m.type && m.type !== "text" ? `[${m.type}]` : "");
    if (!body) continue;
    out.push({
      ts: m.created || null,
      dir: m.owner === true ? "out" : "in",
      sender: m.owner === true ? (m.operatorName || m.operatorEmail || "موظف").trim() : "العميل",
      type: m.type || "text",
      body,
    });
  }
  out.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return out;
}

/**
 * Assign a conversation to an operator (Wati user) by their LOGIN email.
 * POST /api/v1/assignOperator?email=<agent>&whatsappNumber=<customer>
 *
 * DANGER: Wati documents that omitting `email` assigns the chat to the BOT.
 * Callers must never pass an empty email — lib/watiAssign.js enforces that.
 * `channel` is passed through as channelPhoneNumber for multi-number accounts
 * (undocumented for this endpoint — verified per-account before bulk use).
 * Returns Wati's body, e.g. {result:true} or {result:false, info:"..."}.
 */
export async function assignOperator(waId, email, channel = null) {
  const params = { email, whatsappNumber: waId, ...channelParams(channel) };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await http().post("/api/v1/assignOperator", {}, { params, validateStatus: () => true });
      if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      if (r.status >= 500 && attempt < 2) { await sleep(800 * (attempt + 1)); continue; }
      if (r.status >= 400) return { result: false, info: `HTTP ${r.status}` };
      return r.data ?? { result: false, info: "empty response" };
    } catch (e) {
      if (attempt === 2) return { result: false, info: e.message };
      await sleep(800 * (attempt + 1));
    }
  }
  return { result: false, info: "retries exhausted" };
}

/**
 * Operator login emails seen in a contact's ticket events ("Chat is now
 * assigned to x@y.com"). Wati exposes no users/operators endpoint, so this is
 * how we discover the real Wati emails assignOperator needs.
 */
export async function operatorEmailsOf(waId, channel = null) {
  let j;
  try { j = await get(`/api/v1/getMessages/${waId}`, channelParams(channel)); }
  catch { return []; }
  const items = j?.messages?.items ?? [];
  const out = new Set();
  for (const m of Array.isArray(items) ? items : []) {
    for (const v of [m.assignee, m.detailedEventDescription?.agentName]) {
      if (typeof v === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())) out.add(v.trim().toLowerCase());
    }
  }
  return [...out];
}

/** Activity/timeline events (assignments, chatbot runs, status, expiry). Ascending. */
export async function getActivity(waId, channel = null) {
  let j;
  try { j = await get(`/api/v1/getMessages/${waId}`, channelParams(channel)); }
  catch (e) {
    console.error(`[wati] getActivity(${waId}) failed: ${e.message}`); // BUG-026 fix
    return Object.assign([], { failed: true });
  }
  let items = j?.messages?.items ?? j?.messages ?? [];
  if (!Array.isArray(items)) items = [];
  const out = [];
  for (const m of items) {
    if (m.eventType !== "ticket") continue;
    const txt = m.eventDescription || m.detailedEventDescription?.flowName || "";
    if (!txt) continue;
    out.push({ ts: m.created || null, text: String(txt), actor: m.actor || m.detailedEventDescription?.agentName || null });
  }
  out.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return out;
}

/**
 * Approved (and pending/rejected) message templates for a connected number.
 * GET /api/v1/getMessageTemplates?pageSize&pageNumber&channelPhoneNumber
 * Paged; returns every page up to a sane cap so callers don't have to.
 */
export async function getMessageTemplates(channel = null) {
  const out = [];
  let page = 1;
  while (true) {
    const data = await get("/api/v1/getMessageTemplates", { pageSize: 100, pageNumber: page, ...channelParams(channel) });
    const items = data?.messageTemplates || [];
    out.push(...items);
    const link = data?.link || {};
    if (items.length < 100 || !link.nextPage) break;
    if (++page > 50) break; // hard cap — this account has a handful of templates, not thousands
  }
  return out;
}

/**
 * Create and immediately run a broadcast to a specific list of contacts.
 * POST /api/v1/broadcast/createAndAddLinks?channelId=
 *
 * This is Wati's own dashboard's internal endpoint, reverse-engineered from a
 * live network capture — NOT the documented public REST API. The documented
 * `sendTemplateMessages` (whatsappNumber + template_name) reliably returned
 * "There are no valid Receivers" for every contact on this account, while
 * this is exactly what Wati's own UI calls and it works. Two consequences:
 *  - targets contacts by WATI'S OWN internal contact id
 *    (ads_wati_contacts.wati_contact_id), never by phone/wa_id;
 *  - templates by their internal id (see getMessageTemplates' `.id`), never
 *    by name.
 * Being undocumented, its shape could change without notice — this is the
 * one call in the app that carries that risk.
 */
export async function createBroadcast({ broadcastName, templateId, contactIds, quickReplyCount = 0 }) {
  const body = {
    id: "", broadcastName, templateId,
    selectedContactIds: contactIds, deselectedContactIds: [],
    IsAllSelected: false, IsAlwaysExcludeInValidContact: false,
    // Lets Wati silently drop contacts it can't message instead of failing
    // the whole batch — matches what Wati's own UI sends.
    IsExcludeInValidContact: true,
    IsROITrackingEnabled: false, ROITrackingDays: 2,
    // BUG fix: this used to hardcode 3 nulls regardless of the template,
    // which only happened to match the one template first tested against
    // (3 quick-reply buttons). A template with a different button mix — e.g.
    // one url button + two quick-replies — got "HTTP 400: Invalid broadcast
    // reaction setup" for its ENTIRE audience. The array length must match
    // the template's own quick-reply button count, not a fixed number.
    Reaction: { QuickReplies: Array(Math.max(0, quickReplyCount)).fill(null) },
    base64: "", filterAttributes: null, orFilterAttributes: null,
    // V1 scope is Single Send only — no auto-retry.
    isAutoFailedRetry: false, isCustomMediaHeader: false, isRichTemplate: false,
    mediaFromPC: "", mediaHeaderId: "", mediaHeaderType: "",
    scheduledAt: new Date().toISOString(), searchString: "",
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await http().post("/api/v1/broadcast/createAndAddLinks", body, {
        params: { channelId: "" }, validateStatus: () => true,
      });
      if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      if (r.status >= 500 && attempt < 2) { await sleep(800 * (attempt + 1)); continue; }
      // BUG fix: this used to discard Wati's actual response body on every
      // 4xx and report only "HTTP 400" — indistinguishable from a genuinely
      // empty response, and useless for telling one rejection reason from
      // another (a template/channel mismatch, an invalid contact id, a
      // country-level send restriction, ...). Surface whatever Wati sent.
      if (r.status >= 400) {
        // BUG fix: message/error/title covered the one 4xx body we'd seen
        // ("Invalid broadcast reaction setup"), but a later real failure came
        // back with a body shaped differently — those three all missed it and
        // it silently fell back to a bare "HTTP 400" again. Dump whatever's
        // actually there instead of assuming the field name.
        let detail = r.data?.message || r.data?.error || r.data?.title || null;
        if (!detail && typeof r.data === "string" && r.data.trim()) detail = r.data.trim();
        if (!detail && r.data && typeof r.data === "object" && Object.keys(r.data).length) {
          detail = JSON.stringify(r.data).slice(0, 300);
        }
        return { ok: false, error: detail ? `HTTP ${r.status}: ${detail}` : `HTTP ${r.status} (empty body)`, raw: r.data };
      }
      return r.data ?? { ok: false, error: "empty response" };
    } catch (e) {
      if (attempt === 2) return { ok: false, error: e.message };
      await sleep(800 * (attempt + 1));
    }
  }
  return { ok: false, error: "retries exhausted" };
}

// Was `export { BASE as WATI_BASE }` — a value frozen at import. Nothing ever
// imported it, so it becomes the function the setup wizard needs to show the
// operator which tenant URL their token actually resolves to.
export default {
  field, parseCreated, toDate, lastUpdated, iterContacts, firstResponse, watiBase,
  getMessageTemplates, createBroadcast,
};
