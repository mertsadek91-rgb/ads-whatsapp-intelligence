// Tiny fetch wrapper. All requests are same-origin (cookies carry the session).

// The server localizes whatever it renders itself — report labels, export
// headers, enum values, error messages — and reads the language off
// Accept-Language. The i18n provider pushes the current choice here on every
// change so no individual call site has to remember to pass ?lang.
let acceptLanguage = "ar";
export function setApiLang(lang) { acceptLanguage = lang === "en" ? "en" : "ar"; }
export function apiLang() { return acceptLanguage; }

async function req(method, path, body) {
  const opts = { method, headers: { "Accept-Language": acceptLanguage }, credentials: "same-origin" };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`/api${path}`, opts);
  if (r.status === 401) {
    const err = new Error("unauthorized");
    err.status = 401;
    throw err;
  }
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || "خطأ في الخادم");
  return data;
}

export const api = {
  me: () => req("GET", "/auth/me"),
  login: (email, password) => req("POST", "/auth/login", { email, password }),
  logout: () => req("POST", "/auth/logout"),
  get: (p) => req("GET", p),
  patch: (p, b) => req("PATCH", p, b),
  put: (p, b) => req("PUT", p, b),
  post: (p, b) => req("POST", p, b),
  del: (p) => req("DELETE", p),
};
export default api;
