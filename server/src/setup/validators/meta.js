// Prove a Meta (Facebook) Marketing API token really works, and give the
// operator pickers for the ad account and campaigns rather than asking them to
// paste numeric ids they have to hunt for in Ads Manager.
//
// The most valuable check here is the last one: a token can pass debug_token,
// carry ads_read, and still be unable to read insights for the account the
// operator chose. That is the single most common real-world failure, and
// finding it during setup rather than at 03:00 in the nightly job is the whole
// point of this step.
import axios from "axios";
import { fail, pass } from "../errorMap.js";
import { isTlsTrustError } from "../../lib/tlsTrust.js";

const graph = (v) => `https://graph.facebook.com/${v || "v21.0"}`;

/** A Graph API error object -> the code the wizard knows how to explain. */
export function classify(err) {
  if (isTlsTrustError(err)) return "TLS_INTERCEPTED";
  const fb = err?.response?.data?.error;
  if (!fb) {
    const c = err?.code || "";
    if (c === "ENOTFOUND" || c === "EAI_AGAIN" || c === "ECONNREFUSED" || c === "ETIMEDOUT") {
      return "AI_UNREACHABLE"; // shared "cannot reach the network" guidance
    }
    return "UNKNOWN";
  }
  const { code, error_subcode: sub, message = "" } = fb;
  if (code === 190) return "META_TOKEN_EXPIRED";        // incl. 463/467/458
  if (code === 200 || code === 3 || code === 10) {
    return code === 10 ? "META_APP_DEV_MODE" : "META_MISSING_PERMISSION";
  }
  if (code === 803 || (code === 100 && (sub === 33 || /does not exist|cannot be loaded/i.test(message)))) {
    return "META_BAD_AD_ACCOUNT";
  }
  if (code === 2635) return "META_DEPRECATED_VERSION";
  if ([4, 17, 32, 613].includes(code)) return "META_RATE_LIMITED";
  if (/redirect_uri/i.test(message)) return "META_REDIRECT_MISMATCH";
  return "UNKNOWN";
}

const msgOf = (e) => e?.response?.data?.error?.message || e?.message;
const normAcct = (id) => String(id || "").replace(/^act_/, "");

/**
 * input: { appId, appSecret, token, accountId?, apiVersion? }
 * Runs the checks in increasing order of specificity so the first failure is
 * the most informative one.
 */
export async function validate(input) {
  const v = input?.apiVersion || "v21.0";
  const token = String(input?.token || "").trim();
  if (!token) return fail("META_TOKEN_EXPIRED", "no access token given");

  const warnings = [];
  const details = {};

  // 1. What IS this token? Needs the app credentials to inspect properly.
  if (input?.appId && input?.appSecret) {
    try {
      const r = await axios.get(`${graph(v)}/debug_token`, {
        params: { input_token: token, access_token: `${input.appId}|${input.appSecret}` },
        timeout: 15000,
      });
      const d = r.data?.data || {};
      if (d.is_valid === false) return fail("META_TOKEN_EXPIRED", d.error?.message || "token reported invalid");
      const scopes = d.scopes || [];
      details.scopes = scopes;
      details.expiresAt = d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null;
      details.appId = d.app_id || null;
      if (!scopes.includes("ads_read")) return fail("META_MISSING_PERMISSION", `scopes: ${scopes.join(", ") || "none"}`);
      if (!scopes.includes("business_management")) warnings.push("META_MISSING_PERMISSION");
    } catch (e) {
      return fail(classify(e), msgOf(e));
    }
  } else {
    // Without app credentials we cannot inspect the token, only use it.
    warnings.push("META_MISSING_PERMISSION");
  }

  // 2. Which ad accounts can it see? This is the account picker.
  try {
    const r = await axios.get(`${graph(v)}/me/adaccounts`, {
      params: { access_token: token, limit: 100,
        fields: "id,account_id,name,account_status,currency,timezone_name" },
      timeout: 15000,
    });
    details.adAccounts = (r.data?.data || []).map((a) => ({
      id: normAcct(a.account_id || a.id),
      name: a.name,
      currency: a.currency,
      timezone: a.timezone_name,
      active: a.account_status === 1,
    }));
  } catch (e) {
    return fail(classify(e), msgOf(e));
  }

  const acct = normAcct(input?.accountId);
  if (!acct) {
    // Valid token, no account chosen yet — that is a normal wizard state.
    return pass({ ...details, accountId: null }, warnings);
  }

  // 3. Can it actually READ that account? debug_token passing proves nothing here.
  try {
    const r = await axios.get(`${graph(v)}/act_${acct}/insights`, {
      params: { access_token: token, date_preset: "last_7d", fields: "spend" },
      timeout: 20000,
    });
    details.accountId = acct;
    details.insightsReadable = true;
    details.recentSpend = r.data?.data?.[0]?.spend ?? null;
  } catch (e) {
    return fail(classify(e), msgOf(e));
  }

  // 4. Campaign picker, so the operator chooses by name rather than by id.
  try {
    const r = await axios.get(`${graph(v)}/act_${acct}/campaigns`, {
      params: { access_token: token, limit: 200, fields: "id,name,objective,effective_status" },
      timeout: 20000,
    });
    details.campaigns = (r.data?.data || []).map((c) => ({
      id: c.id, name: c.name, objective: c.objective, status: c.effective_status,
    }));
  } catch (e) {
    // Not fatal: insights already proved the account is readable.
    warnings.push(classify(e));
  }

  return pass(details, warnings);
}

/** The redirect URI that must be registered, shown verbatim with a copy button. */
export const redirectUri = (appBaseUrl) => `${String(appBaseUrl || "").replace(/\/$/, "")}/api/meta/callback`;

export default { validate, classify, redirectUri };
