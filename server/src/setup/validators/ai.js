// Prove the AI key works, and populate the model dropdown from the provider
// rather than asking the operator to type a model name.
//
// Two details that matter in practice:
//   - A free-text model field is a footgun. Providers retire model names, and
//     the failure surfaces much later as "every analysis is failing" rather
//     than at setup. So: fetch the list, make it a dropdown.
//   - HTTP 402 (valid key, no credit) is the failure most often misread as a
//     bad key. It gets its own message and a top-up link.
import axios from "axios";
import { fail, pass } from "../errorMap.js";
import { isTlsTrustError } from "../../lib/tlsTrust.js";

function classify(err) {
  // Checked first: a re-signed certificate is not an auth or balance problem,
  // and reporting it as one sends the operator to the wrong console entirely.
  if (isTlsTrustError(err)) return "TLS_INTERCEPTED";
  const status = err?.response?.status;
  const msg = err?.response?.data?.error?.message || err?.message || "";
  if (status === 401) return "AI_UNAUTHORIZED";
  if (status === 402 || /insufficient balance/i.test(msg)) return "AI_NO_BALANCE";
  if (status === 429) return "AI_RATE_LIMITED";
  if (status === 400 && /model/i.test(msg)) return "AI_BAD_MODEL";
  const c = err?.code || "";
  if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT"].includes(c)) return "AI_UNREACHABLE";
  if (status >= 500) return "AI_UNREACHABLE";
  return "UNKNOWN";
}

const msgOf = (e) => e?.response?.data?.error?.message || e?.message;

/**
 * input: { apiKey, baseUrl?, model?, inputCostPer1M?, outputCostPer1M? }
 * Lists the models, then spends a single token proving the key can actually
 * complete — listing models alone does not prove billing works.
 */
export async function validate(input) {
  const apiKey = String(input?.apiKey || "").trim();
  const baseUrl = String(input?.baseUrl || "https://api.deepseek.com").replace(/\/$/, "");
  if (!apiKey) return fail("AI_UNAUTHORIZED", "no API key given");

  const auth = { Authorization: `Bearer ${apiKey}` };
  const details = { baseUrl };
  const warnings = [];

  try {
    const r = await axios.get(`${baseUrl}/models`, { headers: auth, timeout: 15000 });
    details.models = (r.data?.data || []).map((m) => m.id).filter(Boolean);
  } catch (e) {
    return fail(classify(e), msgOf(e));
  }

  const model = String(input?.model || "").trim() || details.models[0];
  if (!model) return fail("AI_BAD_MODEL", "the provider returned no models");
  if (details.models.length && !details.models.includes(model)) {
    warnings.push("AI_BAD_MODEL");
  }
  details.model = model;

  // One token. Proves the key is not merely well-formed but actually billable.
  try {
    const r = await axios.post(`${baseUrl}/chat/completions`, {
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      temperature: 0,
    }, { headers: { ...auth, "Content-Type": "application/json" }, timeout: 30000 });

    const usage = r.data?.usage || {};
    details.usage = {
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
    };
    // Show what a call costs, using the same rates the app records spend with.
    const inRate = Number(input?.inputCostPer1M ?? 0.28);
    const outRate = Number(input?.outputCostPer1M ?? 1.10);
    details.estimatedCostUsd =
      ((usage.prompt_tokens || 0) / 1e6) * inRate + ((usage.completion_tokens || 0) / 1e6) * outRate;
  } catch (e) {
    return fail(classify(e), msgOf(e));
  }

  return pass(details, warnings);
}

export default { validate, classify };
