// REG-108 — MySQL rejects "ON CONFLICT DO UPDATE / ON DUPLICATE KEY UPDATE"
// when the same primary key appears twice inside one INSERT statement
// ("21000: ON CONFLICT DO UPDATE command cannot affect row a second time" in
// the earlier Postgres-based layer; MySQL's INSERT...AS...ON DUPLICATE KEY
// UPDATE has the equivalent constraint). This happened during a full Wati
// backfill where the same wa_id appeared twice in one 500-row batch.
// `upsert()` must dedup by conflict key WITHIN a batch (keeping the LAST row)
// before ever building the SQL — mysql2 itself is mocked so this is a true
// unit test with zero network/DB dependency.
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn(async () => [[]]);

vi.mock("mysql2/promise", () => ({
  default: { createPool: () => ({ query: queryMock }) },
}));

// db.js refuses to build a pool against an unconfigured database rather than
// dialling a fabricated root@127.0.0.1, so this unit test has to say which
// database it is pretending to talk to. config is a mutable runtime object now
// — that is the whole point of the config refactor — so setting it directly is
// the idiomatic way to do that, and needs no module mock.
import config from "../src/config.js";
config.mysql = { host: "db.test", port: 3306, user: "u", password: "p", database: "testdb" };

const { upsert } = await import("../src/db.js");

beforeEach(() => queryMock.mockClear());

describe("REG-108: upsert() dedups duplicate conflict keys within a single batch", () => {
  it("sends only ONE row per conflict key even when the batch contains duplicates", async () => {
    const cols = ["wa_id", "full_name", "lead_score"];
    const rows = [
      ["wa1", "Old Name", 10],
      ["wa2", "Someone Else", 20],
      ["wa1", "New Name", 55], // duplicate wa_id within the SAME batch
    ];
    await upsert("ads_wati_contacts", cols, rows, ["wa_id"]);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    // 2 distinct wa_ids * 3 columns = 6 bound params, not 9 (which 3 raw rows would give)
    expect(params.length).toBe(6);
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
  });

  it("keeps the LAST occurrence of a duplicate key, not the first", async () => {
    const cols = ["wa_id", "lead_score"];
    const rows = [["wa1", 10], ["wa1", 99]];
    await upsert("ads_wati_contacts", cols, rows, ["wa_id"]);
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual(["wa1", 99]); // 99 (last), not 10 (first)
  });

  it("dedups on the composite conflict key, not the whole row", async () => {
    const cols = ["date", "level", "entity_id", "spend"];
    const rows = [
      ["2026-06-01", "campaign", "c1", 100],
      ["2026-06-01", "campaign", "c1", 250], // same (date,level,entity_id) key, different spend
      ["2026-06-01", "adset", "c1", 999], // different key (level differs) — must survive
    ];
    await upsert("ads_meta_daily", cols, rows, ["date", "level", "entity_id"]);
    const [, params] = queryMock.mock.calls[0];
    // 2 surviving rows * 4 cols = 8 params
    expect(params.length).toBe(8);
    expect(params).toContain(250); // the later duplicate's spend won
    expect(params).toContain(999); // the distinct-key row survived untouched
  });

  it("is a no-op (never calls query) for an empty row set", async () => {
    await upsert("ads_wati_contacts", ["wa_id"], [], ["wa_id"]);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
