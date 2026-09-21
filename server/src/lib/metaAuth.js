// Self-managing Meta authentication.
// - Stores the access token + expiry in ads_settings (survives restarts).
// - Auto-upgrades any short-lived token to a long-lived (~60d) one (needs App ID/Secret).
// - Auto-refreshes (re-exchanges) before expiry via the daily job.
// - Supports a one-click OAuth "connect" flow and manual token paste.
import axios from "axios";
import config from "../config.js";
import { query } from "../db.js";

// Function, not a const: the API version is reconfigurable at runtime.
const GRAPH = () => `https://graph.facebook.com/${config.meta.apiVersion}`;
const KEY_TOKEN = "meta_access_token";
const KEY_EXP = "meta_token_expires_at";

async function getSetting(k) {
  const r = await query("select v from ads_settings where k=?", [k]);
  return r[0]?.v ?? null;
}
async function setSetting(k, v) {
  await query(
    "insert into ads_settings (k, v) values (?, ?) as new on duplicate key update v=new.v, updated_at=now()",
    [k, v]
  );
}
async function delSetting(k) { await query("delete from ads_settings where k=?", [k]); }

export function appConfigured() { return !!(config.meta.appId && config.meta.appSecret); }
function appAccessToken() { return `${config.meta.appId}|${config.meta.appSecret}`; }

/** Current best token: DB (live/refreshed) first, else the .env seed. */
export async function getToken() {
  return (await getSetting(KEY_TOKEN)) || config.meta.token || null;
}
async function getExpiry() {
  const v = await getSetting(KEY_EXP);
  return v ? Number(v) : null;
}
async function storeToken(token, expiresInSec) {
  await setSetting(KEY_TOKEN, token);
  if (expiresInSec) await setSetting(KEY_EXP, String(Date.now() + expiresInSec * 1000));
  return expiresInSec ? Date.now() + expiresInSec * 1000 : null;
}

function fbErr(e) {
  return e.response?.data?.error?.message || e.message || String(e);
}

export async function debugToken(token) {
  const r = await axios.get(`${GRAPH()}/debug_token`,
    { params: { input_token: token, access_token: appAccessToken() }, timeout: 30000 });
  return r.data.data; // { is_valid, expires_at, scopes, app_id, ... }
}

export async function exchangeForLongLived(shortToken) {
  const r = await axios.get(`${GRAPH()}/oauth/access_token`, {
    params: {
      grant_type: "fb_exchange_token",
      client_id: config.meta.appId,
      client_secret: config.meta.appSecret,
      fb_exchange_token: shortToken,
    }, timeout: 30000,
  });
  return r.data; // { access_token, token_type, expires_in }
}

/** Adopt any token: upgrade to long-lived if possible, learn expiry, store. */
export async function adoptToken(token) {
  if (!token) throw new Error("توكن فارغ");
  if (appConfigured()) {
    try {
      const ex = await exchangeForLongLived(token);
      const expiresAt = await storeToken(ex.access_token, ex.expires_in);
      return { ok: true, longLived: true, expiresAt };
    } catch (e) {
      // exchange may fail if token already long-lived/invalid — fall through
      try {
        const d = await debugToken(token);
        if (!d.is_valid) throw new Error("توكن غير صالح: " + fbErr(e));
        const sec = d.expires_at ? d.expires_at - Math.floor(Date.now() / 1000) : null;
        const expiresAt = await storeToken(token, sec > 0 ? sec : null);
        return { ok: true, longLived: false, expiresAt };
      } catch (e2) {
        throw new Error(fbErr(e2));
      }
    }
  }
  await storeToken(token, null);
  return { ok: true, longLived: false, expiresAt: null, note: "no_app_creds" };
}

/** Refresh before expiry. Safe to call daily. */
export async function ensureFresh() {
  if (!appConfigured()) return { refreshed: false, reason: "no_app_creds" };
  const token = await getToken();
  if (!token) return { refreshed: false, reason: "no_token" };
  let exp = await getExpiry();
  if (!exp) { try { const d = await debugToken(token); if (d.expires_at) exp = d.expires_at * 1000; } catch { /* */ } }
  const daysLeft = exp ? (exp - Date.now()) / 86400000 : 999;
  if (daysLeft < 10) {
    try {
      const ex = await exchangeForLongLived(token);
      const expiresAt = await storeToken(ex.access_token, ex.expires_in);
      return { refreshed: true, expiresAt };
    } catch (e) { return { refreshed: false, error: fbErr(e) }; }
  }
  return { refreshed: false, daysLeft: Math.round(daysLeft) };
}

export async function status() {
  const token = await getToken();
  const base = { appConfigured: appConfigured(), accountId: config.meta.accountId,
    redirectUri: `${config.appBaseUrl}/api/meta/callback` };
  if (!token) return { ...base, connected: false };
  let valid = null, expiresAt = await getExpiry(), scopes = null, error = null;
  if (appConfigured()) {
    try {
      const d = await debugToken(token);
      valid = d.is_valid;
      if (d.expires_at) expiresAt = d.expires_at * 1000;
      scopes = d.scopes;
    } catch (e) { error = fbErr(e); }
  }
  const daysLeft = expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 86400000)) : null;
  return { ...base, connected: true, valid, expiresAt, daysLeft, scopes, error };
}

export async function disconnect() {
  await delSetting(KEY_TOKEN);
  await delSetting(KEY_EXP);
  return { ok: true };
}

export function buildAuthUrl(state) {
  const p = new URLSearchParams({
    client_id: config.meta.appId,
    redirect_uri: `${config.appBaseUrl}/api/meta/callback`,
    scope: config.meta.scopes,
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/${config.meta.apiVersion}/dialog/oauth?${p.toString()}`;
}

export async function handleCallback(code) {
  const r = await axios.get(`${GRAPH()}/oauth/access_token`, {
    params: {
      client_id: config.meta.appId,
      client_secret: config.meta.appSecret,
      redirect_uri: `${config.appBaseUrl}/api/meta/callback`,
      code,
    }, timeout: 30000,
  });
  return adoptToken(r.data.access_token);
}

export default { getToken, appConfigured, adoptToken, ensureFresh, status, disconnect, buildAuthUrl, handleCallback, debugToken };
