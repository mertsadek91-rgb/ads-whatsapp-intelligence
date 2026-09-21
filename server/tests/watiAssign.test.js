// Conversation re-assignment — the only code path that WRITES to the live
// customer system. These tests pin the safety guards: never bot-assign, never
// move without a verified Wati email, log every outcome, and make undo restore
// the previous owner.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { employees: [], contacts: {}, logs: [], assignResult: { result: true } };
const calls = [];
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("select wati_email from ads_employees")) {
      const e = state.employees.find((x) => x.owner_name === params[0]);
      return e ? [{ wati_email: e.wati_email }] : [];
    }
    if (sql.includes("from ads_employees") && sql.includes("owner_name is not null") && sql.includes("wati_email is null")) {
      return state.employees.filter((e) => !e.wati_email).map((e) => ({ owner_name: e.owner_name }));
    }
    if (sql.includes("from ads_employees")) return state.employees;
    if (sql.includes("select contact_owner, business_channel, last_message_at from ads_wati_contacts")) {
      const c = state.contacts[params[0]];
      return c ? [c] : [];
    }
    if (sql.startsWith("insert into ads_assignment_log")) { state.logs.push(params); return {}; }
    if (sql.includes("from ads_assignment_log where batch_id")) {
      return state.logs.filter((p) => p[4] === params[0] && p[7] === "sent").map((p) => ({ wa_id: p[0], from_owner: p[1] }));
    }
    // behave like the real DB: the owner update must actually stick, otherwise
    // undo would read a stale owner and wrongly skip.
    if (sql.startsWith("update ads_wati_contacts")) {
      const c = state.contacts[params[1]];
      if (c) c.contact_owner = params[0];
      return {};
    }
    return [];
  }),
}));

const assignOperator = vi.fn(async () => state.assignResult);
vi.mock("../src/lib/wati.js", () => ({
  assignOperator: (...a) => assignOperator(...a),
  operatorEmailsOf: vi.fn(async () => ["agent@example.com"]),
}));

const wa = await import("../src/lib/watiAssign.js");

beforeEach(() => {
  calls.length = 0; state.logs = []; state.assignResult = { result: true };
  state.employees = [{ owner_name: "Omar", wati_email: "omar@example.com", active: 1, countries: "[]" }];
  const fresh = new Date().toISOString();   // inside the 24h window
  state.contacts = { "9711": { contact_owner: null, business_channel: null, last_message_at: fresh },
    "9712": { contact_owner: "Sara", business_channel: "971500000009", last_message_at: fresh } };
  assignOperator.mockClear();
});

describe("safety guards", () => {
  it("refuses to assign to an employee with no Wati email (never silently bot-assigns)", async () => {
    state.employees = [{ owner_name: "NoEmail", wati_email: null }];
    await expect(wa.assignMany(["9711"], { toOwner: "NoEmail" })).rejects.toThrow(/إيميل Wati/);
    expect(assignOperator).not.toHaveBeenCalled();   // nothing written to Wati
  });

  it("refuses a malformed email", async () => {
    state.employees = [{ owner_name: "Bad", wati_email: "not-an-email" }];
    await expect(wa.assignMany(["9711"], { toOwner: "Bad" })).rejects.toThrow();
    expect(assignOperator).not.toHaveBeenCalled();
  });

  it("validates BEFORE any contact is touched (all-or-nothing precheck)", async () => {
    state.employees = [{ owner_name: "NoEmail", wati_email: "" }];
    await expect(wa.assignMany(["9711", "9712", "9713"], { toOwner: "NoEmail" })).rejects.toThrow();
    expect(state.logs).toHaveLength(0);
  });
});

describe("assignMany", () => {
  it("assigns, passes the contact's channel, updates local owner, and logs 'sent'", async () => {
    const r = await wa.assignMany(["9712"], { toOwner: "Omar", performedBy: "admin" });
    expect(assignOperator).toHaveBeenCalledWith("9712", "omar@example.com", "971500000009");
    expect(r).toMatchObject({ total: 1, sent: 1, failed: 0, skipped: 0 });
    const log = state.logs[0];
    expect(log[1]).toBe("Sara");                 // from_owner recorded for undo
    expect(log[2]).toBe("Omar");
    expect(log[7]).toBe("sent");
    expect(calls.some((c) => c.sql.startsWith("update ads_wati_contacts"))).toBe(true);
  });

  it("skips a contact already owned by the target (no wasted API call)", async () => {
    state.contacts["9712"].contact_owner = "Omar";
    const r = await wa.assignMany(["9712"], { toOwner: "Omar" });
    expect(assignOperator).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
    expect(state.logs[0][7]).toBe("skipped");
  });

  it("records an error (and does not update the local owner) when Wati rejects", async () => {
    state.assignResult = { result: false, info: "Contact not found" };
    const r = await wa.assignMany(["9711"], { toOwner: "Omar" });
    expect(r).toMatchObject({ sent: 0, failed: 1 });
    expect(state.logs[0][7]).toBe("error");
    expect(state.logs[0][8]).toBe("Contact not found");
    expect(calls.some((c) => c.sql.startsWith("update ads_wati_contacts"))).toBe(false);
  });

  // Verified against the live account: Wati answers "Could not assign operator
  // because the ticket is Expired", and updateChatStatus can't reopen it
  // either. So an expired conversation must be skipped locally — calling the
  // API would burn a request (and rate-limit budget) on a certain rejection.
  it("skips a conversation whose 24h window has closed, without calling Wati", async () => {
    state.contacts["9711"].last_message_at = new Date(Date.now() - 30 * 3600e3).toISOString();
    const r = await wa.assignMany(["9711"], { toOwner: "Omar" });
    expect(assignOperator).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: 0, failed: 0, skipped: 1 });
    expect(state.logs[0][7]).toBe("skipped");
    expect(state.logs[0][8]).toBe("window-expired");
  });

  it("skips a contact that has never had any activity", async () => {
    state.contacts["9711"].last_message_at = null;
    const r = await wa.assignMany(["9711"], { toOwner: "Omar" });
    expect(assignOperator).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  it("still assigns when the window is open, and mixes both in one batch", async () => {
    state.contacts["9711"].last_message_at = new Date(Date.now() - 30 * 3600e3).toISOString(); // expired
    const r = await wa.assignMany(["9711", "9712"], { toOwner: "Omar" });                      // 9712 fresh
    expect(assignOperator).toHaveBeenCalledTimes(1);
    expect(assignOperator).toHaveBeenCalledWith("9712", "omar@example.com", "971500000009");
    expect(r).toMatchObject({ sent: 1, skipped: 1, failed: 0 });
  });

  it("de-duplicates the input list", async () => {
    await wa.assignMany(["9711", "9711", "9711"], { toOwner: "Omar" });
    expect(assignOperator).toHaveBeenCalledTimes(1);
  });
});

describe("undoBatch", () => {
  it("restores previous owners and reports contacts that were unassigned before", async () => {
    state.employees.push({ owner_name: "Sara", wati_email: "sara@example.com" });
    // 9712 was Sara's, 9711 was unassigned
    await wa.assignMany(["9711", "9712"], { toOwner: "Omar", batchId: "B1" });
    assignOperator.mockClear();
    const u = await wa.undoBatch("B1");
    expect(u.restored).toBe(1);                       // only 9712 could go back
    expect(u.not_undoable).toEqual(["9711"]);         // was unassigned — can't un-assign without bot
    expect(assignOperator).toHaveBeenCalledWith("9712", "sara@example.com", "971500000009");
  });
});

describe("assignableEmployees", () => {
  it("flags who can and cannot receive assignments", async () => {
    state.employees = [
      { owner_name: "Omar", full_name: "Omar S", wati_email: "omar@example.com", active: 1, countries: "[]" },
      { owner_name: "Ghost", full_name: null, wati_email: null, active: 0, countries: null },
    ];
    const list = await wa.assignableEmployees();
    expect(list.find((e) => e.owner_name === "Omar").assignable).toBe(true);
    expect(list.find((e) => e.owner_name === "Ghost").assignable).toBe(false);
  });
});
