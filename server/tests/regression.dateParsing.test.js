// REG-103 — Wati's getContacts "created" field arrives in an undocumented,
// non-ISO format ("Jun-21-2026"), plus a legacy .NET "/Date(ms)/" form seen in
// some tenants. Missing support (and once a missing `import re` in the old
// Python layer) meant every contact's created date silently parsed to null.
//
// REG-105 — a raw ISO string like "2026-06-24T12:07:41.747Z" written straight
// into a MySQL DATETIME column crashes the insert ("Incorrect datetime value").
// `wati.toDate()` must always return a real Date object (or null), never a
// pass-through string, so it's safe to hand to the DB layer.
import { describe, it, expect } from "vitest";
import { parseCreated, toDate } from "../src/lib/wati.js";

const withField = (name, value) => ({ customParams: [{ name, value }] });

describe("REG-103: parseCreated handles every observed Wati date format", () => {
  it("parses Wati's real 'Jun-21-2026' format (the undocumented one that broke ingestion)", () => {
    const d = parseCreated(withField("created", "Jun-21-2026"));
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(5); // June = index 5
    expect(d.getUTCDate()).toBe(21);
  });

  it("parses the legacy .NET '/Date(ms)/' form", () => {
    const ms = Date.UTC(2026, 5, 21).valueOf();
    const d = parseCreated(withField("created", `/Date(${ms})/`));
    expect(d.getTime()).toBe(ms);
  });

  it("parses a plain ISO date/time string", () => {
    const d = parseCreated(withField("createdAt", "2026-06-24T08:28:26.644Z"));
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCFullYear()).toBe(2026);
  });

  it("returns null (never throws) when no date-like field is present", () => {
    expect(parseCreated({ customParams: [] })).toBeNull();
  });

  it("returns null for unparseable garbage rather than an Invalid Date", () => {
    const d = parseCreated(withField("created", "not-a-date-at-all"));
    expect(d).toBeNull();
  });
});

describe("REG-105: toDate always yields a real Date object or null, never a raw string", () => {
  it("converts a millisecond-precision ISO timestamp (the exact string that once crashed MySQL)", () => {
    const d = toDate("2026-06-24T12:07:41.747Z");
    expect(d).toBeInstanceOf(Date);
    expect(typeof d).not.toBe("string");
    expect(d.toISOString()).toBe("2026-06-24T12:07:41.747Z");
  });

  it("returns null for falsy input", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate("")).toBeNull();
  });

  it("returns null for an unparseable string instead of an Invalid Date object", () => {
    expect(toDate("garbage")).toBeNull();
  });
});
