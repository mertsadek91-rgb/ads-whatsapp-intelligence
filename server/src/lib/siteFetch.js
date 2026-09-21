// Fetch a company's public website so the AI can learn what the business does.
//
// SECURITY — read this before changing anything here. This is the only place
// the server makes an HTTP request to a URL a user typed, which makes it the
// one genuine SSRF surface in the app. An unguarded fetcher would happily read
// http://169.254.169.254/ (cloud instance metadata, i.e. credentials),
// http://localhost:3306, or anything else inside the deployment's network, and
// hand the contents to an AI that writes them into a document an operator then
// reads. So: resolve DNS ourselves, refuse private and reserved addresses
// BEFORE the first request, and re-check after every redirect — a public
// hostname that redirects (or resolves) to 127.0.0.1 is the standard bypass.
import dns from "node:dns/promises";
import net from "node:net";
import axios from "axios";

export const MAX_PAGES = 6;
export const MAX_CHARS = 30000;
export const PER_PAGE_CHARS = 6000;
const TIMEOUT_MS = 10000;
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * The IPv4 address inside an IPv4-mapped IPv6 address, in either spelling:
 * ::ffff:127.0.0.1 (dotted) or ::ffff:7f00:1 (hex, which is what new URL()
 * produces). Returns null when there is none.
 */
export function embeddedIPv4(addr) {
  const a = String(addr || "").toLowerCase();
  const m = /^::ffff:(.+)$/.exec(a);
  if (!m) return null;
  const tail = m[1];
  if (tail.includes(".")) return /^\d+\.\d+\.\d+\.\d+$/.test(tail) ? tail : null;
  const groups = tail.split(":").filter(Boolean);
  if (!groups.length || groups.length > 2) return null;
  // Two 16-bit groups make the 32-bit address; a single group is the low half.
  const hi = groups.length === 2 ? parseInt(groups[0], 16) : 0;
  const lo = parseInt(groups.at(-1), 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
  const n = (hi << 16) | lo;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/** Private, loopback, link-local, and other ranges that must never be fetched. */
export function isPrivateAddress(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p[0] === 0) return true;                       // "this" network
    if (p[0] === 10) return true;                      // private
    if (p[0] === 127) return true;                     // loopback
    if (p[0] === 169 && p[1] === 254) return true;     // link-local / cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true;
    if (p[0] >= 224) return true;                      // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const a = ip.toLowerCase();
    if (a === "::1" || a === "::") return true;
    if (a.startsWith("fe80")) return true;             // link-local
    if (/^f[cd]/.test(a)) return true;                 // unique-local
    // IPv4-mapped addresses must be judged on the address they embed. Note that
    // new URL() rewrites ::ffff:127.0.0.1 into its hex form ::ffff:7f00:1, so
    // matching only the dotted spelling left a live SSRF bypass.
    const mapped = embeddedIPv4(a);
    if (mapped) return isPrivateAddress(mapped);
    return false;
  }
  return true;
}

/**
 * Throws unless the URL is a public http(s) address.
 * Called before the initial request and again for every redirect target.
 */
export async function assertPublicUrl(rawUrl, { resolver = dns } = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error("SITE_INVALID_URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("SITE_PRIVATE_ADDRESS");

  // A literal IP needs no lookup; a hostname does, and we judge every address
  // it resolves to, not just the first.
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await resolver.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new Error("SITE_UNREACHABLE");
    }
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("SITE_PRIVATE_ADDRESS");
  return u.toString();
}

/** Strip markup and script/style/nav chrome without pulling in a parser. */
export function extractText(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const titleOf = (html) => (String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();

// Pages worth reading, in both languages. A blog post tells the model far less
// about what the business sells than the about, pricing or terms pages.
const WORTH_READING = [
  /about|who-?we-?are|من-نحن|عن-الشركة/i,
  /service|product|pricing|plans|solutions|الخدمات|المنتجات|الأسعار|الباقات/i,
  /terms|legal|disclaimer|privacy|policy|الشروط|الأحكام|الخصوصية/i,
  /regulation|licen[cs]e|compliance|الترخيص|الامتثال/i,
  /contact|اتصل|تواصل/i,
];

/** Same-origin links, best candidates first. */
export function rankCandidatePages(html, originUrl) {
  const origin = new URL(originUrl);
  const seen = new Map();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1];
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    let abs;
    try { abs = new URL(href, origin); } catch { continue; }
    if (abs.origin !== origin.origin) continue;
    abs.hash = "";
    const key = abs.toString();
    if (key === originUrl || seen.has(key)) continue;
    const text = extractText(m[2]).slice(0, 80);
    const haystack = `${abs.pathname} ${text}`;
    const score = WORTH_READING.reduce((s, r, i) => (r.test(haystack) ? s + (WORTH_READING.length - i) : s), 0);
    if (score > 0) seen.set(key, score);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([url]) => url);
}

async function getPage(url) {
  const safe = await assertPublicUrl(url);
  const r = await axios.get(safe, {
    timeout: TIMEOUT_MS,
    maxRedirects: 0,                 // followed manually so each hop is re-checked
    maxContentLength: MAX_BYTES,
    responseType: "text",
    validateStatus: (s) => (s >= 200 && s < 400),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BusinessProfileBot/1.0)", "Accept-Language": "ar,en;q=0.8" },
  });
  if (r.status >= 300 && r.status < 400 && r.headers?.location) {
    const next = new URL(r.headers.location, safe).toString();
    await assertPublicUrl(next);     // the redirect bypass, closed
    return getPage(next);
  }
  return { url: safe, html: String(r.data || "") };
}

/**
 * Read the homepage plus up to a handful of the most informative pages.
 * Never throws for an unreachable site — returns warnings so the wizard can
 * carry on and build the profile from the operator's own description.
 */
export async function fetchSiteCorpus(rawUrl, { maxPages = MAX_PAGES, maxChars = MAX_CHARS } = {}) {
  const pages = [];
  const warnings = [];
  let home;
  try {
    home = await getPage(rawUrl);
  } catch (e) {
    const code = /SITE_[A-Z_]+/.exec(e.message)?.[0];
    if (code === "SITE_PRIVATE_ADDRESS") throw e;     // a refusal, not a soft failure
    if (e?.response?.status === 403 || e?.response?.status === 503) {
      warnings.push("SITE_BOT_BLOCKED");
    } else {
      warnings.push("SITE_UNREACHABLE");
    }
    return { pages: [], totalChars: 0, warnings };
  }

  const push = (url, html) => {
    const text = extractText(html).slice(0, PER_PAGE_CHARS);
    if (text.length < 40) return;
    pages.push({ url, title: titleOf(html), text, chars: text.length });
  };
  push(home.url, home.html);

  for (const link of rankCandidatePages(home.html, home.url).slice(0, maxPages - 1)) {
    if (pages.reduce((n, p) => n + p.chars, 0) >= maxChars) break;
    try {
      const p = await getPage(link);
      push(p.url, p.html);
    } catch { /* one unreadable sub-page is not worth failing the step for */ }
  }

  let totalChars = pages.reduce((n, p) => n + p.chars, 0);
  // Trim from the back — the homepage matters most.
  while (totalChars > maxChars && pages.length > 1) {
    totalChars -= pages.pop().chars;
  }
  // A site that renders entirely through JavaScript gives us almost nothing.
  if (totalChars < 400) warnings.push("SITE_UNREACHABLE");

  return { pages, totalChars, warnings };
}

export default { fetchSiteCorpus, assertPublicUrl, isPrivateAddress, extractText, rankCandidatePages, titleOf };
