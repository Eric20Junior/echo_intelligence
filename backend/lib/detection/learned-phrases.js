// Runtime overlay of operator-approved content-lookup phrases (lib/detection/
// phrase-miner.js produces the suggestions; a human approves them via the REST
// endpoints in lib/server/api-server.js). Mirrors lib/detection/
// learned-aliases.js's shape exactly, but the match is word-overlap against a
// specific target verse instead of exact-alias-word lookup, since real speech
// rarely repeats a lookup phrase verbatim (CTO-reviewed: see phrase-miner.js
// header for why word-overlap clustering was chosen over phrase-text equality).
const { getApprovedPhraseSuggestions, markPhraseSuggestionMatched } = require("../log");

const OVERLAP_RATIO_THRESHOLD = 0.6;
const MIN_SHARED_TERMS = 2;

// Rebuilt from the DB once per process, same reasoning as learned-aliases.js —
// approvals happen rarely (an operator's own review action), so there's no
// need to re-query on every utterance.
let cache = null;

function getLearnedPhrases() {
  if (!cache) {
    // Lazy require: content-search.js requires this module, so this module
    // must not require content-search.js at the top level (cycle) — pull in
    // significantWords/wordSetOverlap only when actually building the cache.
    const { significantWords, wordSetOverlap } = require("./content-search");
    const approved = getApprovedPhraseSuggestions();
    cache = {
      wordSetOverlap,
      entries: approved.map((row) => ({
        id: row.id,
        bookId: row.book_id,
        chapter: row.chapter,
        verseStart: row.verse_start,
        sampleWordSets: JSON.parse(row.sample_raw_texts).map((text) => significantWords(text)),
      })),
    };
  }
  return cache;
}

// For lib/server (the approve REST handler) to call so an approval takes
// effect immediately, no restart — same as learned-aliases.js's
// reloadLearnedAliases().
function reloadLearnedPhrases() {
  cache = null;
}

// Returns matched entries (deduped by target verse, best-overlap first), or
// [] if nothing clears the threshold. Only ever called post-gate (see
// content-search.js#tryContentLookup's header comment on why) — this has no
// structural anchor against ordinary sermon speech on its own.
function findLearnedPhraseMatches(incomingWords) {
  const { entries, wordSetOverlap } = getLearnedPhrases();
  const scored = [];
  for (const entry of entries) {
    let best = { ratio: 0, shared: 0 };
    for (const sampleWords of entry.sampleWordSets) {
      const result = wordSetOverlap(incomingWords, sampleWords);
      if (result.ratio > best.ratio) best = result;
    }
    if (best.ratio >= OVERLAP_RATIO_THRESHOLD && best.shared >= MIN_SHARED_TERMS) {
      scored.push({ entry, score: best.ratio });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  for (const { entry } of scored) markPhraseSuggestionMatched(entry.id);
  return scored.map(({ entry }) => entry);
}

module.exports = { findLearnedPhraseMatches, reloadLearnedPhrases };
