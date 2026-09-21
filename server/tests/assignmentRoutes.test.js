// Customers & assignment read API: the filter logic is what the whole bulk
// reassignment will act on, so the WHERE clauses are pinned here — especially
// the unassigned/bot buckets and the whitespace-tolerant owner match (Wati
// owner strings carry stray double spaces).
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const calls = [];
const state = { rows: [], total: 3 };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    // the buckets query also contains "count(*) total" — match it first
    if (sql.includes("unassigned,")) return [{ unassigned: 3585, bot: 95, open_chats: 86, total: 8646 }];
    // handover queries
    if (sql.includes("group by c.country_iso2") && sql.includes("contacted")) return state.byCountry || [];
    if (sql.includes("group by c.country_iso2")) return state.breakdown || [];
    if (sql.includes("interested") && sql.includes("max(c.last_message_at)")) return [state.handoverTotals || {}];
    if (sql.includes("from ads_employees") && sql.includes("wati_email")) return state.employeeRow ? [state.employeeRow] : [];
    // deactivate's "how many are left" — aliased `c`, unlike the countries facet
    if (sql.includes("select count(*) n from ads_wati_contacts c")) return [{ n: state.remaining ?? 0 }];
    if (sql.startsWith("update ads_employees")) return {};
    if (sql.includes("count(*) total")) return [{ total: state.total }];
    if (sql.includes("select c.wa_id ")) return state.rows.map((r) => ({ wa_id: r.wa_id }));
    if (sql.includes("country_iso2 iso2")) return [{ iso2: "AE", n: 12 }];
    if (sql.includes("owner, count(*) n")) return [{ owner: "Yaser Kamoun", n: 5 }];
    if (sql.includes("campaign_id id")) return [{ id: "c1", name: "Gold", n: 4 }];
    if (sql.includes("unassigned,")) return [{ unassigned: 3585, bot: 95, total: 8646 }];
    return state.rows;
  }),
}));
const assignMany = vi.fn(async (ids, o) => ({ batchId: "B1", total: ids.length, sent: ids.length, failed: 0, skipped: 0, results: [] }));
const undoBatch = vi.fn(async () => ({ undoBatchId: "U1", restored: 2, failed: 0, not_undoable: ["x"] }));
const resolveEmail = vi.fn(async (o) => {
  if (o === "NoEmail") throw new Error("لا يوجد إيميل Wati صالح");
  return "omar@x.com";
});
vi.mock("../src/lib/watiAssign.js", () => ({
  assignableEmployees: vi.fn(async () => [{ owner_name: "Omar", wati_email: "omar@x.com", assignable: true }]),
  assignMany: (...a) => assignMany(...a),
  undoBatch: (...a) => undoBatch(...a),
  resolveEmail: (...a) => resolveEmail(...a),
  newBatchId: () => "B1",
  // real behaviour — the route uses these to decide what Wati will accept
  WA_WINDOW_HOURS: 24,
  windowOpen: (t) => !!t && (Date.now() - new Date(t).getTime()) / 3600000 < 24,
}));
const FRESH = () => new Date().toISOString();
const STALE = () => new Date(Date.now() - 30 * 3600e3).toISOString();

const router = (await import("../src/routes/assignment.js")).default;
const app = express(); app.use(express.json()); app.use("/assignment", router);
const lastList = () => calls.find((c) => c.sql.includes("select c.wa_id, c.full_name"));

beforeEach(() => {
  calls.length = 0; state.rows = []; state.total = 3;
  state.byCountry = []; state.handoverTotals = {}; state.employeeRow = null; state.remaining = 0; state.breakdown = [];
  assignMany.mockClear(); undoBatch.mockClear(); resolveEmail.mockClear();
});

describe("GET /assignment/contacts", () => {
  it("derives country + contacted flags and reports the total", async () => {
    state.rows = [
      { wa_id: "971500000001", full_name: "A", phone: "971500000001", contact_owner: "Omar",
        country_iso2: "AE", conv_type: "human_handled", human_replied: 0, num_messages: 4 },
      { wa_id: "919101322807", full_name: "B", phone: "919101322807", contact_owner: null,
        country_iso2: null, conv_type: "bot_only", human_replied: 0, num_messages: 2 },
    ];
    const r = await request(app).get("/assignment/contacts");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(3);
    expect(r.body.rows[0]).toMatchObject({ country_iso2: "AE", contacted: true, unassigned: false });
    // country falls back to the phone dial code when the column is empty
    expect(r.body.rows[1]).toMatchObject({ country_iso2: "IN", contacted: false, unassigned: true });
    expect(r.body.rows[1].flag).toBeTruthy();
  });

  it("filters the unassigned bucket", async () => {
    await request(app).get("/assignment/contacts?owner=__unassigned__");
    expect(lastList().sql).toContain("c.contact_owner is null or c.contact_owner = ''");
  });

  it("filters the bot bucket by the automation-owner pattern", async () => {
    await request(app).get("/assignment/contacts?owner=__bot__");
    expect(lastList().sql).toMatch(/contact_owner regexp/);
  });

  it("matches a named owner ignoring stray whitespace", async () => {
    await request(app).get("/assignment/contacts?owner=Yaser%20Kamoun");
    const c = lastList();
    expect(c.sql).toContain("regexp_replace");
    expect(c.params).toContain("Yaser Kamoun");
  });

  it("applies country, state and search filters", async () => {
    await request(app).get("/assignment/contacts?country=ae&state=not_contacted&q=Ahmed");
    const c = lastList();
    expect(c.sql).toContain("c.country_iso2 = ?");
    expect(c.params).toContain("AE");                       // upper-cased
    expect(c.sql).toContain("human_replied,0) = 0");
    expect(c.params).toContain("%Ahmed%");
  });

  // Chat status is a separate axis from contact state so the two can be
  // combined; "not contacted AND still open" is the actionable work list.
  it("filters by chat status open/closed", async () => {
    await request(app).get("/assignment/contacts?chat=open");
    expect(lastList().sql).toContain("c.last_message_at >= (now() - interval 24 hour)");
    calls.length = 0;
    await request(app).get("/assignment/contacts?chat=closed");
    expect(lastList().sql).toContain("c.last_message_at < (now() - interval 24 hour)");
    expect(lastList().sql).toContain("c.last_message_at is null");   // never-active counts as closed
  });

  it("combines contact state with chat status", async () => {
    await request(app).get("/assignment/contacts?state=not_contacted&chat=open");
    const sql = lastList().sql;
    expect(sql).toContain("human_replied,0) = 0");                   // contact state
    expect(sql).toContain("c.last_message_at >= (now() - interval 24 hour)"); // chat status
  });

  it("still honours the old state=assignable/expired params", async () => {
    await request(app).get("/assignment/contacts?state=assignable");
    expect(lastList().sql).toContain("c.last_message_at >= (now() - interval 24 hour)");
  });

  it("clamps the page size and offset", async () => {
    await request(app).get("/assignment/contacts?limit=99999&offset=-5");
    expect(lastList().sql).toMatch(/limit 500 offset 0/);
  });
});

describe("GET /assignment/contacts/ids", () => {
  it("returns just the ids for 'select all matching' and flags the safety cap", async () => {
    state.rows = [{ wa_id: "1" }, { wa_id: "2" }];
    const r = await request(app).get("/assignment/contacts/ids?cap=2");
    expect(r.body.ids).toEqual(["1", "2"]);
    expect(r.body.capped).toBe(true);                       // hit the cap -> warn the UI
  });
});

describe("POST /assignment/preview (must never write)", () => {
  const contacts = [
    { wa_id: "a", full_name: "A", phone: "9711", contact_owner: "Sara", country_iso2: "AE", msg_unavailable: 0, last_message_at: FRESH() },
    { wa_id: "b", full_name: "B", phone: "9712", contact_owner: null, country_iso2: "EG", msg_unavailable: 1, last_message_at: FRESH() },
    { wa_id: "c", full_name: "C", phone: "9713", contact_owner: "Omar", country_iso2: "AE", msg_unavailable: 0, last_message_at: FRESH() },
  ];
  const send = (body) => request(app).post("/assignment/preview").send(body);

  it("summarises what would change without calling Wati", async () => {
    state.rows = contacts;
    const r = await send({ waIds: ["a", "b", "c", "zz"], toOwner: "Omar" });
    expect(r.status).toBe(200);
    expect(assignMany).not.toHaveBeenCalled();               // dry run
    expect(r.body.will_move).toBe(2);                        // a + b (c already Omar's)
    expect(r.body.already_owned).toBe(1);
    expect(r.body.missing).toEqual(["zz"]);
    expect(r.body.from_counts).toEqual({ Sara: 1, __unassigned__: 1 });
    expect(r.body.unlinked_channel).toBe(1);                 // b is on the unlinked number
  });

  // Wati rejects an expired ticket, so the confirmation must not promise to
  // move it — otherwise you get "0 succeeded, N failed" like the first live try.
  it("counts expired-window conversations separately instead of as movable", async () => {
    state.rows = [
      { wa_id: "a", contact_owner: null, country_iso2: "SA", msg_unavailable: 0, last_message_at: STALE() },
      { wa_id: "b", contact_owner: null, country_iso2: "SA", msg_unavailable: 0, last_message_at: FRESH() },
    ];
    const r = await send({ waIds: ["a", "b"], toOwner: "Omar" });
    expect(r.status).toBe(200);
    expect(r.body.will_move).toBe(1);        // only the open-window one
    expect(r.body.expired).toBe(1);
    expect(r.body.window_hours).toBe(24);
    expect(r.body.from_counts).toEqual({ __unassigned__: 1 });  // reflects the movable set
  });

  it("refuses a target with no Wati email", async () => {
    state.rows = contacts;
    const r = await send({ waIds: ["a"], toOwner: "NoEmail" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/إيميل Wati/);
  });

  it("rejects an empty selection, a missing target, and an oversized batch", async () => {
    expect((await send({ waIds: [], toOwner: "Omar" })).status).toBe(400);
    expect((await send({ waIds: ["a"], toOwner: "" })).status).toBe(400);
    const many = Array.from({ length: 2001 }, (_, i) => `w${i}`);
    expect((await send({ waIds: many, toOwner: "Omar" })).status).toBe(400);
  });
});

describe("POST /assignment/execute (the only writing endpoint)", () => {
  const send = (body) => request(app).post("/assignment/execute").send(body);

  it("refuses to run without an explicit confirm", async () => {
    const r = await send({ waIds: ["a"], toOwner: "Omar" });
    expect(r.status).toBe(400);
    expect(assignMany).not.toHaveBeenCalled();
  });

  it("409s when the selection changed after the preview (stale confirmation)", async () => {
    const r = await send({ waIds: ["a", "b"], toOwner: "Omar", confirm: true, expected: 5 });
    expect(r.status).toBe(409);
    expect(assignMany).not.toHaveBeenCalled();
  });

  it("assigns and passes the reason + the acting user through to the audit log", async () => {
    const r = await send({ waIds: ["a", "b"], toOwner: "Omar", confirm: true, expected: 2, reason: "employee_exit" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ batchId: "B1", sent: 2 });
    const [ids, opts] = assignMany.mock.calls[0];
    expect(ids).toEqual(["a", "b"]);
    expect(opts.reason).toBe("employee_exit");
    expect(opts.performedBy).toBeTruthy();
  });

  it("falls back to 'manual' for an unknown reason (no arbitrary values in the log)", async () => {
    await send({ waIds: ["a"], toOwner: "Omar", confirm: true, reason: "whatever" });
    expect(assignMany.mock.calls[0][1].reason).toBe("manual");
  });

  it("de-duplicates ids before writing", async () => {
    await send({ waIds: ["a", "a", "b"], toOwner: "Omar", confirm: true });
    expect(assignMany.mock.calls[0][0]).toEqual(["a", "b"]);
  });
});

describe("POST /assignment/undo/:batchId", () => {
  it("restores the batch and reports what could not be returned", async () => {
    const r = await request(app).post("/assignment/undo/B1").send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ restored: 2, not_undoable: ["x"] });
    expect(undoBatch).toHaveBeenCalledWith("B1", expect.objectContaining({ performedBy: expect.any(String) }));
  });
});

describe("GET /assignment/breakdown", () => {
  it("splits the CURRENT filter by country, localised, unknown last", async () => {
    state.breakdown = [{ iso2: "MA", n: 1477 }, { iso2: "SA", n: 782 }, { iso2: null, n: 37 }];
    const r = await request(app).get("/assignment/breakdown?owner=__unassigned__");
    expect(r.status).toBe(200);
    expect(r.body.countries[0]).toMatchObject({ iso2: "MA", n: 1477 });
    expect(r.body.countries[0].ar).toBeTruthy();
    expect(r.body.countries[2]).toMatchObject({ iso2: null });   // unknown country survives
    // the same WHERE clause as the list, so the numbers always agree
    const c = calls.find((x) => x.sql.includes("group by c.country_iso2") && x.sql.includes("count(*) n"));
    expect(c.sql).toContain("c.contact_owner is null or c.contact_owner = ''");
  });
});

describe("employee handover", () => {
  it("summarises what a departing agent still holds, per country", async () => {
    state.byCountry = [
      { iso2: "SA", n: 320, contacted: 314, last_at: "2026-06-10" },
      { iso2: null, n: 4, contacted: 4, last_at: "2026-05-01" },
    ];
    state.handoverTotals = { total: 432, interested: 16, last_at: "2026-06-10" };
    state.employeeRow = null;                       // departed staff may not be in our roster
    const r = await request(app).get("/assignment/handover/Maiar%20Barshiny");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 432, interested: 16, employee: null });
    expect(r.body.by_country[0]).toMatchObject({ iso2: "SA", n: 320, contacted: 314 });
    expect(r.body.by_country[0].ar).toBeTruthy();
    expect(r.body.by_country[1].iso2).toBeNull();   // unknown country must not crash
  });

  it("refuses to deactivate someone who still holds conversations", async () => {
    state.remaining = 432;
    const r = await request(app).post("/assignment/deactivate").send({ owner: "Maiar Barshiny" });
    expect(r.status).toBe(409);
    expect(r.body.remaining).toBe(432);
    expect(calls.some((c) => c.sql.startsWith("update ads_employees"))).toBe(false);
  });

  it("deactivates once nothing is left", async () => {
    state.remaining = 0;
    const r = await request(app).post("/assignment/deactivate").send({ owner: "Josh Mbuyi" });
    expect(r.status).toBe(200);
    expect(calls.some((c) => c.sql.startsWith("update ads_employees set active=0"))).toBe(true);
  });
});

describe("GET /assignment/facets", () => {
  it("returns dropdown facets, bucket counts and the assignable roster", async () => {
    const r = await request(app).get("/assignment/facets");
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({ total: 8646, unassigned: 3585, bot: 95, open_chats: 86 });
    expect(r.body.countries[0]).toMatchObject({ iso2: "AE", n: 12 });
    expect(r.body.countries[0].ar).toBeTruthy();            // localized name resolved
    expect(r.body.owners[0].owner).toBe("Yaser Kamoun");
    expect(r.body.employees[0].assignable).toBe(true);
  });
});
