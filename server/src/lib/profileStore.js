// The in-memory business profile singleton.
//
// Split from businessProfile.js on purpose: this module must not import the
// database. Almost every module in the app reads the profile, so if the
// accessor pulled in db.js then simply reading a profile would drag mysql2 into
// every consumer's module graph — which, among other things, defeats per-file
// mocking in tests and makes a pure unit test accidentally depend on a driver.
//
// businessProfile.js owns loading and saving; this owns "what is live now".
import { validateProfile } from "./profileSchema.js";
import { GENERIC_PROFILE } from "../profiles/generic.js";

let cached = null;
let meta = { version: 0, policy_version: "seed", tag_version: "seed", source: "seed", calibration: null };

/**
 * Synchronous by design. The pure validators that consume the profile
 * (evalValidate, validateAiTags, scoreContact) are directly unit-tested and
 * documented as never throwing; making this async would have made them async
 * too, for a value that changes a handful of times per process and is read
 * thousands.
 *
 * Falls back to the bundled seed rather than throwing: a missing profile must
 * not take the app down, and the boot log says loudly which one is in use.
 */
export function getProfile() {
  if (!cached) cached = validateProfile(GENERIC_PROFILE).profile;
  return cached;
}

export function setProfile(profile, nextMeta) {
  cached = profile ? validateProfile(profile).profile : null;
  if (nextMeta) meta = { ...meta, ...nextMeta };
  return cached;
}

export const getMeta = () => meta;
export const policyVersion = () => meta.policy_version;
export const tagVersion = () => meta.tag_version;

export default { getProfile, setProfile, getMeta, policyVersion, tagVersion };
