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

async function req(method, path, body) {
  const headers = { "Accept-Language": document.documentElement.lang || "ar" };
  if (installToken) headers.Authorization = `Bearer ${installToken}`;
  if (claimId) headers["X-Setup-Claim"] = claimId;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const r = await fetch(`/api/setup${path}`, {
    method, headers, credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data;
  try { data = await r.json(); } catch { data = {}; }
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
  finish: (body) => req("POST", "/finish", body),
};

export default setupApi;
