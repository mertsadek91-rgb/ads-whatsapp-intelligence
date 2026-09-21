// BUG-040 — CSV exports (routes/leads.js /export.csv, routes/report.js
// /re-engagement.csv) used to load every matching row into memory and build
// the whole response string before sending. streamCsv() paginates the same
// query in bounded batches and writes as it goes.
import { describe, it, expect, vi, beforeEach } from "vitest";

const allRows = Array.from({ length: 5 }, (_, i) => ({ name: `Row ${i}`, note: 'has "quotes", and a comma' }));
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql) => {
    const m = sql.match(/limit (\d+) offset (\d+)/);
    if (!m) return allRows;
    const [, limit, offset] = m;
    return allRows.slice(Number(offset), Number(offset) + Number(limit));
  }),
}));

const { query } = await import("../src/db.js");
const { streamCsv, csvEscape } = await import("../src/lib/csvStream.js");

function fakeRes() {
  const written = [];
  return {
    written,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    write(chunk) { written.push(chunk); },
    end() { this.ended = true; },
  };
}

beforeEach(() => { query.mockClear(); });

describe("BUG-040: streamCsv paginates instead of loading everything into memory", () => {
  it("escapes quotes and commas correctly", () => {
    expect(csvEscape('has "quotes", and a comma')).toBe('"has ""quotes"", and a comma"');
    expect(csvEscape(null)).toBe('""');
    expect(csvEscape(undefined)).toBe('""');
  });

  it("fetches in batches (multiple queries with increasing offset) instead of one unbounded query", async () => {
    const res = fakeRes();
    await streamCsv(res, { sql: "select * from x", cols: ["name", "note"], filename: "x.csv", batchSize: 2 });

    // 5 rows / batch size 2 -> batches of 2,2,1 -> 3 query calls
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][0]).toMatch(/limit 2 offset 0/);
    expect(query.mock.calls[1][0]).toMatch(/limit 2 offset 2/);
    expect(query.mock.calls[2][0]).toMatch(/limit 2 offset 4/);
  });

  it("writes a BOM+header row, then one escaped CSV line per row, then ends the response", async () => {
    const res = fakeRes();
    await streamCsv(res, { sql: "select * from x", cols: ["name", "note"], filename: "x.csv", batchSize: 10 });

    // Headers are quoted like any other cell — a localized title may itself
    // contain a comma, which would otherwise split into two columns.
    expect(res.written[0]).toBe('﻿"name","note"\n');
    expect(res.written).toHaveLength(1 + allRows.length); // header + one line per row
    expect(res.written[1]).toBe('"Row 0","has ""quotes"", and a comma"\n');
    expect(res.ended).toBe(true);
    expect(res.headers["Content-Disposition"]).toContain("x.csv");
  });

  it("prints localized `headers` instead of the raw column keys when given them", async () => {
    const res = fakeRes();
    await streamCsv(res, { sql: "select * from x", cols: ["name", "note"],
      headers: ["الاسم", "ملاحظات"], filename: "x.csv", batchSize: 10 });
    expect(res.written[0]).toBe('﻿"الاسم","ملاحظات"\n');
  });

  it("ignores a `headers` list that does not line up with `cols`", async () => {
    const res = fakeRes();
    await streamCsv(res, { sql: "select * from x", cols: ["name", "note"],
      headers: ["only one"], filename: "x.csv", batchSize: 10 });
    expect(res.written[0]).toBe('﻿"name","note"\n');
  });

  it("runs `map` over every cell — how enum values become readable labels", async () => {
    const res = fakeRes();
    await streamCsv(res, { sql: "select * from x", cols: ["name"],
      map: (col, v) => `${col}=${v}`, filename: "x.csv", batchSize: 10 });
    expect(res.written[1]).toBe('"name=Row 0"\n');
  });

  it("stops as soon as a batch comes back shorter than batchSize", async () => {
    const res = fakeRes();
    await streamCsv(res, { sql: "select * from x", cols: ["name"], filename: "x.csv", batchSize: 3 });
    // 5 rows / batchSize 3 -> batch of 3 (full, keep going), then batch of 2 (< 3, stop) -> 2 calls
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("makes one harmless extra empty-result query when the total is an exact multiple of batchSize", async () => {
    const res = fakeRes();
    await streamCsv(res, { sql: "select * from x", cols: ["name"], filename: "x.csv", batchSize: 5 });
    // 5 rows, batchSize 5 -> one full batch (can't yet know it's the last page), then an empty batch confirms it
    expect(query).toHaveBeenCalledTimes(2);
  });
});
