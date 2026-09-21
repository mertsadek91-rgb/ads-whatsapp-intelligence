// BUG-027 — DeepSeek calls had no cost/version/eval logging at all: unbounded
// spend risk and no visibility into model drift. Fixed: every chatJSON() call
// logs a row to ads_ai_runs (tokens, estimated cost, model, success/error,
// duration), and a pre-call budget guard refuses new calls once today's
// estimated spend meets/exceeds config.deepseek.dailyBudgetUsd.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios", () => ({ default: { post: vi.fn() } }));
vi.mock("../src/config.js", () => ({
  default: {
    deepseek: {
      apiKey: "fake-key", baseUrl: "https://api.deepseek.com", model: "deepseek-chat",
      inputCostPer1M: 1, outputCostPer1M: 2, dailyBudgetUsd: 5,
    },
  },
}));

const inserts = [];
let spentToday = 0;
vi.mock("../src/db.js", () => ({
  query: vi.fn(async (sql, params = []) => {
    if (sql.includes("sum(cost_usd)")) return [{ spent: spentToday }];
    if (sql.startsWith("insert into ads_ai_runs")) { inserts.push(params); return {}; }
    throw new Error("unexpected query: " + sql);
  }),
}));

const axios = (await import("axios")).default;
const { chatJSON } = await import("../src/lib/deepseek.js");

beforeEach(() => { inserts.length = 0; spentToday = 0; axios.post.mockReset(); });

describe("BUG-027: chatJSON logs cost/usage and enforces a daily budget", () => {
  it("logs prompt/completion tokens and an estimated cost on success", async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      },
    });
    const result = await chatJSON("sys", "user text", "wa123");
    expect(result).toEqual({ ok: true });

    expect(inserts).toHaveLength(1);
    const [context, model, promptTokens, completionTokens, costUsd, success] = inserts[0];
    expect(context).toBe("wa123");
    expect(model).toBe("deepseek-chat");
    expect(promptTokens).toBe(1000);
    expect(completionTokens).toBe(500);
    // 1000 tokens @ $1/1M + 500 tokens @ $2/1M = 0.001 + 0.001 = 0.002
    expect(costUsd).toBeCloseTo(0.002, 4);
    expect(success).toBe(1);
  });

  it("logs a failed run with the error message when the API call throws", async () => {
    axios.post.mockRejectedValueOnce({ response: { data: { error: { message: "invalid_request" } } } });
    await expect(chatJSON("sys", "user text", "wa456")).rejects.toThrow(/invalid_request/);

    expect(inserts).toHaveLength(1);
    const [context, , , , , success, error] = inserts[0];
    expect(context).toBe("wa456");
    expect(success).toBe(0);
    expect(error).toMatch(/invalid_request/);
  });

  it("logs a failed run when the response body isn't valid JSON", async () => {
    axios.post.mockResolvedValueOnce({
      data: { choices: [{ message: { content: "not json" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    });
    await expect(chatJSON("sys", "user text")).rejects.toThrow(/تعذّر تحليل/);
    expect(inserts[0][5]).toBe(0); // success = false
  });

  it("refuses to call the API once today's estimated spend meets the daily budget", async () => {
    spentToday = 5; // == dailyBudgetUsd
    await expect(chatJSON("sys", "user text")).rejects.toThrow(/تجاوزت تكلفة DeepSeek اليومية/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("allows calls when spend is under the budget", async () => {
    spentToday = 4.99;
    axios.post.mockResolvedValueOnce({
      data: { choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    });
    await expect(chatJSON("sys", "user text")).resolves.toEqual({});
  });
});
