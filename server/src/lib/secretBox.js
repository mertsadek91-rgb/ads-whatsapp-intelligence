// Authenticated encryption for the credentials stored in app_config.
//
// Why encrypt at all, given the key lives on the same host: the realistic
// threat here is not someone with a shell in the container — they own the
// process either way — it is a MySQL dump, a leaked backup, or a read-only SQL
// foothold. Database credentials are shared far more widely than filesystem
// access, and this app already ships DB-backed tables people export. So the
// value of keeping the key out of the database is real, and the "the key sits
// next to the data" objection does not apply to the threat this defends
// against.
//
// AES-256-GCM, so tampering is detected rather than silently decrypted into
// something else. Envelope format: v1:<iv b64>:<tag b64>:<ciphertext b64>.
import crypto from "node:crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard

let keyProvider = () => process.env.APP_SECRET_KEY || "";

/** Lets the bootstrap layer supply a key generated into setup.json. */
export function setKeyProvider(fn) { keyProvider = fn; }

export function hasKey() {
  try { resolveKey(); return true; } catch { return false; }
}

function resolveKey() {
  const raw = String(keyProvider() || "");
  if (!raw) throw new Error("APP_SECRET_KEY is not set — cannot encrypt or decrypt stored credentials");
  // Accept a 64-char hex key (what we generate) or any passphrase, which is
  // stretched so a short one still produces a valid 32-byte key.
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

export function generateKey() {
  return crypto.randomBytes(32).toString("hex");
}

export function seal(plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, resolveKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext ?? ""), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

/**
 * Throws on a tampered or truncated envelope — never returns garbage.
 * A value that is not an envelope at all is returned unchanged, so a row
 * written before encryption was switched on still reads.
 */
export function open(envelope) {
  const s = String(envelope ?? "");
  if (!s.startsWith(VERSION + ":")) return s;
  const [, ivB64, tagB64, ctB64] = s.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("malformed encrypted value");
  const decipher = crypto.createDecipheriv(ALGO, resolveKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

export const isSealed = (v) => typeof v === "string" && v.startsWith(VERSION + ":");

/** Mask for display: never send a stored credential back to a browser. */
export function mask(plaintext) {
  const s = String(plaintext ?? "");
  if (!s) return "";
  return s.length <= 4 ? "••••" : "••••" + s.slice(-4);
}

export default { seal, open, isSealed, mask, generateKey, hasKey, setKeyProvider };
