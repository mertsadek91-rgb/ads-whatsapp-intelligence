// DeepSeek client (OpenAI-compatible). Used for conversation analysis.
import axios from "axios";
import config from "../config.js";
import { query } from "../db.js";

export function hasKey() { return !!config.deepseek.apiKey; }

function estimateCostUsd(usage) {
  if (!usage) return null;
  const promptCost = (usage.prompt_tokens || 0) * (config.deepseek.inputCostPer1M / 1_000_000);
  const completionCost = (usage.completion_tokens || 0) * (config.deepseek.outputCostPer1M / 1_000_000);
  return Math.round((promptCost + completionCost) * 10000) / 10000;
}

// BUG-027 fix: sum today's estimated spend and refuse new calls once the
// configured daily budget is exceeded, instead of unbounded spend risk.
async function assertWithinBudget() {
  const budget = config.deepseek.dailyBudgetUsd;
  if (!budget) return; // 0/unset disables the guard
  const rows = await query(
    "select coalesce(sum(cost_usd), 0) spent from ads_ai_runs where created_at >= curdate()"
  );
  const spent = Number(rows[0]?.spent || 0);
  if (spent >= budget) {
    throw new Error(`تجاوزت تكلفة DeepSeek اليومية المسموحة (${budget}$) — الإنفاق حتى الآن: ${spent.toFixed(2)}$`);
  }
}

/**
 * Today's remaining budget in USD, or null when the guard is disabled. Lets a
 * long-running backfill stop cleanly on its own instead of discovering the limit
 * by having every remaining call throw.
 */
export async function budgetRemaining() {
  const budget = config.deepseek.dailyBudgetUsd;
  if (!budget) return null;
  const rows = await query(
    "select coalesce(sum(cost_usd), 0) spent from ads_ai_runs where created_at >= curdate()");
  return Math.max(0, budget - Number(rows[0]?.spent || 0));
}

function logRun({ context, promptTokens, completionTokens, costUsd, success, error, durationMs }) {
  query(
    `insert into ads_ai_runs (context, model, prompt_tokens, completion_tokens, cost_usd, success, error, duration_ms)
     values (?,?,?,?,?,?,?,?)`,
    [context || null, config.deepseek.model, promptTokens ?? null, completionTokens ?? null,
      costUsd ?? null, success ? 1 : 0, error || null, durationMs]
  ).catch((e) => console.error("[deepseek] ai_runs insert failed:", e.message));
}

/** Chat completion that returns parsed JSON (uses JSON mode).
 *  `context` is a free-form label (e.g. a wa_id) for the ads_ai_runs audit trail. */
export async function chatJSON(system, user, context) {
  if (!hasKey()) throw new Error("لا يوجد مفتاح DeepSeek — أضِف DEEPSEEK_API_KEY في .env");
  await assertWithinBudget();
  const start = Date.now();
  let r;
  try {
    r = await axios.post(`${config.deepseek.baseUrl}/chat/completions`, {
      model: config.deepseek.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }, {
      headers: { Authorization: `Bearer ${config.deepseek.apiKey}`, "Content-Type": "application/json" },
      timeout: 120000,
    });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    logRun({ context, success: false, error: msg, durationMs: Date.now() - start });
    throw new Error("DeepSeek API: " + msg);
  }
  const usage = r.data?.usage;
  const content = r.data?.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content);
    logRun({
      context, promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens,
      costUsd: estimateCostUsd(usage), success: true, durationMs: Date.now() - start,
    });
    return parsed;
  } catch {
    logRun({
      context, promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens,
      costUsd: estimateCostUsd(usage), success: false, error: "invalid JSON response",
      durationMs: Date.now() - start,
    });
    throw new Error("تعذّر تحليل رد DeepSeek (ليس JSON صالحاً)");
  }
}

export default { hasKey, chatJSON, budgetRemaining };
