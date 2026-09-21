// BUG-005 — conversationAnalysis.js (the DeepSeek prompt/response pipeline
// that persists AI conversation analysis) had zero test coverage despite
// being core business logic. Covers: empty-thread guard, score clamping,
// invalid lead_intent handling, follow-up-time computation, and that the
// wa_id is passed through to chatJSON as the ads_ai_runs context label
// (BUG-027).
import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted = [];
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    if (sql.includes("distinct contact_owner")) return [{ v: "Ahmed" }];
    if (sql.includes("business_channel from ads_wati_contacts")) return [{ business_channel: null }];
    if (sql.startsWith("insert into ads_conversation_analysis")) { inserted.push(params); return {}; }
    if (sql.startsWith("select * from ads_conversation_analysis")) return [];
    throw new Error("unexpected query: " + sql);
  }),
}));

const getThread = vi.fn();
vi.mock("../src/lib/wati.js", () => ({ getThread: (...a) => getThread(...a) }));

const chatJSON = vi.fn();
vi.mock("../src/lib/deepseek.js", () => ({ chatJSON: (...a) => chatJSON(...a) }));

const syncOne = vi.fn();
vi.mock("../src/lib/conversationMeta.js", () => ({ syncOne: (...a) => syncOne(...a) }));

const { analyze } = await import("../src/lib/conversationAnalysis.js");

beforeEach(() => { inserted.length = 0; getThread.mockReset(); chatJSON.mockReset(); syncOne.mockReset(); });

function thread(overrides = []) {
  return [
    { dir: "in", sender: "customer", body: "مرحباً", ts: "2026-07-01T10:00:00Z" },
    { dir: "out", sender: "Ahmed", body: "أهلاً بك", ts: "2026-07-01T10:05:00Z" },
    ...overrides,
  ];
}

describe("conversationAnalysis.analyze — core business logic", () => {
  it("throws (never calls the AI) when the thread is empty", async () => {
    getThread.mockResolvedValue([]);
    await expect(analyze("wa1")).rejects.toThrow(/لا توجد رسائل/);
    expect(chatJSON).not.toHaveBeenCalled();
  });

  it("passes wa_id through to chatJSON as the context label (BUG-027 audit trail)", async () => {
    chatJSON.mockResolvedValue({ conversation_score: 50, lead_intent: "warm", agent: {} });
    await analyze("wa123", thread());
    expect(chatJSON).toHaveBeenCalledWith(expect.any(String), expect.any(String), "wa123");
  });

  it("clamps an out-of-range conversation_score into 0-100", async () => {
    chatJSON.mockResolvedValue({ conversation_score: 150, agent: { score: -20 } });
    const result = await analyze("wa1", thread());
    expect(result.conv_score).toBe(100);
    expect(result.agent_score).toBe(0);
  });

  it("nulls out an invalid lead_intent instead of persisting garbage", async () => {
    chatJSON.mockResolvedValue({ conversation_score: 50, lead_intent: "super-hot", agent: {} });
    const result = await analyze("wa1", thread());
    expect(result.lead_intent).toBeNull();
  });

  it("computes follow_up_min as the median customer->agent reply gap", async () => {
    chatJSON.mockResolvedValue({ conversation_score: 50, agent: {} });
    const t = [
      { dir: "in", ts: "2026-07-01T10:00:00Z" },
      { dir: "out", sender: "a", ts: "2026-07-01T10:10:00Z" }, // 10 min gap
    ];
    const result = await analyze("wa1", t);
    expect(result.follow_up_min).toBe(10);
  });

  it("persists a row into ads_conversation_analysis with the expected shape", async () => {
    chatJSON.mockResolvedValue({
      conversation_score: 70, lead_intent: "hot", lead_status: "مهتم", summary: "ملخص",
      agent: { name: "Ahmed", score: 80, wrong_persuasion: true }, flags: ["تسرّع"],
    });
    await analyze("wa1", thread());
    expect(inserted).toHaveLength(1);
    const [waId, convScore, leadIntent, , , , agentName, agentScore, , , wrongPersuasion] = inserted[0];
    expect(waId).toBe("wa1");
    expect(convScore).toBe(70);
    expect(leadIntent).toBe("hot");
    expect(agentName).toBe("Ahmed");
    expect(agentScore).toBe(80);
    expect(wrongPersuasion).toBe(1); // boolean coerced to 1/0 for the DB column
  });

  it("calls conversationMeta.syncOne to keep engagement classification fresh before analyzing", async () => {
    chatJSON.mockResolvedValue({ conversation_score: 50, agent: {} });
    const t = thread();
    await analyze("wa1", t);
    expect(syncOne).toHaveBeenCalledWith("wa1", t);
  });

  it("normalizes the AI-extracted agent name against known owners before persisting", async () => {
    chatJSON.mockResolvedValue({ conversation_score: 50, agent: { name: "Ahmed و Someone Else", score: 60 } });
    await analyze("wa1", thread());
    const agentName = inserted[0][6]; // agent_name column position
    expect(agentName).toBe("Ahmed"); // first-mentioned known owner wins
  });

  it("keeps agent_name null when the AI found no name (does not invent an unknown label)", async () => {
    chatJSON.mockResolvedValue({ conversation_score: 50, agent: {} });
    await analyze("wa1", thread());
    expect(inserted[0][6]).toBeNull();
  });
});

describe("conversationAnalysis.analyze — opening/dropout coaching fields", () => {
  it("persists opening/dropout/smart-reply fields inside agent_eval as-is when they're on-schema", async () => {
    chatJSON.mockResolvedValue({
      conversation_score: 40, agent: {
        opening_quality: "weak", opening_excerpt: "سجّل من هنا: link",
        opening_pattern_key: "premature_registration_push",
        dropout_detected: true, dropout_point_excerpt: "طيب شكراً", dropout_pattern_key: "ignored_customer_question",
        smart_reply_example: "أهلاً! هل تبحث عن تعلّم التداول أم فتح حساب مباشرة؟",
      },
    });
    await analyze("wa1", thread());
    const agentEval = JSON.parse(inserted[0][8]); // agent_eval column position
    expect(agentEval.opening_quality).toBe("weak");
    expect(agentEval.opening_pattern_key).toBe("premature_registration_push");
    expect(agentEval.dropout_pattern_key).toBe("ignored_customer_question");
    expect(agentEval.smart_reply_example).toMatch(/تعلّم التداول/);
  });

  it("coerces an off-schema pattern_key value to \"other\" instead of persisting it verbatim", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    chatJSON.mockResolvedValue({
      conversation_score: 40,
      agent: { opening_pattern_key: "قفز للتسجيل بدون شرح", dropout_detected: true, dropout_pattern_key: "some_hallucinated_value" },
    });
    await analyze("wa1", thread());
    const agentEval = JSON.parse(inserted[0][8]);
    expect(agentEval.opening_pattern_key).toBe("other");
    expect(agentEval.dropout_pattern_key).toBe("other");
    expect(warn).toHaveBeenCalledTimes(2); // one warning per coerced field, distinct from a genuine "other"
    warn.mockRestore();
  });

  it("does NOT warn when the AI genuinely classifies as \"other\" (not a coercion)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    chatJSON.mockResolvedValue({ conversation_score: 40, agent: { opening_pattern_key: "other" } });
    await analyze("wa1", thread());
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps pattern_key fields null when nothing was detected (no false 'other' bucket)", async () => {
    chatJSON.mockResolvedValue({ conversation_score: 60, agent: { opening_quality: "strong" } });
    await analyze("wa1", thread());
    const agentEval = JSON.parse(inserted[0][8]);
    expect(agentEval.opening_pattern_key).toBeNull();
    expect(agentEval.dropout_pattern_key).toBeNull();
  });

  it("persists the exact message thread as thread_snapshot (BUG-018: reproducibility + training review)", async () => {
    chatJSON.mockResolvedValue({ conversation_score: 50, agent: {} });
    const t = thread([{ dir: "out", sender: "Ahmed", body: "طيب، هل تفضل حساب تجريبي؟", ts: "2026-07-01T10:10:00Z" }]);
    await analyze("wa1", t);
    const snapshot = JSON.parse(inserted[0][15]); // thread_snapshot column position (last column)
    expect(snapshot).toEqual(t);
  });

  it("persists successfully with the old, pre-feature response shape (backward compatibility)", async () => {
    chatJSON.mockResolvedValue({ conversation_score: 50, lead_intent: "warm", agent: { name: "Ahmed", score: 70, improvements: ["x"] } });
    await expect(analyze("wa1", thread())).resolves.toMatchObject({ conv_score: 50 });
    const agentEval = JSON.parse(inserted[0][8]);
    expect(agentEval.opening_pattern_key).toBeNull();
    expect(agentEval.dropout_pattern_key).toBeNull();
  });
});
