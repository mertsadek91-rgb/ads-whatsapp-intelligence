// Measures the compliance evaluator against known-answer cases and prints a
// scorecard. This is the Phase-7 instrument: after any prompt, model or policy
// change, run it and compare — otherwise "the AI got better" is an opinion.
//
//   node scripts/calibrate.mjs            # all cases
//   node scripts/calibrate.mjs clean_conversation wrong_regulator
//
// Costs one AI call per case (~18s, ~$0.004 each) and is charged to the same
// daily budget as the live analysis.
import { CALIBRATION_CASES } from "../src/lib/calibrationCases.js";
import { evaluateThread } from "../src/lib/conversationAnalysis.js";
import { POLICY_VERSION } from "../src/lib/compliancePolicy.js";
import config from "../src/config.js";

const want = process.argv.slice(2);
const cases = want.length ? CALIBRATION_CASES.filter((c) => want.includes(c.id)) : CALIBRATION_CASES;
if (!cases.length) { console.error("no matching cases"); process.exit(1); }

const NON_CRITICAL = new Set(["informational", "minor", "moderate"]);
const results = [];

console.log(`calibration · model=${config.deepseek.model} · policy=${POLICY_VERSION} · ${cases.length} cases\n`);

for (const c of cases) {
  let got = { issues: [], flags: [] }, error = null;
  try {
    const r = await evaluateThread(c.thread, { waId: `calib:${c.id}` });
    got = {
      issues: (r.issues || []).map((i) => ({ type: i.type, severity: i.severity, confidence: i.confidence })),
      flags: r.evaluation?.customer_risk_flags || [],
    };
  } catch (e) { error = e.message; }

  const types = got.issues.map((i) => i.type);
  const miss = (c.expect.issues || []).filter((t) => !types.includes(t));
  const extra = (c.expect.absent || []).filter((t) => types.includes(t));
  const flagMiss = (c.expect.flags || []).filter((f) => !got.flags.includes(f));
  // "softer" passes when the type is gone OR downgraded out of critical
  const softerFail = (c.expect.softer || []).filter((t) => {
    const hit = got.issues.find((i) => i.type === t);
    return hit && !NON_CRITICAL.has(hit.severity);
  });
  // A case with an empty expected-issue list is also asserting "nothing else"
  const noiseFail = (c.expect.issues && c.expect.issues.length === 0 && !c.expect.softer)
    ? types.filter((t) => !(c.expect.absent || []).includes(t)) : [];

  const pass = !error && !miss.length && !extra.length && !flagMiss.length && !softerFail.length;
  results.push({ id: c.id, pass, error, miss, extra, flagMiss, softerFail, noise: noiseFail, got: types });

  console.log(`${pass ? "PASS" : "FAIL"}  ${c.id}`);
  if (error) console.log(`      error: ${error}`);
  if (miss.length) console.log(`      MISSED: ${miss.join(", ")}`);
  if (extra.length) console.log(`      FALSE POSITIVE: ${extra.join(", ")}`);
  if (flagMiss.length) console.log(`      missed customer flag: ${flagMiss.join(", ")}`);
  if (softerFail.length) console.log(`      not downgraded: ${softerFail.join(", ")}`);
  if (noiseFail.length) console.log(`      extra unexpected: ${noiseFail.join(", ")}`);
  if (got.issues.length) {
    console.log("      reported: " + got.issues.map((i) => `${i.type}/${i.severity}/${i.confidence}`).join("  "));
  }
}

const passed = results.filter((r) => r.pass).length;
const falsePos = results.reduce((s, r) => s + r.extra.length + r.noise.length, 0);
const missed = results.reduce((s, r) => s + r.miss.length, 0);
console.log(`\n${passed}/${results.length} passed · ${missed} missed detections · ${falsePos} false positives`);
if (falsePos > missed) {
  console.log("Over-sensitive: the evaluator flags more than it should, which depresses every score.");
} else if (missed > falsePos) {
  console.log("Under-sensitive: real violations are getting through.");
}
process.exit(0);
