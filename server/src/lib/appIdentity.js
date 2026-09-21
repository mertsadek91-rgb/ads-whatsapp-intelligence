// What this installation calls itself.
//
// The product used to carry one company's name in eleven places — report
// headers, email subjects, the sidebar, the login page, the kiosk footer, the
// browser title. None of it was configurable, so every new installation would
// have announced itself as somebody else's business.
//
// Stored in the existing ads_settings key/value table rather than a new one:
// this is a handful of display strings, and ads_settings is already the home
// for runtime-editable app settings (currency rates, kiosk token, work hours).
import { query } from "../db.js";

export const IDENTITY_KEY = "app_identity";

// Deliberately generic. A fresh install says what it is, not who it belongs to,
// until somebody fills this in.
export const DEFAULT_IDENTITY = {
  appName: "لوحة التحليلات",
  appNameEn: "Analytics",
  tagline: "الإعلانات × واتساب",
  taglineEn: "Ads × WhatsApp",
  monogram: "AW",
  logoUrl: null,
  primaryColor: null,          // null = keep the stylesheet's own accent
  senderName: "",              // display name on outgoing report emails
  reportFooter: "",
};

const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

const str = (v, fallback = "") => (typeof v === "string" ? v.trim() : fallback);

export function sanitizeIdentity(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = {
    appName: str(r.appName) || DEFAULT_IDENTITY.appName,
    appNameEn: str(r.appNameEn) || DEFAULT_IDENTITY.appNameEn,
    tagline: str(r.tagline, DEFAULT_IDENTITY.tagline),
    taglineEn: str(r.taglineEn, DEFAULT_IDENTITY.taglineEn),
    monogram: str(r.monogram).slice(0, 3) || DEFAULT_IDENTITY.monogram,
    logoUrl: str(r.logoUrl) || null,
    // Only a hex colour: this value is interpolated into a CSS custom property,
    // so anything else would be an injection point.
    primaryColor: /^#[0-9a-fA-F]{6}$/.test(str(r.primaryColor)) ? str(r.primaryColor) : null,
    senderName: str(r.senderName),
    reportFooter: str(r.reportFooter),
  };
  return out;
}

/** Cached for a minute — this is read on every report render and page load. */
export async function getIdentity({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cachedAt < TTL_MS) return cache;
  try {
    const rows = await query("select v from ads_settings where k = ?", [IDENTITY_KEY]);
    cache = sanitizeIdentity(rows.length ? JSON.parse(rows[0].v) : null);
  } catch {
    // Branding must never be the reason a report fails to render.
    cache = { ...DEFAULT_IDENTITY };
  }
  cachedAt = Date.now();
  return cache;
}

export async function saveIdentity(patch) {
  const next = sanitizeIdentity({ ...(await getIdentity({ fresh: true })), ...(patch || {}) });
  await query(
    `insert into ads_settings (k, v) values (?, ?)
     as new on duplicate key update v = new.v, updated_at = now()`,
    [IDENTITY_KEY, JSON.stringify(next)]);
  cache = next;
  cachedAt = Date.now();
  return next;
}

/** The name to show, in the language being rendered. */
export const displayName = (identity, lang = "ar") =>
  (lang === "en" ? identity.appNameEn : identity.appName) || identity.appName || DEFAULT_IDENTITY.appName;

export const displayTagline = (identity, lang = "ar") =>
  (lang === "en" ? identity.taglineEn : identity.tagline) || "";

/** Only what a signed-out page (the login screen) needs. */
export const publicIdentity = (identity) => ({
  appName: identity.appName,
  appNameEn: identity.appNameEn,
  tagline: identity.tagline,
  taglineEn: identity.taglineEn,
  monogram: identity.monogram,
  logoUrl: identity.logoUrl,
  primaryColor: identity.primaryColor,
});

export function _resetCache() { cache = null; cachedAt = 0; }

export default {
  getIdentity, saveIdentity, sanitizeIdentity, displayName, displayTagline,
  publicIdentity, DEFAULT_IDENTITY, IDENTITY_KEY, _resetCache,
};
