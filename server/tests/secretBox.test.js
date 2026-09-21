// Credentials in app_config are encrypted so a MySQL dump or a read-only SQL
// foothold does not hand over the Meta app secret, the Wati token and the
// DeepSeek key in plaintext.
import { describe, it, expect, beforeEach } from "vitest";
import * as box from "../src/lib/secretBox.js";

const KEY = "a".repeat(64);
beforeEach(() => box.setKeyProvider(() => KEY));

describe("secretBox", () => {
  it("round-trips a value", () => {
    const secret = "EAAG-super-secret-token";
    const sealed = box.seal(secret);
    expect(sealed).not.toContain(secret);
    expect(box.open(sealed)).toBe(secret);
  });

  it("produces a different ciphertext each time (fresh IV)", () => {
    expect(box.seal("same")).not.toBe(box.seal("same"));
  });

  it("detects tampering instead of decrypting to something else", () => {
    const sealed = box.seal("transfer-to-account-1");
    const parts = sealed.split(":");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 0xff;                       // flip a bit in the ciphertext
    parts[3] = ct.toString("base64");
    expect(() => box.open(parts.join(":"))).toThrow();
  });

  it("rejects a truncated envelope", () => {
    expect(() => box.open("v1:only:two")).toThrow(/malformed/);
  });

  it("passes through a plain value, so rows written before encryption still read", () => {
    expect(box.open("legacy-plaintext")).toBe("legacy-plaintext");
    expect(box.isSealed("legacy-plaintext")).toBe(false);
  });

  it("refuses to work with no key rather than silently storing plaintext", () => {
    box.setKeyProvider(() => "");
    expect(box.hasKey()).toBe(false);
    expect(() => box.seal("x")).toThrow(/APP_SECRET_KEY/);
  });

  it("accepts a passphrase as well as a hex key", () => {
    box.setKeyProvider(() => "a short human passphrase");
    expect(box.open(box.seal("value"))).toBe("value");
  });

  it("cannot open a value sealed under a different key", () => {
    const sealed = box.seal("value");
    box.setKeyProvider(() => "b".repeat(64));
    expect(() => box.open(sealed)).toThrow();
  });

  it("generates a 256-bit hex key", () => {
    expect(box.generateKey()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("masks a credential for display without revealing it", () => {
    expect(box.mask("EAAG-super-secret-token")).toBe("••••oken");
    expect(box.mask("abc")).toBe("••••");
    expect(box.mask("")).toBe("");
  });
});
