// Sequential runner for reading-mode sequences (mirrors test/run.js's structure).
// Doesn't go through lib/detect.js (which involves the async LLM fallback) — calls
// parseUtterance + readingMode.lock/tryNavigate + validateCandidate directly, same
// as the pipeline does internally for the regex/reading-mode stages, no network.
const { parseUtterance } = require("../lib/detection/parse");
const { normalize } = require("../lib/detection/normalize");
const { validateCandidate, getConfidenceThreshold } = require("../lib/detection/validate");
const readingMode = require("../lib/detection/reading-mode");
const corpus = require("./reading-mode-corpus");

function resolveNav(input) {
  const candidate = readingMode.tryNavigate(normalize(input));
  if (!candidate) return { status: "no_match" };

  const validated = validateCandidate(candidate);
  if (!validated.valid) return { status: "invalid", candidate, reason: validated.reason };

  const status = validated.confidence >= getConfidenceThreshold() ? "auto_display" : "suggest";
  return { status, candidate, confidence: validated.confidence };
}

let pass = 0;
const failures = [];

for (const { name, seed, steps } of corpus) {
  readingMode.reset();

  const seedResult = parseUtterance(seed);
  if (seedResult.status !== "auto_display") {
    failures.push({ name, input: `(seed) ${seed}`, mismatches: [`seed did not auto_display: got ${seedResult.status}`] });
    continue;
  }
  readingMode.lock(seedResult.candidate);

  for (const { input, expect } of steps) {
    const result = resolveNav(input);
    // Simulate the operator confirming each nav suggestion, so sequences can chain
    // (matches lib/presentation.js#approve calling readingMode.lock on approval).
    if ((result.status === "suggest" || result.status === "auto_display") && result.candidate) {
      readingMode.lock(result.candidate);
    }

    const mismatches = [];
    for (const key of Object.keys(expect)) {
      const actual = key in result ? result[key] : result.candidate && result.candidate[key];
      if (actual !== expect[key]) {
        mismatches.push(`${key}: expected ${JSON.stringify(expect[key])}, got ${JSON.stringify(actual)}`);
      }
    }
    if (mismatches.length === 0) pass++;
    else failures.push({ name, input, mismatches, result });
  }
}

const total = corpus.reduce((n, c) => n + c.steps.length, 0);
console.log(`${pass}/${total} reading-mode steps passed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`\n  [${f.name}] "${f.input}"`);
    for (const m of f.mismatches) console.log(`    ${m}`);
  }
  process.exitCode = 1;
}
