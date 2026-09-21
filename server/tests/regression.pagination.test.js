// BUG-031 stage 2 (offset pagination) + BUG-032 stage 2 (server-side post
// search past the dropdown's 400-item cap).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const calls = [];
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("count(*) total")) return [{ total: 700 }];
    if (sql.includes("select distinct source_url v")) {
      return [{ v: "https://instagram.com/p/abc/" }];
    }
    return [];
  }),
}));

const conversationsRouter = (await import("../src/routes/conversations.js")).default;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/conversations", conversationsRouter);
  return app;
}

beforeEach(() => { calls.length = 0; });

describe("BUG-031: GET /conversations supports offset pagination", () => {
  it("applies the offset to the rows query and echoes it back", async () => {
    const res = await request(buildApp()).get("/conversations?offset=300");
    expect(res.status).toBe(200);
    const listCall = calls.find((c) => c.sql.includes("order by coalesce"));
    expect(listCall.sql).toMatch(/limit 300 offset 300/);
    expect(res.body.offset).toBe(300);
    expect(res.body.total).toBe(700);
  });

  it("clamps a negative or garbage offset to 0 instead of erroring or injecting", async () => {
    await request(buildApp()).get("/conversations?offset=-50");
    expect(calls.find((c) => c.sql.includes("order by coalesce")).sql).toMatch(/offset 0/);
    calls.length = 0;
    await request(buildApp()).get("/conversations?offset=DROP");
    expect(calls.find((c) => c.sql.includes("order by coalesce")).sql).toMatch(/offset 0/);
  });
});

describe("BUG-032: GET /conversations/post-search searches ALL posts server-side", () => {
  it("returns matching post URLs for a query", async () => {
    const res = await request(buildApp()).get("/conversations/post-search?q=abc");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(["https://instagram.com/p/abc/"]);
    const call = calls.find((c) => c.sql.includes("source_url like ?"));
    expect(call.params).toEqual(["%abc%"]);
  });

  it("returns an empty list (no query fired) for a blank search", async () => {
    const res = await request(buildApp()).get("/conversations/post-search?q=");
    expect(res.body).toEqual([]);
    expect(calls.some((c) => c.sql.includes("source_url like"))).toBe(false);
  });
});
