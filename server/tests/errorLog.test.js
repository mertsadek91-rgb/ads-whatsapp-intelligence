// BUG-017 slice 2 — route errors are persisted to ads_error_logs via the
// shared wrap() (console output dies with the container; the table doesn't),
// and both log tables get 90-day retention via cleanupLogs().
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const inserts = [];
const deletes = [];
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    if (sql.startsWith("insert into ads_error_logs")) { inserts.push(params); return {}; }
    if (sql.startsWith("delete from ads_api_logs")) { deletes.push(sql); return { affectedRows: 12 }; }
    if (sql.startsWith("delete from ads_error_logs")) { deletes.push(sql); return { affectedRows: 3 }; }
    throw new Error("unexpected query: " + sql);
  }),
}));

const { wrap } = await import("../src/lib/wrap.js");
const { cleanupLogs } = await import("../src/lib/errorLog.js");

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => { inserts.length = 0; deletes.length = 0; });

describe("BUG-017 slice 2: wrap() persists route errors to ads_error_logs", () => {
  it("logs method/path/message/user and still answers 500", async () => {
    const app = express();
    app.use((req, res, next) => { req.session = { email: "op@istmarkets.com" }; next(); });
    app.get("/api/x", wrap(async () => { throw new Error("boom"); }));

    const res = await request(app).get("/api/x?secret=1");
    await flush();

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("boom");
    expect(inserts).toHaveLength(1);
    const [method, path, message, stack, email] = inserts[0];
    expect(method).toBe("GET");
    expect(path).toBe("/api/x"); // query string stripped
    expect(message).toBe("boom");
    expect(stack).toMatch(/Error: boom/);
    expect(email).toBe("op@istmarkets.com");
  });

  it("just ends the response (still logging) when headers were already sent", async () => {
    const app = express();
    app.get("/api/stream", wrap(async (req, res) => {
      res.setHeader("Content-Type", "text/csv");
      res.write("header\n");
      throw new Error("mid-stream failure");
    }));

    const res = await request(app).get("/api/stream");
    await flush();

    expect(res.status).toBe(200); // headers already committed
    expect(res.text).toBe("header\n"); // no JSON error appended
    expect(inserts).toHaveLength(1);
    expect(inserts[0][2]).toBe("mid-stream failure");
  });
});

describe("BUG-017 slice 2: cleanupLogs retention", () => {
  it("purges both log tables with the given retention window and reports counts", async () => {
    const result = await cleanupLogs(90);
    expect(deletes).toHaveLength(2);
    expect(deletes[0]).toMatch(/interval 90 day/);
    expect(result).toEqual({ api_logs: 12, error_logs: 3 });
  });
});
