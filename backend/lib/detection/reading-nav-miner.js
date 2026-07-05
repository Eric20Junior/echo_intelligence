// Reading-nav-suggestion mining — the reading-mode navigation analog of
// alias-miner.js/phrase-miner.js's "improves over time, human-reviewed"
// mechanism, built per CTO review (2026-07-05) after a live gap: a pastor's
// "verse one... verse three... verse ten" reading was mostly caught once the
// fixed patterns were broadened, but any phrasing that never puts "verse"/
// "chapter" next to a number at all (an ordinal like "the fifth verse", or no
// number word whatsoever) still falls through. Same core heuristic as the
// other two miners: a `manual` decision row logs the operator's clean typed
// reference, paired by proximity with a preceding miss row logged moments
// earlier.
//
// One real difference from phrase-miner.js: the miss pool here already knows
// exactly which book+chapter reading-mode was locked to at miss time
// (lib/detection/detect.js tags it) — so pairing requires the manual entry's
// book+chapter to match the miss's locked book+chapter, not just "same day,
// closest in time". That's a much tighter, more precise pairing than the
// other two miners can do, since they have no equivalent "expected answer"
// to check against.
const { getManualEntries, getReadingModeMisses, upsertReadingNavSuggestion } = require("../log");

const PAIRING_WINDOW_MS = 25_000; // same window the other two miners use, same reasoning
const MIN_OCCURRENCES = 3; // same bar as phrase-miner.js — wording varies more than aliases do
const MIN_DISTINCT_DATES = 2;
const MAX_SAMPLES_STORED = 3;

function pairManualEntriesWithMisses() {
  const manualEntries = getManualEntries().filter((m) => m.book_id && m.chapter != null && m.verse_start != null);

  const missByDate = new Map(); // service_date -> miss rows, ascending by id
  for (const row of getReadingModeMisses()) {
    if (!missByDate.has(row.service_date)) missByDate.set(row.service_date, []);
    missByDate.get(row.service_date).push(row);
  }

  const pairs = [];
  for (const manual of manualEntries) {
    const candidates = missByDate.get(manual.service_date);
    if (!candidates || candidates.length === 0) continue;

    const manualTime = new Date(manual.created_at).getTime();
    let bestIndex = -1;
    let bestGap = Infinity;
    for (let i = candidates.length - 1; i >= 0; i--) {
      // The extra precision this miner has over alias/phrase-miner: only a
      // miss locked to the SAME book+chapter the operator just confirmed
      // could plausibly be "the same reference, just missed" — a miss locked
      // to a different chapter is evidence of nothing here, so it's skipped
      // without affecting the scan (a different-chapter miss sitting between
      // two same-chapter ones in time doesn't mean anything about the gap).
      if (candidates[i].book_id !== manual.book_id || candidates[i].chapter !== manual.chapter) continue;
      const gap = manualTime - new Date(candidates[i].created_at).getTime();
      if (gap < 0) continue;
      // Safe to stop scanning once a same-chapter candidate is too old — every
      // earlier same-chapter candidate is further in the past, so only larger.
      if (gap > PAIRING_WINDOW_MS) break;
      if (gap < bestGap) {
        bestGap = gap;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) continue;

    const [consumed] = candidates.splice(bestIndex, 1);
    pairs.push({
      bookId: manual.book_id,
      chapter: manual.chapter,
      verseStart: manual.verse_start,
      serviceDate: manual.service_date,
      missRow: consumed,
    });
  }
  return pairs;
}

// Cheap enough for a single-install's data volume — safe to call on every app
// startup, same as calibrate.js/alias-miner.js/phrase-miner.js.
function mineReadingNavSuggestions() {
  const pairs = pairManualEntriesWithMisses();

  const evidenceByKey = new Map(); // `${bookId}::${chapter}::${verseStart}` -> { ..., count, dates: Set, samples: [] }
  for (const { bookId, chapter, verseStart, serviceDate, missRow } of pairs) {
    if (!missRow.raw_text) continue;

    const key = `${bookId}::${chapter}::${verseStart}`;
    if (!evidenceByKey.has(key)) evidenceByKey.set(key, { bookId, chapter, verseStart, count: 0, dates: new Set(), samples: [] });
    const evidence = evidenceByKey.get(key);
    evidence.count++;
    evidence.dates.add(serviceDate);
    if (evidence.samples.length < MAX_SAMPLES_STORED) evidence.samples.push(missRow.raw_text);
  }

  let created = 0;
  for (const evidence of evidenceByKey.values()) {
    if (evidence.count < MIN_OCCURRENCES || evidence.dates.size < MIN_DISTINCT_DATES) continue;

    const wasCreated = upsertReadingNavSuggestion({
      bookId: evidence.bookId,
      chapter: evidence.chapter,
      verseStart: evidence.verseStart,
      occurrenceCount: evidence.count,
      distinctDatesCount: evidence.dates.size,
      sampleRawTexts: evidence.samples,
    });
    if (wasCreated) created++;
  }
  return created;
}

module.exports = { mineReadingNavSuggestions };
