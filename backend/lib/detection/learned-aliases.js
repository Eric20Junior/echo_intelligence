// Runtime overlay of operator-approved aliases (lib/detection/alias-miner.js
// produces the suggestions; a human approves them via the REST endpoints in
// lib/server/api-server.js). Deliberately separate from data/books.js (the
// static alias table) rather than merged into it — data/books.js is required by
// lib/log.js, and log.js is exactly where approved aliases are stored, so merging
// them into data/books.js would create a require cycle. This module depends on
// both instead: BOOKS (to resolve a bookId to a book object) and log.js (to read
// approvals), with no cycle back to either.
const { BOOKS } = require("../../data/books");
const { getApprovedAliasSuggestions, markAliasSuggestionMatched } = require("../log");

const BOOK_BY_ID = new Map(BOOKS.map((b) => [b.id, b]));

// Rebuilt from the DB once per process (approvals happen rarely — via the
// operator's own review action — so there's no need to re-query on every
// utterance; a restart or a future "reload" call picks up new approvals).
let cache = null;

function getLearnedAliases() {
  if (!cache) {
    const approved = getApprovedAliasSuggestions();
    const aliasToEntry = new Map(); // alias -> { book, suggestionId }
    for (const row of approved) {
      const book = BOOK_BY_ID.get(row.book_id);
      if (!book) continue; // shouldn't happen, but don't crash extraction over a stale row
      aliasToEntry.set(row.alias_text, { book, suggestionId: row.id });
    }
    cache = {
      aliasToEntry,
      aliasesByLengthDesc: [...aliasToEntry.keys()].sort((a, b) => b.length - a.length),
    };
  }
  return cache;
}

// For lib/detection/detect.js to call once, at startup, right after mining +
// approvals are settled for this process run — avoids ever serving a stale cache
// mid-session if this module happened to load before an approval was recorded.
function reloadLearnedAliases() {
  cache = null;
}

function findLearnedAlias(alias) {
  return getLearnedAliases().aliasToEntry.get(alias) ?? null;
}

function getLearnedAliasesByLengthDesc() {
  return getLearnedAliases().aliasesByLengthDesc;
}

// Tier is always "variant" (CTO guardrail: never "primary" — a learned alias must
// never alone be strong enough to skip the operator's confirm queue without a
// verse-number or plan-match bonus on top, same ceiling logic as any other
// homophone correction in data/book-aliases.js).
function recordLearnedAliasMatch(suggestionId) {
  markAliasSuggestionMatched(suggestionId);
}

module.exports = { findLearnedAlias, getLearnedAliasesByLengthDesc, recordLearnedAliasMatch, reloadLearnedAliases };
