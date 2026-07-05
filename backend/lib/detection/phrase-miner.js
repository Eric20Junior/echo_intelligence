// Phrase-suggestion mining — the content-search analog of alias-miner.js's
// "improves over time, human-reviewed" mechanism, extended per CTO review
// (2026-07-04) to cover content-lookup phrases (lib/detection/
// content-search.js) instead of single mis-heard book-name words.
//
// Same core heuristic as alias-miner.js: a `manual` decision row logs the
// operator's clean typed reference, not the audio that failed, so it gets
// paired by proximity with a preceding miss row logged moments earlier.
// Two real differences from the alias case, both CTO-reviewed:
//
// 1. The miss pool is wider than plain `no_match` rows. Content-search has a
//    middle tier reference-detection doesn't: an utterance can pass the
//    lookup trigger gate, get ranked by FTS, and still be WRONG (logged as
//    `suggest`/`source=content-search`, not `no_match`). So the pool here is
//    (a) `no_match` rows whose raw text independently passes
//    content-search.js's trigger gate (a gate match that returned zero FTS
//    rows) UNION (b) `suggest`/content-search rows the operator explicitly
//    rejected. Both are already gate-legitimate lookup attempts — this
//    module never mines from ordinary sermon speech that merely failed to
//    match anything, since that's not a content-lookup miss at all.
//
// 2. Aggregation key is the TARGET VERSE (book+chapter+verse), not phrase
//    text — real lookup phrasing almost never repeats verbatim, but an
//    operator resolving different wordings to the same well-known verse
//    recurs far more often. Each qualifying sample's significant-word set is
//    stored individually (never unioned into one bag per verse — unioning
//    would let two unrelated topics that happen to share a target verse
//    conflate into an overly broad word bag, widening the false-positive
//    surface at match time for no benefit). Matching those word sets against
//    a live utterance happens in learned-phrases.js, and — CTO guardrail —
//    only ever runs AFTER content-search's own trigger gate has already
//    matched, never as an alternative way to satisfy that gate.
const { getManualEntries, getNoMatchEntries, getContentSearchMisses, upsertPhraseSuggestion } = require("../log");
const { passesLookupGate, significantWords } = require("./content-search");

const PAIRING_WINDOW_MS = 25_000; // same window alias-miner.js uses, same reasoning
const MIN_OCCURRENCES = 3; // lower than aliases' 5 — phrase wording varies more, so per-install volume is naturally lower
const MIN_DISTINCT_DATES = 2;
const MAX_SAMPLES_STORED = 3;
// Must match learned-phrases.js's MIN_SHARED_TERMS — a sample with fewer
// significant words than that could never itself clear the match threshold,
// so a suggestion built entirely from such samples would be dead on arrival.
const MIN_SIGNIFICANT_WORDS = 2;

function pairManualEntriesWithMisses() {
  const manualEntries = getManualEntries().filter((m) => m.book_id && m.chapter != null && m.verse_start != null);

  const missPool = [
    ...getNoMatchEntries().filter((row) => passesLookupGate(row.raw_text)),
    ...getContentSearchMisses(),
  ].sort((a, b) => a.id - b.id);

  const missByDate = new Map(); // service_date -> miss rows, ascending by id
  for (const row of missPool) {
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
      const gap = manualTime - new Date(candidates[i].created_at).getTime();
      if (gap < 0) continue;
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
// startup, same as calibrate.js/alias-miner.js.
function minePhraseSuggestions() {
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
    // Guard against a degenerate sample (e.g. only stopwords) producing an
    // empty word set that would match everything at match time.
    if (!evidence.samples.some((s) => significantWords(s).size >= MIN_SIGNIFICANT_WORDS)) continue;

    const wasCreated = upsertPhraseSuggestion({
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

module.exports = { minePhraseSuggestions };
