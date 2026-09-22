// Which currency the stored numbers are in.
//
// Every money column is named `*_aed`, and ingestMeta writes Meta's `spend`
// into them verbatim — but Meta denominates spend in whatever the AD ACCOUNT
// is billed in. On a USD-billed account the columns held dollars, the label
// said dirhams, and the display layer then multiplied those dollars by a rate
// meaning "how many X equal one dirham". Two compounding errors, nothing on
// screen to suggest either.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeRates, DEFAULT_RATES } from "../src/lib/currency.js";

const rows = [];
const writes = [];
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params) => {
    if (/^\s*select/i.test(sql)) return rows;
    writes.push({ sql, params });
    return { affectedRows: 1 };
  }),
}));

const money = await import("../src/lib/money.js");

beforeEach(() => { rows.length = 0; writes.length = 0; money._resetCache(); });

describe("what the stored amounts are denominated in", () => {
  it("defaults to AED, so an installation predating this reads as it always did", async () => {
    // Its data really is in dirhams. Nothing should appear to change under it.
    expect(await money.baseCurrency()).toBe("AED");
  });

  it("reads what the ad account actually bills in", async () => {
    rows.push({ v: "USD" });
    expect(await money.baseCurrency()).toBe("USD");
  });

  it("records a change and says so, because every stored figure was mislabelled until then", async () => {
    const r = await money.setBaseCurrency("usd", { source: "test" });
    expect(r).toMatchObject({ currency: "USD", changed: true, previous: "AED" });
    expect(writes).toHaveLength(1);
    expect(writes[0].params).toEqual(["base_currency", "USD"]);
    expect(await money.baseCurrency()).toBe("USD");
  });

  it("writes nothing when the currency has not moved", async () => {
    rows.push({ v: "EUR" });
    const r = await money.setBaseCurrency("EUR");
    expect(r.changed).toBe(false);
    expect(writes).toEqual([]);
  });

  it("ignores a value that is not a currency code rather than storing it", async () => {
    // It arrives from a Graph response. A blank or an error string must not
    // become the label on every amount in the product.
    for (const bad of ["", null, "US Dollar", "$", "USDX"]) {
      const r = await money.setBaseCurrency(bad);
      expect(r.changed).toBe(false);
    }
    expect(writes).toEqual([]);
  });

  it("survives being asked before the schema exists", async () => {
    // baseCurrency() is read by the settings route, which can be hit during a
    // boot where ads_settings has not been created yet.
    const db = await import("../src/db.js");
    db.query.mockRejectedValueOnce(new Error("Table 'ads_settings' doesn't exist"));
    expect(await money.baseCurrency()).toBe("AED");
  });
});

describe("the rates are relative to that base, not to AED", () => {
  it("pins the base to exactly 1", () => {
    const r = sanitizeRates({ USD: 0.5, EUR: 0.9 }, "USD");
    expect(r.USD).toBe(1);
    expect(r.EUR).toBe(0.9);
  });

  it("no longer pins AED when AED is not the base", () => {
    // This was the bug: AED was pinned unconditionally, so on a USD account the
    // stored currency itself became convertible and was multiplied by a rate.
    const r = sanitizeRates({ AED: 3.67, USD: 0.27 }, "USD");
    expect(r.AED).toBe(3.67);
    expect(r.USD).toBe(1);
  });

  it("still pins AED on an AED installation", () => {
    expect(sanitizeRates({ AED: 99, USD: 0.27 }, "AED").AED).toBe(1);
  });

  it("falls back to AED for a base outside the known list", () => {
    expect(sanitizeRates({ USD: 0.27 }, "XYZ").AED).toBe(1);
  });

  it("still drops unknown currencies and impossible rates", () => {
    const r = sanitizeRates({ USD: 0.27, DOGE: 5, EUR: -1, GBP: "x" }, "AED");
    expect(Object.keys(r).sort()).toEqual(["AED", "USD"]);
  });

  it("ships starting rates that assume AED, which is why a non-AED base is flagged in the UI", () => {
    // Stated here so the assumption is not silent: on any other base these are
    // simply wrong until an admin edits them, and Settings says so.
    expect(DEFAULT_RATES.AED).toBe(1);
  });
});
