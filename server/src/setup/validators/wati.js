// Prove a Wati.io endpoint + token really work, and show the operator what we
// resolved — the tenant id, the contact count, the connected WhatsApp numbers.
//
// The endpoint is the field people get wrong, in three predictable ways: they
// paste the dashboard URL instead of the API host, they omit the tenant id, or
// they include the /api/v1 suffix. All three are detected and two are corrected
// automatically, with the correction shown rather than applied silently.
import axios from "axios";
import { fail, pass } from "../errorMap.js";

/** Tenant id out of the JWT payload, when the endpoint does not carry one. */
export function tenantFromToken(token) {
  try {
    const seg = String(token || "").split(".")[1];
    if (!seg) return null;
    const json = JSON.parse(Buffer.from(seg, "base64").toString("utf8"));
    return json.tenant_id ? String(json.tenant_id) : null;
  } catch {
    return null;
  }
}

/**
 * Clean up whatever the operator pasted, and say what we changed.
 * Returns { base, corrections: [code] }.
 */
export function normalizeEndpoint(rawEndpoint, token) {
  const corrections = [];
  let base = String(rawEndpoint || "").trim().replace(/\/+$/, "");

  if (/^https?:\/\/app\.wati\.io/i.test(base)) {
    return { base, corrections, dashboardUrl: true };
  }
  // A pasted ".../api/v1" suffix would double up on every request path.
  if (/\/api\/v\d+$/i.test(base)) {
    base = base.replace(/\/api\/v\d+$/i, "");
    corrections.push("WATI_ENDPOINT_SUFFIX_STRIPPED");
  }
  if (!/https?:\/\/[^/]+\/\d+/.test(base)) {
    const tenant = tenantFromToken(token);
    if (tenant) {
      base = `${base}/${tenant}`;
      corrections.push("WATI_TENANT_FIXED");
    }
  }
  return { base, corrections, dashboardUrl: false };
}

function classify(err) {
  const status = err?.response?.status;
  const body = err?.response?.data;
  if (status === 401 || status === 403) return "WATI_UNAUTHORIZED";
  if (status === 429) return "WATI_RATE_LIMITED";
  // Wati answers HTML when you hit the dashboard host instead of the API host.
  if (typeof body === "string" && /<html/i.test(body)) return "WATI_DASHBOARD_URL";
  const c = err?.code || "";
  if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT"].includes(c)) return "WATI_UNREACHABLE";
  return "UNKNOWN";
}

/** The business number a contact belongs to, from its whatsapp_<number> param. */
function channelOf(contact) {
  for (const p of contact?.customParams || []) {
    const m = /^whatsapp_(\d+)$/i.exec(p.name || "");
    if (m) return m[1];
  }
  return null;
}

export async function validate(input) {
  const token = String(input?.token || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail("WATI_UNAUTHORIZED", "no access token given");

  const { base, corrections, dashboardUrl } = normalizeEndpoint(input?.endpoint, token);
  if (dashboardUrl) return fail("WATI_DASHBOARD_URL", base);
  if (!base) return fail("WATI_UNREACHABLE", "no endpoint given");

  const http = axios.create({
    baseURL: base,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    timeout: 20000,
  });

  const details = { resolvedEndpoint: base, tenantId: tenantFromToken(token) };
  const warnings = [...corrections];

  // 1. Token + tenant together: getContacts is the cheapest proof of both.
  try {
    const r = await http.get("/api/v1/getContacts", { params: { pageSize: 1, pageNumber: 1 } });
    if (r.data?.result === false) return fail("WATI_UNAUTHORIZED", r.data?.info || "API returned result:false");
    details.contactCount = r.data?.link?.total ?? r.data?.result?.total ?? null;
  } catch (e) {
    return fail(classify(e), e?.response?.data?.info || e.message);
  }

  // 2. Template access proves the token is scoped to this tenant, not just valid.
  try {
    const r = await http.get("/api/v1/getMessageTemplates");
    const list = r.data?.messageTemplates || r.data?.result || [];
    details.templateCount = Array.isArray(list) ? list.length : null;
  } catch (e) {
    warnings.push(classify(e));
  }

  // 3. Which WhatsApp numbers are connected. Wati exposes no channel-list
  //    endpoint, so the honest way is to read one page of contacts and collect
  //    the distinct whatsapp_<number> params Wati stamps on each.
  try {
    const r = await http.get("/api/v1/getContacts", { params: { pageSize: 100, pageNumber: 1 } });
    const contacts = r.data?.contact_list || r.data?.result || [];
    const numbers = new Set();
    for (const c of Array.isArray(contacts) ? contacts : []) {
      const n = channelOf(c);
      if (n) numbers.add(n);
    }
    details.channels = [...numbers];
  } catch {
    details.channels = [];
  }

  return pass(details, warnings);
}

export default { validate, normalizeEndpoint, tenantFromToken };
