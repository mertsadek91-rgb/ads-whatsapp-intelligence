// Storage and runtime access for the business profile.
//
// Shape: ONE versioned JSON document per version, not normalised tables. The
// profile is read whole on every AI call and written whole by a single review
// form; there is no query that wants to join across it, and a partially-saved
// issue list is a broken enum — exactly what this layer exists to prevent.
// Versioning is the other reason: policy_version is already stamped on every
// analysed row, so "what vocabulary scored this row?" is one select.
//
// Access: hydrated once at boot into a SYNCHRONOUS getProfile(). The pure
// validators (evalValidate, validateAiTags, scoreContact) take the profile as
// an argument rather than becoming async — they are directly unit-tested and
// documented as never throwing, and making them async would ripple through
// every call site and every test to no benefit. Configuration is read thousands
// of times and written a handful.
import { createHash } from "node:crypto";
import { query } from "../db.js";
import { validateProfile } from "./profileSchema.js";
import { GENERIC_PROFILE } from "../profiles/generic.js";
import { getProfile, setProfile, getMeta, policyVersion, tagVersion } from "./profileStore.js";

// Re-exported so consumers have one import for "the profile", while the
// accessors themselves live in a module that never touches the database.
export { getProfile, getMeta, policyVersion, tagVersion };


/**
 * The fingerprint that decides whether a saved edit costs a re-analysis.
 *
 * Bumping policy_version on every save would mean fixing an Arabic typo
 * re-analyses thirty days of conversations and spends the AI budget. Never
 * bumping is worse. So hash ONLY the parts the model actually sees, sorted
 * canonically so reordering an array is not a change:
 *   - issue keys and their default severities (not their labels)
 *   - risk flag / next step / sales pattern keys, and the real-progress split
 *   - the rule prose and the identity facts block
 *   - knowledge-base category keys, and the prompt language
 * Explicitly excluded: display labels, ordering, colours, help text, and
 * scoring weights — none of which change a single token of the prompt.
 */
export function policyFingerprint(p) {
  const canonical = {
    language: p.language,
    identity: {
      what_we_sell: p.identity?.what_we_sell || "",
      restricted: [...(p.identity?.restricted_markets || [])].sort(),
      facts: (p.identity?.facts || [])
        .map((f) => `${f.key}=${f.value}`).sort(),
    },
    rules: {
      ar: p.rules?.business_rules_ar || "", en: p.rules?.business_rules_en || "",
      intro_ar: p.rules?.compliance_intro_ar || "", intro_en: p.rules?.compliance_intro_en || "",
      play_ar: p.rules?.discovery_playbook_ar || [], play_en: p.rules?.discovery_playbook_en || [],
    },
    issues: (p.issue_types || []).map((t) => `${t.key}:${t.default_severity}`).sort(),
    flags: (p.customer_risk_flags || []).map((f) => f.key).sort(),
    patterns: (p.sales_patterns || []).map((x) => x.key).sort(),
    steps: (p.next_steps || []).map((s) => `${s.key}:${s.real_progress ? 1 : 0}`).sort(),
    kb: (p.kb_categories || []).map((c) => c.key).sort(),
  };
  return createHash("sha1").update(JSON.stringify(canonical)).digest("hex");
}

/** The same idea for the tag vocabulary, which versions independently. */
export function tagFingerprint(p) {
  const codes = [];
  for (const c of p.tags?.categories || []) {
    for (const t of c.tags || []) codes.push(`${Array.isArray(t) ? t[0] : t.code}:${c.source}`);
  }
  return createHash("sha1").update(JSON.stringify(codes.sort())).digest("hex");
}

export async function hydrate() {
  try {
    const rows = await query(
      `select version, profile, policy_version, tag_version, policy_fingerprint, tag_fingerprint,
              status, source, calibration_result
       from app_business_profile where status = 'active' order by version desc limit 1`);
    if (rows.length) {
      const raw = typeof rows[0].profile === "string" ? JSON.parse(rows[0].profile) : rows[0].profile;
      const { profile, errors } = validateProfile(raw);
      if (errors.length) {
        // Loud, not fatal. Scoring production against a silently-broken profile
        // is worse than scoring it against the seed and saying so.
        console.error("[profile] the stored active profile is invalid:", errors.join("; "));
      }
      const nextMeta = {
        version: rows[0].version,
        policy_version: rows[0].policy_version,
        tag_version: rows[0].tag_version,
        source: rows[0].source,
        calibration: rows[0].calibration_result
          ? (typeof rows[0].calibration_result === "string"
              ? JSON.parse(rows[0].calibration_result) : rows[0].calibration_result)
          : null,
      };
      setProfile(profile, nextMeta);
      return nextMeta;
    }
  } catch (e) {
    if (!/doesn't exist|ER_NO_SUCH_TABLE/i.test(e.message)) {
      console.error("[profile] could not load the business profile:", e.message);
    }
  }
  // No profile stored yet (a fresh install, or setup not finished).
  const seedMeta = { version: 0, policy_version: "seed", tag_version: "seed", source: "seed", calibration: null };
  setProfile(GENERIC_PROFILE, seedMeta);
  return seedMeta;
}


/** Test hook. */
export const _setProfile = (p, meta) => setProfile(p, meta);

export async function listVersions() {
  return query(
    `select version, status, source, policy_version, tag_version, created_at, activated_at, activated_by
     from app_business_profile order by version desc limit 50`);
}

export async function getDraft() {
  const rows = await query(
    "select * from app_business_profile where status = 'draft' order by version desc limit 1");
  if (!rows.length) return null;
  const raw = typeof rows[0].profile === "string" ? JSON.parse(rows[0].profile) : rows[0].profile;
  return { ...rows[0], profile: raw };
}

async function nextVersion() {
  const [r] = await query("select coalesce(max(version), 0) v from app_business_profile");
  return Number(r.v) + 1;
}

/** Save (or replace) the single draft. Validation runs on every save. */
export async function saveDraft(raw, { source = "human", generatedFrom = null, createdBy = null } = {}) {
  const result = validateProfile(raw);
  const existing = await getDraft();
  const version = existing ? existing.version : await nextVersion();
  const payload = [
    JSON.stringify(result.profile), policyFingerprint(result.profile), tagFingerprint(result.profile),
    source, generatedFrom ? JSON.stringify(generatedFrom) : null, createdBy,
  ];
  if (existing) {
    await query(
      `update app_business_profile
       set profile = ?, policy_fingerprint = ?, tag_fingerprint = ?, source = ?,
           generated_from = coalesce(?, generated_from), created_by = ?
       where version = ?`, [...payload, version]);
  } else {
    await query(
      `insert into app_business_profile
         (version, status, profile, policy_version, tag_version, policy_fingerprint, tag_fingerprint,
          source, generated_from, created_by)
       values (?, 'draft', ?, '', '', ?, ?, ?, ?, ?)`,
      [version, payload[0], payload[1], payload[2], payload[3], payload[4], payload[5]]);
  }
  return { version, ...result };
}

/**
 * Promote the draft. Carries the previous policy_version forward when the
 * prompt-affecting content is unchanged, so a label-only edit costs nothing —
 * and bumps it when the vocabulary really moved, which makes
 * qualityBoard.pendingEvaluation() re-queue exactly the affected rows through
 * machinery that already exists.
 */
export async function activateDraft({ activatedBy = null } = {}) {
  const draft = await getDraft();
  if (!draft) throw new Error("لا توجد مسوّدة لتفعيلها (no draft to activate)");

  const { profile, errors } = validateProfile(draft.profile);
  if (errors.length) throw new Error(`المسوّدة غير صالحة: ${errors.join("; ")}`);

  const rows = await query(
    "select version, profile, policy_version, tag_version, policy_fingerprint, tag_fingerprint " +
    "from app_business_profile where status = 'active' order by version desc limit 1");
  const active = rows[0] || null;

  const pf = policyFingerprint(profile);
  const tf = tagFingerprint(profile);
  const policy_version = active && active.policy_fingerprint === pf ? active.policy_version : `p${draft.version}`;
  const tag_version = active && active.tag_fingerprint === tf ? active.tag_version : `t${draft.version}`;

  // Removing a vocabulary entry must never rewrite history: the stored rows are
  // varchars, not foreign keys. Keeping the retired entries lets an old board
  // row still render a human label instead of a raw key.
  if (active) {
    const prev = typeof active.profile === "string" ? JSON.parse(active.profile) : active.profile;
    profile.retired = mergeRetired(profile.retired, prev, profile, draft.version);
  }

  await query("update app_business_profile set status = 'archived' where status = 'active'");
  await query(
    `update app_business_profile
     set status = 'active', profile = ?, policy_version = ?, tag_version = ?,
         policy_fingerprint = ?, tag_fingerprint = ?, activated_at = now(), activated_by = ?
     where version = ?`,
    [JSON.stringify(profile), policy_version, tag_version, pf, tf, activatedBy, draft.version]);

  await hydrate();
  return {
    version: draft.version, policy_version, tag_version,
    reanalysisRequired: !active || active.policy_fingerprint !== pf,
    retagRequired: !active || active.tag_fingerprint !== tf,
  };
}

function mergeRetired(retired, prev, next, version) {
  const out = {
    issue_types: [...(retired?.issue_types || [])],
    tags: [...(retired?.tags || [])],
    next_steps: [...(retired?.next_steps || [])],
  };
  const keep = (list, key) => new Set(list.map((x) => x[key]));
  const nextIssues = keep(next.issue_types || [], "key");
  for (const t of prev.issue_types || []) {
    if (!nextIssues.has(t.key) && !out.issue_types.some((x) => x.key === t.key)) {
      out.issue_types.push({ ...t, retired_in: version });
    }
  }
  const nextSteps = keep(next.next_steps || [], "key");
  for (const s of prev.next_steps || []) {
    if (!nextSteps.has(s.key) && !out.next_steps.some((x) => x.key === s.key)) {
      out.next_steps.push({ ...s, retired_in: version });
    }
  }
  const codesOf = (p) => new Set((p.tags?.categories || []).flatMap((c) =>
    (c.tags || []).map((t) => (Array.isArray(t) ? t[0] : t.code))));
  const nextCodes = codesOf(next);
  for (const c of prev.tags?.categories || []) {
    for (const t of c.tags || []) {
      const code = Array.isArray(t) ? t[0] : t.code;
      if (!nextCodes.has(code) && !out.tags.some((x) => x.code === code)) {
        out.tags.push({ code, en: Array.isArray(t) ? t[1] : t.en, ar: Array.isArray(t) ? t[2] : t.ar, retired_in: version });
      }
    }
  }
  return out;
}

export default {
  hydrate, getProfile, getMeta, policyVersion, tagVersion,
  saveDraft, getDraft, activateDraft, listVersions,
  policyFingerprint, tagFingerprint, _setProfile,
};
