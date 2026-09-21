// BUG-026 (full fix) — a FAILED Wati fetch used to be indistinguishable from
// an empty thread: syncOne would then overwrite a real conversation's stored
// classification with no_customer/0 messages, and the UI showed "no messages"
// with no hint anything went wrong. Now a failed fetch carries a `.failed`
// marker: syncOne refuses to persist off it, and the detail route reports
// partial:true.
import { describe, it, expect, vi, beforeEach } from "vitest";

const queries = [];
const storedMeta = { wa_id: "wa1", conv_type: "human_handled", msg_total: 12 };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    queries.push(sql);
    if (sql.startsWith("select * from ads_conversation_meta")) return [storedMeta];
    if (sql.startsWith("select stage, deposit_flag")) return [];
    return {};
  }),
}));

const getThread = vi.fn();
vi.mock("../src/lib/wati.js", () => ({ getThread: (...a) => getThread(...a) }));
vi.mock("../src/lib/score.js", () => ({ scoreContact: () => ({ score: 5, band: "cold", reasons: [] }) }));

const { syncOne } = await import("../src/lib/conversationMeta.js");

beforeEach(() => { queries.length = 0; getThread.mockReset(); });

describe("BUG-026: syncOne never persists off a failed thread fetch", () => {
  it("keeps the stored classification and reports partial when the fetch failed", async () => {
    getThread.mockResolvedValue(Object.assign([], { failed: true }));
    const result = await syncOne("wa1");

    expect(result.partial).toBe(true);
    expect(result.conv_type).toBe("human_handled"); // stored value preserved
    expect(queries.some((q) => q.startsWith("insert into ads_conversation_meta"))).toBe(false);
    expect(queries.some((q) => q.startsWith("update ads_wati_contacts"))).toBe(false);
  });

  it("still persists normally for a genuinely empty thread (no failed marker)", async () => {
    getThread.mockResolvedValue([]);
    const result = await syncOne("wa1");

    expect(result.partial).toBeUndefined();
    expect(result.conv_type).toBe("no_customer");
    expect(queries.some((q) => q.startsWith("insert into ads_conversation_meta"))).toBe(true);
  });
});
