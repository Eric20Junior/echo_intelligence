// Alias-suggestion mining ("improves over time", the human-reviewed half — see
// lib/detection/calibrate.js for the fully-automatic confidence-threshold half,
// and the CTO review that split them: a bad auto-added alias is a standing
// false-positive generator shown live to a congregation, so this only ever
// produces reviewable suggestions, never edits data/book-aliases.js directly.
//
// The hard part: a `manual` decision row (lib/server/presentation.js#manualDisplay)
// logs the operator's clean TYPED reference ("John 3:16"), not the audio that
// failed — so it can't be mined directly for what was mis-heard. The real
// mis-heard text lives on a separate `no_match` row logged moments earlier by the
// same detectReference() call that failed to find a book alias at all. This module
// pairs the two by proximity (CTO-reviewed parameters below) as a heuristic, not
// an exact link — the >=5-occurrences/>=2-dates bar before ever surfacing a
// suggestion is what actually filters out wrong pairings, not the pairing itself.
const { getManualEntries, getNoMatchEntries, upsertAliasSuggestion } = require("../log");

const PAIRING_WINDOW_MS = 25_000; // CTO-reviewed: tight enough that "operator reacting immediately to a miss" is the only plausible explanation
const MIN_OCCURRENCES = 5;
const MIN_DISTINCT_DATES = 2;
const MAX_SAMPLES_STORED = 3;

// Same shape as extract.js's AFTER_BOOK_PATTERN, but scanning the *whole* normalized
// text for a trailing number run (chapter [verse[-verse]]) since normalize() already
// turns spoken numbers into digits — the token right before it is the candidate
// mis-heard book name (single word, matching every existing variant alias in
// data/book-aliases.js, which are all single tokens). Prefix must be LAZY (.*?), not
// greedy — greedy backtracks minimally, so it swallows the chapter number into the
// prefix too (e.g. "fern 3 16" would wrongly split as prefix "fern 3" + trailing "16",
// extracting "3" as the candidate instead of "fern"). Lazy grows the prefix one
// token at a time and stops at the first position where the full trailing number
// run matches, which is the earliest number in the string — correct.
const CANDIDATE_ALIAS_PATTERN = /^(.*?\S)\s+(\d{1,3})(?:\s*(?::|verses?)?\s*\d{1,3}(?:\s*(?:through|to)?\s*\d{1,3})?)?$/;

function extractCandidateAlias(normalizedText) {
  if (!normalizedText) return null;
  const match = CANDIDATE_ALIAS_PATTERN.exec(normalizedText.trim());
  if (!match) return null;
  const words = match[1].split(/\s+/);
  return words[words.length - 1]; // last word before the number run
}

// Pairs each manual entry with the nearest preceding no_match row on the same
// service_date, within the pairing window — each no_match row can be consumed by
// at most one pairing (processing manual entries in chronological order and
// removing a no_match once used keeps this a clean 1:1 match, never double-counted).
function pairManualEntriesWithMisses() {
  const manualEntries = getManualEntries();
  const noMatchByDate = new Map(); // service_date -> no_match rows, ascending by id
  for (const row of getNoMatchEntries()) {
    if (!noMatchByDate.has(row.service_date)) noMatchByDate.set(row.service_date, []);
    noMatchByDate.get(row.service_date).push(row);
  }

  const pairs = [];
  for (const manual of manualEntries) {
    const candidates = noMatchByDate.get(manual.service_date);
    if (!candidates || candidates.length === 0) continue;

    const manualTime = new Date(manual.created_at).getTime();
    let bestIndex = -1;
    let bestGap = Infinity;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const gap = manualTime - new Date(candidates[i].created_at).getTime();
      if (gap < 0) continue; // no_match must precede the manual entry
      if (gap > PAIRING_WINDOW_MS) break; // rows are ascending by id/time, so further back only gets worse
      if (gap < bestGap) {
        bestGap = gap;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) continue;

    const [consumed] = candidates.splice(bestIndex, 1); // consumed by this pairing, never reused
    pairs.push({ bookId: manual.book_id, serviceDate: manual.service_date, noMatchRow: consumed });
  }
  return pairs;
}

// Runs the full mining pass. Cheap for a single-install's data volume (hundreds
// to low thousands of rows) — safe to call on every app startup, same as
// lib/detection/calibrate.js.
function mineAliasSuggestions() {
  const pairs = pairManualEntriesWithMisses();

  // count/dates track the real totals; samples is capped separately since it's
  // only for the reviewer's evidence display, not for the threshold decision.
  const evidenceByKey = new Map(); // `${bookId}::${aliasText}` -> { bookId, aliasText, count, dates: Set, samples: [] }
  for (const { bookId, serviceDate, noMatchRow } of pairs) {
    const aliasText = extractCandidateAlias(noMatchRow.normalized_text);
    if (!aliasText) continue;

    const key = `${bookId}::${aliasText}`;
    if (!evidenceByKey.has(key)) evidenceByKey.set(key, { bookId, aliasText, count: 0, dates: new Set(), samples: [] });
    const evidence = evidenceByKey.get(key);
    evidence.count++;
    evidence.dates.add(serviceDate);
    if (evidence.samples.length < MAX_SAMPLES_STORED) evidence.samples.push(noMatchRow.raw_text);
  }

  let created = 0;
  for (const evidence of evidenceByKey.values()) {
    if (evidence.count < MIN_OCCURRENCES || evidence.dates.size < MIN_DISTINCT_DATES) continue;

    const wasCreated = upsertAliasSuggestion({
      bookId: evidence.bookId,
      aliasText: evidence.aliasText,
      occurrenceCount: evidence.count,
      distinctDatesCount: evidence.dates.size,
      sampleRawTexts: evidence.samples,
    });
    if (wasCreated) created++;
  }
  return created;
}

module.exports = { mineAliasSuggestions, extractCandidateAlias };
