// BUG-025 — reviewed_by used to be a client-supplied field (defaulting to the
// literal "admin" when absent), so any edit was untraceable and a client
// could even claim to be a different reviewer. Fixed: the author always
// comes from the authenticated session, never the request body. This also
// covers the new ads_lead_review_events history trail.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const state = { reviewRows: [], eventRows: [] };

vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    if (sql.startsWith("select phone from ads_wati_contacts")) return [{ phone: "+9665551234" }];
    if (sql.startsWith("insert into ads_lead_review\n")) {
      state.reviewRows.push({ wa_id: params[0], reviewed_by: params[6] });
      return {};
    }
    if (sql.startsWith("insert into ads_lead_review_events")) {
      state.eventRows.push({
        wa_id: params[0], account_type: params[1], deposit_count: params[2],
        deposit_total_aed: params[3], review_status: params[4], notes: params[5], changed_by: params[6],
      });
      return {};
    }
    if (sql.startsWith("select * from ads_v_customer_360")) {
      return [{ wa_id: params[0], full_name: "Test Customer" }];
    }
    if (sql.startsWith("select account_type, deposit_count")) {
      return state.eventRows.filter((e) => e.wa_id === params[0]).slice().reverse();
    }
    throw new Error("unexpected query in mock: " + sql);
  }),
}));

const leadsRouter = (await import("../src/routes/leads.js")).default;

function buildApp(sessionEmail) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = sessionEmail ? { email: sessionEmail } : {}; next(); });
  app.use("/leads", leadsRouter);
  return app;
}

beforeEach(() => { state.reviewRows.length = 0; state.eventRows.length = 0; });

describe("BUG-025: PATCH /leads/:waId always attributes edits to the session, not the body", () => {
  it("uses the authenticated session's email as reviewed_by / changed_by", async () => {
    const app = buildApp("manager@example.com");
    const res = await request(app)
      .patch("/leads/wa123")
      .send({ account_type: "real", deposit_total_aed: 500, review_status: "converted" });

    expect(res.status).toBe(200);
    expect(state.reviewRows[0].reviewed_by).toBe("manager@example.com");
    expect(state.eventRows[0].changed_by).toBe("manager@example.com");
  });

  it("ignores a client-supplied reviewed_by impersonation attempt", async () => {
    const app = buildApp("real-user@example.com");
    await request(app)
      .patch("/leads/wa123")
      .send({ account_type: "real", reviewed_by: "someone-else@evil.com" });

    expect(state.reviewRows[0].reviewed_by).toBe("real-user@example.com");
    expect(state.reviewRows[0].reviewed_by).not.toBe("someone-else@evil.com");
  });

  it("falls back to 'unknown' rather than crashing when there is no session email", async () => {
    const app = buildApp(null);
    const res = await request(app).patch("/leads/wa123").send({ account_type: "demo" });
    expect(res.status).toBe(200);
    expect(state.reviewRows[0].reviewed_by).toBe("unknown");
  });

  it("records one history event per edit, newest first via GET /:waId/history", async () => {
    const app = buildApp("a@b.com");
    await request(app).patch("/leads/wa1").send({ review_status: "reviewing" });
    await request(app).patch("/leads/wa1").send({ review_status: "converted", deposit_total_aed: 100 });

    const res = await request(app).get("/leads/wa1/history");
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].review_status).toBe("converted"); // most recent first
    expect(res.body[1].review_status).toBe("reviewing");
  });
});
