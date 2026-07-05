// Runtime overlay of operator-approved reading-mode navigation phrases
// (lib/detection/reading-nav-miner.js produces the suggestions; a human
// approves them via the REST endpoints). Mirrors learned-phrases.js's
// word-overlap shape, but with one deliberate difference: matching is scoped
// to the CURRENTLY locked book+chapter, not global. A content-lookup phrase
// ("the verse about the fruit of the spirit") means the same thing no matter
// when it's said, so it can match any verse in the Bible — but a reading-nav
// phrase only ever means something relative to whatever chapter is already
// locked in, so matching outside that scope would be meaningless, not just
// imprecise.
const { getApprovedReadingNavSuggestions, markReadingNavSuggestionMatched } = require("../log");

const OVERLAP_RATIO_THRESHOLD = 0.6; // same bar as learned-phrases.js
const MIN_SHARED_TERMS = 2;

// Rebuilt from the DB once per process, same reasoning as learned-phrases.js —
// approvals happen rarely (an operator's own review action).
let cache = null;

function getLearnedReadingNav() {
  if (!cache) {
    // Lazy require: avoids a load-order assumption on content-search.js, same
    // precaution learned-phrases.js takes even though no cycle exists today.
    const { significantWords } = require("./content-search");
    const approved = getApprovedReadingNavSuggestions();
    cache = approved.map((row) => ({
      id: row.id,
      bookId: row.book_id,
      chapter: row.chapter,
      verseStart: row.verse_start,
      sampleWordSets: JSON.parse(row.sample_raw_texts).map((text) => significantWords(text)),
    }));
  }
  return cache;
}

// For the approve REST handler to call so an approval takes effect
// immediately, no restart — same as learned-phrases.js's reloadLearnedPhrases().
function reloadLearnedReadingNav() {
  cache = null;
}

// normalizedText: the utterance reading-mode is currently trying to navigate
// with (see lib/detection/normalize.js). bookId/chapter: the active lock —
// only ever matches a suggestion for that exact book+chapter (see header).
// Returns the matched entry (with its target verseStart) or null.
function findLearnedNavMatch(normalizedText, bookId, chapter) {
  const { significantWords, wordSetOverlap } = require("./content-search");
  const incomingWords = significantWords(normalizedText);
  if (incomingWords.size === 0) return null;

  const entries = getLearnedReadingNav();
  let best = null;
  let bestScore = 0;
  for (const entry of entries) {
    if (entry.bookId !== bookId || entry.chapter !== chapter) continue;
    for (const sampleWords of entry.sampleWordSets) {
      const result = wordSetOverlap(incomingWords, sampleWords);
      if (result.ratio >= OVERLAP_RATIO_THRESHOLD && result.shared >= MIN_SHARED_TERMS && result.ratio > bestScore) {
        bestScore = result.ratio;
        best = entry;
      }
    }
  }
  if (best) markReadingNavSuggestionMatched(best.id);
  return best;
}

module.exports = { findLearnedNavMatch, reloadLearnedReadingNav };
