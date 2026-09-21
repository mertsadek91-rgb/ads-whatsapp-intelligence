// Every test runs against a known business profile.
//
// The vocabulary the evaluator uses is now per-installation data rather than a
// compiled-in constant, so a test that did not set one would be asserting
// against whatever happened to be cached. Pinning the extracted brokerage
// profile here is also what proves the refactor was behaviour-preserving: the
// existing assertions did not change, only where their vocabulary comes from.
//
// Imports profileStore, NOT businessProfile: the latter reaches the database,
// and pulling mysql2 into every test's module graph from a setup file would
// defeat per-file mocking.
import { setProfile } from "../../src/lib/profileStore.js";
import { BROKERAGE_PROFILE } from "../../src/profiles/brokerage.js";

setProfile(BROKERAGE_PROFILE, {
  version: 1, policy_version: "v1.1", tag_version: "t1", source: "seed", calibration: null,
});
