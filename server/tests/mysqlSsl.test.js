// Managed and self-hosted databases — Coolify, Railway, a compose MySQL behind
// a proxy — usually present a certificate nothing trusts. Without a way to say
// so, connecting failed with "self-signed certificate in certificate chain"
// reported as an unexpected error, which tells an operator nothing about what
// to change.
import { describe, it, expect } from "vitest";
import { sslOption, normalizeSsl, isTlsTrustError, SSL_MODES } from "../src/lib/mysqlSsl.js";
import { classify } from "../src/setup/validators/db.js";
import { parseMysqlUrl } from "../src/config.js";

describe("TLS modes", () => {
  it("sends no ssl option at all when encryption is off", () => {
    // Behaviour for everyone who does not need this must be unchanged.
    expect(sslOption({ mode: "off" })).toBeUndefined();
    expect(sslOption(null)).toBeUndefined();
  });

  it("encrypts without verifying when asked, and says so in the value", () => {
    expect(sslOption({ mode: "insecure" })).toEqual({ rejectUnauthorized: false });
  });

  it("verifies against a supplied CA", () => {
    const ca = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----";
    expect(sslOption({ mode: "verify", ca })).toEqual({ ca, rejectUnauthorized: true });
  });

  it("refuses verify mode with no certificate rather than silently not verifying", () => {
    // Quietly downgrading to unverified would be the opposite of what was asked.
    expect(() => sslOption({ mode: "verify", ca: "" })).toThrow(/CA/);
  });

  it("normalises anything stored or typed into one of the three modes", () => {
    expect(normalizeSsl(undefined)).toEqual({ mode: "off", ca: "" });
    expect(normalizeSsl("insecure")).toEqual({ mode: "insecure", ca: "" });
    expect(normalizeSsl({ mode: "nonsense" })).toEqual({ mode: "off", ca: "" });
    // A CA left over from a previous choice must not travel with another mode.
    expect(normalizeSsl({ mode: "insecure", ca: "stale" })).toEqual({ mode: "insecure", ca: "" });
    expect(SSL_MODES).toEqual(["off", "insecure", "verify"]);
  });
});

describe("a TLS trust failure is reported as a setting to change", () => {
  const err = (code, message = "") => Object.assign(new Error(message || code), { code });

  it.each([
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  ])("recognises %s", (code) => {
    expect(isTlsTrustError(err(code))).toBe(true);
    expect(classify(err(code))).toBe("DB_TLS_UNTRUSTED");
  });

  it("recognises it from the message alone, since drivers wrap errors", () => {
    // This is the exact text a real Coolify database produced.
    expect(classify(new Error("self-signed certificate in certificate chain"))).toBe("DB_TLS_UNTRUSTED");
  });

  it("does not mistake an ordinary connection failure for a TLS problem", () => {
    expect(classify(err("ECONNREFUSED"))).toBe("DB_CONN_REFUSED");
    expect(isTlsTrustError(err("ECONNREFUSED"))).toBe(false);
  });

  it("recognises a server that refuses unencrypted connections", () => {
    expect(classify(Object.assign(new Error("Connections using insecure transport are prohibited"), { errno: 3159 })))
      .toBe("DB_TLS_REQUIRED");
  });
});

describe("MYSQL_URL carries the mode too", () => {
  it("reads ?ssl= so an env-configured install is not worse off than the wizard", () => {
    const p = parseMysqlUrl("mysql://u:p@db.example.com:3306/app?ssl=insecure");
    expect(p.ssl.mode).toBe("insecure");
    expect(p.host).toBe("db.example.com");
  });

  it("defaults to off when the URL says nothing", () => {
    expect(parseMysqlUrl("mysql://u:p@h:3306/app").ssl.mode).toBe("off");
  });
});
