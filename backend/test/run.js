const { parseUtterance } = require("../lib/detection/parse");
const corpus = require("./corpus");

let pass = 0;
const failures = [];

for (const { input, expect } of corpus) {
  const result = parseUtterance(input);
  const mismatches = [];
  for (const key of Object.keys(expect)) {
    const actual = key in result ? result[key] : result.candidate && result.candidate[key];
    if (actual !== expect[key]) {
      mismatches.push(`${key}: expected ${JSON.stringify(expect[key])}, got ${JSON.stringify(actual)}`);
    }
  }
  if (mismatches.length === 0) {
    pass++;
  } else {
    failures.push({ input, mismatches, result });
  }
}

console.log(`${pass}/${corpus.length} passed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`\n  "${f.input}"`);
    for (const m of f.mismatches) console.log(`    ${m}`);
  }
  process.exitCode = 1;
}
