// Canonicalizes the AI-extracted agent_name from conversation analyses.
// The AI's free-text extraction produces many variants for the same person
// ("X", "X و Y", "X, Y", "X ثم Y"), several bot spellings ("Bot", "بوت",
// "بوت آلي", "Bot (آلي)"), and several "unknown" spellings ("غير معروف",
// "غير مذكور", "لا يوجد موظف بشري"…). The canonical vocabulary is the clean
// Wati contact_owner list, passed in by the caller — deliberately NOT
// hardcoded, so no real employee names live in the source code.
const UNKNOWN = "(غير معروف)";
const BOT = "Bot";

const BOT_RE = /بوت|آلي|\bbot\b/i;
const UNKNOWN_RE = /غير معروف|غير مذكور|غير محدد|لا يوجد|لم يظهر|لم يُذكر|لم يذكر|unknown|not\s+mentioned|no\s+human|no\s+agent|^[-—?؟\s]*$/i;

/**
 * @param raw    the agent_name string as stored by the AI analysis
 * @param owners known clean employee names (Wati contact_owner values)
 * @returns canonical name: a known owner (first one mentioned wins for
 *          multi-agent strings), "Bot", "(غير معروف)", or the raw string
 *          unchanged when nothing matches (honest fallback — never guess).
 */
// Collapse runs of whitespace before comparing: real Wati owner values have
// been observed with double spaces ("Yaser  Kamoun") while the AI extracts
// the single-spaced form — without this they never substring-match, and a
// multi-agent string then gets mis-attributed to the second-mentioned agent.
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export function normalizeAgentName(raw, owners = []) {
  const s = squash(raw);
  if (!s) return UNKNOWN;
  const lower = s.toLowerCase();

  // 1) A real known employee mentioned anywhere wins; for strings naming
  //    several ("X و Y"), attribute to the first-mentioned (primary handler).
  //    Owners are sorted so the winner is deterministic regardless of the
  //    arbitrary DISTINCT row order the list arrives in.
  let best = null;
  for (const o of [...owners].map(squash).filter(Boolean).sort()) {
    const i = lower.indexOf(o.toLowerCase());
    if (i !== -1 && (best === null || i < best.i)) best = { name: o, i };
  }
  if (best) return best.name;

  if (BOT_RE.test(s)) return BOT;
  if (UNKNOWN_RE.test(s)) return UNKNOWN;
  return s;
}

export const UNKNOWN_AGENT = UNKNOWN;
export const BOT_AGENT = BOT;
export default normalizeAgentName;
