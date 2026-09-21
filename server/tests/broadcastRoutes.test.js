// Route-level contract: /preview never writes anywhere, /execute refuses
// without confirm, refuses while the master switch is off, and refuses a
// stale audience count — mirroring assignment.js's write-safety contract.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql) => {
    if (sql.startsWith("insert into ads_broadcast_run")) return { insertId: 42 };
    if (sql.startsWith("select * from ads_broadcast_run")) return [{ id: 42, name: "Promo", filter_json: "{}", param_map_json: "{}" }];
    if (sql.includes("from ads_broadcast_recipient")) return [];
    if (sql.startsWith("select id, name, template_name")) return [];
    if (sql.includes("group by") ) return [];
    return [];
  }),
}));

const sendEnabled = vi.fn(async () => false);
const setSendEnabled = vi.fn(async (on) => on);
const approvedTemplates = vi.fn(async () => [{ name: "callback_requested_english", status: "APPROVED", vars: ["name"] }]);
const templates = vi.fn(async () => [{ name: "callback_requested_english", status: "APPROVED", vars: ["name"] }]);
const audiencePreview = vi.fn(async () => ({ total_matching: 10, eligible: 8, excluded_opted_out: 2, by_country: [], sample: [] }));
const sendBroadcast = vi.fn(async (runId) => ({ runId, total: 8, sent: 8, failed: 0, skipped: 0 }));

vi.mock("../src/lib/broadcast.js", () => ({
  sendEnabled: (...a) => sendEnabled(...a),
  setSendEnabled: (...a) => setSendEnabled(...a),
  approvedTemplates: (...a) => approvedTemplates(...a),
  templates: (...a) => templates(...a),
  audiencePreview: (...a) => audiencePreview(...a),
  sendBroadcast: (...a) => sendBroadcast(...a),
  MAX_AUDIENCE: 20000,
  default: {},
}));

const router = (await import("../src/routes/broadcasts.js")).default;
const app = express(); app.use(express.json());
app.use((req, res, next) => { req.session = { email: "manager@example.com" }; next(); });
app.use("/broadcasts", router);

beforeEach(() => {
  sendEnabled.mockReset().mockResolvedValue(false);
  setSendEnabled.mockClear(); approvedTemplates.mockClear(); templates.mockClear();
  audiencePreview.mockReset().mockResolvedValue({ total_matching: 10, eligible: 8, excluded_opted_out: 2, by_country: [], sample: [] });
  sendBroadcast.mockClear();
});

describe("master switch", () => {
  it("GET /enabled reports the stored state", async () => {
    const r = await request(app).get("/broadcasts/enabled");
    expect(r.body).toEqual({ enabled: false });
  });
  it("POST /enabled only accepts a boolean, coerced", async () => {
    await request(app).post("/broadcasts/enabled").send({ enabled: true });
    expect(setSendEnabled).toHaveBeenCalledWith(true);
  });
});

describe("POST /broadcasts/preview", () => {
  it("requires a name and a template", async () => {
    const r1 = await request(app).post("/broadcasts/preview").send({ templateName: "x" });
    expect(r1.status).toBe(400);
    const r2 = await request(app).post("/broadcasts/preview").send({ name: "Promo" });
    expect(r2.status).toBe(400);
  });
  it("rejects a template that isn't approved for the channel", async () => {
    approvedTemplates.mockResolvedValueOnce([]);
    const r = await request(app).post("/broadcasts/preview").send({ name: "Promo", templateName: "ghost" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/القالب/);
  });
  it("never touches the send engine", async () => {
    await request(app).post("/broadcasts/preview").send({ name: "Promo", templateName: "callback_requested_english", filter: { country: "AE" } });
    expect(sendBroadcast).not.toHaveBeenCalled();
  });
});

describe("POST /broadcasts/execute", () => {
  const body = { name: "Promo", templateName: "callback_requested_english", filter: {}, confirm: true, expected: 8 };

  it("refuses without an explicit confirm", async () => {
    const r = await request(app).post("/broadcasts/execute").send({ ...body, confirm: false });
    expect(r.status).toBe(400);
    expect(sendBroadcast).not.toHaveBeenCalled();
  });

  it("refuses while the master switch is off, even with confirm:true", async () => {
    sendEnabled.mockResolvedValue(false);
    const r = await request(app).post("/broadcasts/execute").send(body);
    expect(r.status).toBe(409);
    expect(sendBroadcast).not.toHaveBeenCalled();
  });

  it("refuses a stale audience count (changed since /preview)", async () => {
    sendEnabled.mockResolvedValue(true);
    audiencePreview.mockResolvedValue({ total_matching: 10, eligible: 5, excluded_opted_out: 5, by_country: [], sample: [] });
    const r = await request(app).post("/broadcasts/execute").send(body); // expected:8, now eligible:5
    expect(r.status).toBe(409);
    expect(sendBroadcast).not.toHaveBeenCalled();
  });

  it("creates a run row and sends when everything checks out", async () => {
    sendEnabled.mockResolvedValue(true);
    const r = await request(app).post("/broadcasts/execute").send(body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ runId: 42, sent: 8 });
    expect(sendBroadcast).toHaveBeenCalledWith(42, expect.objectContaining({ templateName: "callback_requested_english" }));
  });
});

describe("GET /broadcasts/runs/:id", () => {
  it("404s for a run that doesn't exist", async () => {
    const db = await import("../src/db.js");
    db.query.mockResolvedValueOnce([]); // select * from ads_broadcast_run -> none
    const r = await request(app).get("/broadcasts/runs/999");
    expect(r.status).toBe(404);
  });
});
