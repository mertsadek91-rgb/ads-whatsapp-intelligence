// Fetch wrapper for the wizard.
//
// Separate from src/api.js on purpose: that one carries the session cookie and
// throws on 401, neither of which applies here. The wizard runs before any
// session exists and authenticates with the install token instead.
let installToken = "";
let claimId = "";

export function setInstallToken(t) { installToken = String(t || "").trim(); }
export function getInstallToken() { return installToken; }
export function setClaimId(id) { claimId = String(id || ""); }
export function getClaimId() { return claimId; }

async function req(method, path, body) {
  const headers = { "Accept-Language": document.documentElement.lang || "ar" };
  if (installToken) headers.Authorization = `Bearer ${installToken}`;
  if (claimId) headers["X-Setup-Claim"] = claimId;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let r;
  try {
    r = await fetch(`/api/setup${path}`, {
      method, headers, credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    // A dropped connection rejects here. No caller in the wizard has a catch —
    // they are all try/finally — so this used to surface as absolutely nothing:
    // the button flickered and the screen stayed as it was. Two steps make it
    // likely, because both restart plumbing mid-request: the database step
    // resets the connection pool, and Finish activates the whole runtime.
    return { status: 0, ok: false, data: {
      ok: false,
      ar: `تعذّر الوصول إلى الخادم (${e.message}). قد يكون قيد إعادة التشغيل — أعِد المحاولة بعد لحظات.`,
      en: `Could not reach the server (${e.message}). It may be restarting — try again in a moment.`,
    } };
  }

  let data;
  try {
    data = await r.json();
  } catch {
    // Not JSON: a proxy's HTML error page, or an empty body. Collapsing that to
    // {} threw the status away and rendered a generic "unexpected error" that
    // told the operator, and anyone they sent the screenshot to, nothing.
    data = r.ok ? {} : {
      ok: false,
      ar: `الخادم ردّ بحالة ${r.status} بدون رسالة مفهومة.`,
      en: `The server answered ${r.status} with no readable message.`,
      detail: `HTTP ${r.status}`,
    };
  }
  // A failed validation is a normal, expected answer — the step renders its
  // guidance rather than treating it as an exception.
  return { status: r.status, ok: r.ok, data };
}

export const setupApi = {
  status: () => req("GET", "/status"),
  claim: (takeover = false) => req("POST", `/claim${takeover ? "?takeover=1" : ""}`, {}),
  test: (step, body) => req("POST", `/${step}/test`, body),
  save: (step, body) => req("POST", `/${step}/save`, body),
  createDatabase: (body) => req("POST", "/db/create-database", body),
  migrate: () => req("POST", "/db/migrate", {}),
  generateProfile: (body) => req("POST", "/business/generate", body),
  approveProfile: (profile) => req("POST", "/business/approve", { profile }),
  skip: (step) => req("POST", `/${step}/skip`, {}),
  fetchBusiness: (body) => req("POST", "/business/fetch", body),
  metaOauthStart: (body) => req("POST", "/meta/oauth/start", body),
  finish: (body) => req("POST", "/finish", body),
};

export default setupApi;
