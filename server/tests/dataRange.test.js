// "How far back do you want data?" is one question to the operator and two
// very different capabilities underneath. These pin the translation, because
// getting it wrong is silent: an import that quietly covers three months when
// the operator asked for three years looks exactly like a working import.
import { describe, it, expect } from "vitest";
import { normalizeSince, metaSince, watiSince, describeRange, ALL, META_MAX_MONTHS } from "../src/lib/dataRange.js";

const cfg = (since, over = {}) => ({ meta: { lookbackDays: 120 }, data: { since }, ...over });
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

describe("what the operator typed", () => {
  it("keeps a plain date", () => {
    expect(normalizeSince("2026-03-01")).toBe("2026-03-01");
  });

  it("treats blank as the default window rather than as 'everything'", () => {
    // An existing install with no DATA_SINCE must keep importing exactly what
    // it always did. Blank is not a request, it is the absence of one.
    expect(normalizeSince("")).toBe("");
    expect(normalizeSince(null)).toBe("");
    expect(normalizeSince(undefined)).toBe("");
  });

  it("recognises 'all' however it is cased", () => {
    expect(normalizeSince("ALL")).toBe(ALL);
    expect(normalizeSince(" all ")).toBe(ALL);
  });

  it("accepts a timestamp, because a date input can send one", () => {
    expect(normalizeSince("2026-03-01T00:00:00.000Z")).toBe("2026-03-01");
  });

  it("falls back to the default window on nonsense instead of throwing", () => {
    // This value comes out of a settings row. A bad one must not be able to
    // stop the nightly import.
    expect(normalizeSince("last tuesday")).toBe("");
  });
});

describe("what Meta is asked for", () => {
  it("uses the lookback window when nothing was chosen", () => {
    expect(metaSince(cfg(""))).toBe(daysAgo(120));
  });

  it("uses the chosen date", () => {
    expect(metaSince(cfg("2026-03-01"))).toBe("2026-03-01");
  });

  it("clamps 'everything' to Meta's real retention", () => {
    // Meta serves roughly 37 months of insights. Asking for 2010 is not an
    // error — it just returns nothing for the extra years while making the
    // request far slower, so the floor is honest rather than optimistic.
    const floor = daysAgo(META_MAX_MONTHS * 30);
    expect(metaSince(cfg(ALL))).toBe(floor);
    expect(metaSince(cfg("2010-01-01"))).toBe(floor);
  });
});

describe("what Wati is asked for", () => {
  it("has no lower bound for 'everything'", () => {
    expect(watiSince(cfg(ALL))).toBeNull();
  });

  it("has no lower bound when nothing was chosen", () => {
    // The default is a Meta REPORTING window. Applying it to conversation
    // history would throw away threads the operator never asked to lose.
    expect(watiSince(cfg(""))).toBeNull();
  });

  it("bounds the message fetch at the chosen date", () => {
    expect(watiSince(cfg("2026-03-01")).toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("what the operator is told", () => {
  it("states the range and whether message history is included, in both languages", () => {
    const on = describeRange({ ...cfg(ALL), data: { since: ALL, watiMessages: true } });
    expect(on.en).toMatch(/all available data.*including WhatsApp message history/);
    expect(on.ar).toMatch(/كل البيانات المتاحة/);

    const off = describeRange({ ...cfg("2026-03-01"), data: { since: "2026-03-01", watiMessages: false } });
    expect(off.en).toMatch(/since 2026-03-01, without message history/);
  });

  it("names the actual number of days when no range was chosen", () => {
    // "the default" tells the operator nothing they can act on.
    expect(describeRange(cfg("")).en).toMatch(/the last 120 days/);
  });
});
