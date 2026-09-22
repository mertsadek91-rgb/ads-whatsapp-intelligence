// What currency the stored amounts are actually in.
//
// Every money column in the schema is named `*_aed` — spend_aed, cpc_aed,
// cpm_aed, cost_per_result_aed. That was true of the installation those names
// were written for and false of every other one: ingestMeta writes Meta's
// `spend` field verbatim, and Meta denominates spend in whatever currency the
// AD ACCOUNT is billed in. A USD-billed account therefore stored dollars in a
// column called aed, and the display layer then multiplied those dollars by a
// rate meaning "how many X equal one dirham". Both the label and the arithmetic
// were wrong, and nothing anywhere said so.
//
// The fix is not a migration. Renaming seventeen schema sites and twenty query
// sites to `*_base` is avoidable risk for zero behavioural gain, and converting
// historical rows would be worse — we do not know what rate applied on the day
// each row was written. What was actually missing is the fact of WHICH currency
// those numbers are in. That fact now has one home, is read from the ad account
// itself rather than assumed, and everything that formats money reads it.
//
// The column names stay, and README says plainly that they are historical.
import { query } from "../db.js";

const KEY = "base_currency";
const DEFAULT = "AED";

// Cached because every board render asks, and it changes about once per
// installation. `null` means "not read yet", not "not set".
let cached = null;

/** Accept only a plausible ISO-4217 code; anything else is not worth storing. */
const clean = (v) => {
  const s = String(v || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
};

/**
 * The currency the stored amounts are denominated in. Defaults to AED so an
 * installation that predates this reads exactly as it always did — its data
 * really is in dirhams, and nothing should appear to change under it.
 */
export async function baseCurrency() {
  if (cached) return cached;
  try {
    const r = await query("select v from ads_settings where k = ?", [KEY]);
    cached = clean(r[0]?.v) || DEFAULT;
  } catch {
    cached = DEFAULT;      // before the schema exists, the default is correct
  }
  return cached;
}

/**
 * Record what the ad account bills in. Called from the Meta ingest, which is
 * the only place that knows — and is told by Meta rather than by a human, so
 * it cannot be set to something the numbers are not actually in.
 *
 * Returns what is now stored, and whether this changed it.
 */
export async function setBaseCurrency(code, { source = "meta" } = {}) {
  const next = clean(code);
  if (!next) return { currency: await baseCurrency(), changed: false };

  const previous = await baseCurrency();
  if (previous === next) return { currency: next, changed: false };

  await query(
    `insert into ads_settings (k, v) values (?, ?)
     as new on duplicate key update v = new.v, updated_at = now()`,
    [KEY, next]);
  cached = next;
  // Loud on purpose: it means every stored figure was being labelled with the
  // wrong currency until now, and the display rates need revisiting.
  console.log(`[money] base currency ${previous} -> ${next} (from ${source}). ` +
    `Stored amounts are ${next}; check the display rates in Settings.`);
  return { currency: next, changed: true, previous };
}

/** Test seam, and for a process that changed the setting out of band. */
export function _resetCache() { cached = null; }

export default { baseCurrency, setBaseCurrency, _resetCache };
