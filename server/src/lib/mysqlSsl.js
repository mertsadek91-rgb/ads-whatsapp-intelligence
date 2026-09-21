// How the app talks TLS to MySQL.
//
// Managed and self-hosted databases (Coolify, Railway, a docker-compose MySQL
// behind a proxy) very often present a certificate signed by nothing Node
// trusts. Connecting then fails with "self-signed certificate in certificate
// chain", which says nothing about what to do next.
//
// There are three honest answers, and the operator has to pick one, because
// they are not equivalent:
//
//   off      — no TLS. Fine over a private network or a localhost socket;
//              everything, including the password, is readable on the wire.
//   insecure — TLS, but the certificate is not verified. The traffic is
//              encrypted, and an attacker who can intercept the connection can
//              still impersonate the database. This is what "just make it work"
//              means, and it is a real trade, not a formality.
//   verify   — TLS with the server's CA certificate supplied. Encrypted AND
//              authenticated. The right answer when the CA is available.
import { isTlsTrustError } from "./tlsTrust.js";

// Re-exported so callers dealing with a MySQL connection have one import.
export { isTlsTrustError };

export const SSL_MODES = ["off", "insecure", "verify"];

/**
 * mysql2's `ssl` option for a stored setting.
 * Returns undefined for "off" so the driver behaves exactly as before.
 */
export function sslOption(ssl) {
  if (!ssl || ssl.mode === "off" || ssl === "off") return undefined;
  const mode = ssl.mode || ssl;
  if (mode === "verify") {
    const ca = String(ssl.ca || "").trim();
    // Without a CA there is nothing to verify against, and silently falling
    // back to unverified would be the opposite of what was asked for.
    if (!ca) throw new Error("شهادة CA مطلوبة عند اختيار التحقّق (a CA certificate is required for verify mode)");
    return { ca, rejectUnauthorized: true };
  }
  // insecure
  return { rejectUnauthorized: false };
}

/** Normalise whatever the wizard or a stored record holds. */
export function normalizeSsl(raw) {
  if (!raw) return { mode: "off", ca: "" };
  if (typeof raw === "string") return { mode: SSL_MODES.includes(raw) ? raw : "off", ca: "" };
  const mode = SSL_MODES.includes(raw.mode) ? raw.mode : "off";
  return { mode, ca: mode === "verify" ? String(raw.ca || "").trim() : "" };
}

export default { SSL_MODES, sslOption, normalizeSsl, isTlsTrustError };
