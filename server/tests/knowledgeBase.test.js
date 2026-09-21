// Batch E: Knowledge Base lib. generateKB reads recent analyses, makes ONE
// budget-guarded DeepSeek call, and upserts bilingual Q&A drafts keyed by a
// hash of the normalized question (so re-runs merge, bumping times_seen).
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = [];
const state = { analyses: [] };
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("from ads_conversation_analysis")) return state.analyses;
    if (sql.startsWith("insert into ads_kb_qa")) return {};
    if (sql.includes("count(*) total")) return [{ total: 3, approved: 1, draft: 2, ai: 2, manual: 1 }];
    if (sql.startsWith("select id, question")) return [{ id: 1, question: "q", answer: "a", category: "deposit", lang: "ar", source: "ai", status: "draft", times_seen: 2 }];
    return {};
  }),
}));
const chatJSON = vi.fn();
vi.mock("../src/lib/deepseek.js", () => ({ hasKey: () => true, chatJSON: (...a) => chatJSON(...a) }));

const kb = await import("../src/lib/knowledgeBase.js");

beforeEach(() => { calls.length = 0; state.analyses = []; chatJSON.mockReset(); });

describe("qHash", () => {
  it("normalizes whitespace/case/trailing punctuation so variants collide", () => {
    expect(kb.qHash("How do I deposit?")).toBe(kb.qHash("  how   do i DEPOSIT  "));
    expect(kb.qHash("ما هو الحد الأدنى للإيداع؟")).toBe(kb.qHash("ما هو الحد الأدنى للإيداع"));
  });
});

describe("generateKB", () => {
  it("returns early with zero when there are no analyzed conversations", async () => {
    const r = await kb.generateKB({});
    expect(r).toEqual({ sampled: 0, pairs: 0, upserted: 0 });
    expect(chatJSON).not.toHaveBeenCalled();
  });

  it("makes one AI call and upserts both languages of each valid pair", async () => {
    state.analyses = [{ summary: "customer asked about deposit", customer_details: JSON.stringify({ objections: ["fees"] }), lead_status: "interested" }];
    chatJSON.mockResolvedValue({ pairs: [
      { category: "deposit", question_ar: "كيف أودع؟", answer_ar: "عبر البطاقة أو التحويل.", question_en: "How do I deposit?", answer_en: "By card or transfer." },
      { category: "bogus-cat", question_ar: "سؤال", answer_ar: "" }, // answer empty -> ar skipped; no en
    ] });
    const r = await kb.generateKB({});
    expect(chatJSON).toHaveBeenCalledOnce();
    expect(r.pairs).toBe(2);
    // first pair -> 2 upserts (ar+en); second -> 0 (empty ar answer, no en)
    expect(r.upserted).toBe(2);
    const inserts = calls.filter((c) => c.sql.startsWith("insert into ads_kb_qa"));
    expect(inserts).toHaveLength(2);
    // bogus category is clamped to 'general' would apply, but here the pair was skipped;
    // verify the deposit category survived on the valid inserts
    expect(inserts.every((i) => i.params[3] === "deposit")).toBe(true);
    expect(inserts.map((i) => i.params[4]).sort()).toEqual(["ar", "en"]);
  });

  it("clamps an unknown category to 'general'", async () => {
    state.analyses = [{ summary: "x", customer_details: null, lead_status: null }];
    chatJSON.mockResolvedValue({ pairs: [{ category: "nonsense", question_ar: "س", answer_ar: "ج" }] });
    await kb.generateKB({});
    const insert = calls.find((c) => c.sql.startsWith("insert into ads_kb_qa"));
    expect(insert.params[3]).toBe("general");
  });
});

describe("createManual / updateKB", () => {
  it("rejects a manual pair missing question or answer", async () => {
    await expect(kb.createManual({ question: "", answer: "a" })).rejects.toThrow();
  });
  it("manual pairs are stored approved", async () => {
    await kb.createManual({ question: "q", answer: "a", category: "risk", lang: "en" });
    const insert = calls.find((c) => c.sql.startsWith("insert into ads_kb_qa"));
    expect(insert.params[5]).toBe("manual");   // source
    expect(insert.params[6]).toBe("approved"); // status
  });
  it("updateKB re-hashes the question when it changes and clamps status", async () => {
    await kb.updateKB(5, { question: "new q", status: "weird" });
    const upd = calls.find((c) => c.sql.startsWith("update ads_kb_qa"));
    expect(upd.sql).toContain("q_hash = ?");
    expect(upd.sql).not.toContain("status = ?"); // invalid status dropped
  });
});
