// Verse content lookup ("what's the verse that talks about training up a child" ->
// Proverbs 22:6), for when a preacher remembers the wording but not the reference.
// A fundamentally different operation from the rest of this pipeline (which detects
// a spoken REFERENCE) — this searches verse TEXT via SQLite FTS5 full-text search
// over the bundled KJV (backend/data/verses.db).
//
// CTO-reviewed before building (same session as lib/detection/alias-miner.js's
// review): the trigger-phrase gate below is the load-bearing safety mechanism, not
// polish — unguarded FTS over a ~31k-verse corpus would surface garbage matches on
// common words ("love", "faith", "child") against ordinary sermon speech. Only ever
// runs when the utterance explicitly asks for a verse lookup; a false negative here
// just means the preacher repeats the trigger phrase, a false positive means junk in
// the operator's queue — bias toward missing, never over-triggering.
//
// Always suggest-tier: a content match is inherently more ambiguous than a spoken
// reference (multiple verses can share themes/wording), so this never auto-displays
// — same "confirm before it hits the congregation" principle as every other
// low-certainty path in this pipeline. Returns up to 3 candidates (not just the top
// FTS rank) since common-word paraphrases won't always rank the true answer first;
// letting the operator pick de-risks ranking quality without adding embedding/ML infra.
const { resolvePath, requireNative } = require("../paths");
const { BOOKS } = require("../../data/books");
const Database = requireNative("better-sqlite3");

const BOOK_NAME_BY_ID = new Map(BOOKS.map((b) => [b.id, b.name]));
const MAX_RESULTS = 3;

// Doesn't require the literal word "verse" after shortest/longest — live testing
// caught Deepgram mishearing "verse" as "vas" ("what about the shortest vas?"),
// and "shortest"/"longest" alone are rare enough in ordinary sermon speech to be
// a strong signal by themselves without that anchor.
const SHORTEST_LONGEST_PATTERN = /\b(shortest|longest)\b/;
// Explicit allowlist, not a fuzzy classifier — deliberately narrow (see header).
// Covers real pulpit phrasing observed live, not just "what's the verse" — e.g.
// "I need this, this passage that talked about..." is how this actually gets said
// (note the natural speech-repetition "this, this" — real STT transcript, not a
// hypothetical), and "why is this passage/verse that talks about..." (also caught
// live — a preacher rhetorically asking about a passage rather than requesting one).
// The `.{0,20}?` gap between the trigger verb and verse/passage tolerates that kind
// of disfluency/filler without needing to enumerate every possible filler phrase,
// while staying bounded so it can't drift across an entire unrelated sentence.
const LOOKUP_TRIGGER_PATTERN =
  /\b(?:what(?:'s|\s+is)?\s+the\s+verse|what\s+verse|why\s+(?:is|does)\s+this\s+(?:verse|passage)|(?:i\s+(?:need|want)|find\s+me|give\s+me|look\s+up).{0,20}?\b(?:verse|passage))\b\s*(?:that\s+)?(?:says?|talks?\s+about|mentions?|is\s+about|talked\s+about)?\s*(.*)/;

// Common words that carry no discriminating signal for phrase-similarity
// matching (lib/detection/phrase-miner.js, learned-phrases.js) — stripped from
// both a stored sample and an incoming utterance before computing word-set
// overlap, same spirit as searchByContent's `length > 1` filter but broader
// since these are specifically the trigger-phrase's own boilerplate words,
// which would otherwise inflate overlap between two otherwise-unrelated asks.
const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "this", "that", "these", "those",
  "what", "whats", "why", "does", "do", "did", "and", "or", "of", "in", "on",
  "for", "with", "about", "to", "me", "us", "i", "you", "it", "verse", "verses",
  "passage", "says", "say", "talks", "talk", "talked", "talking", "mentions",
  "mention", "find", "give", "need", "want", "look", "up",
]);

// Normalizes an utterance into a significant-word set for overlap comparison
// (lib/detection/phrase-miner.js's clustering, learned-phrases.js's matching).
// Deliberately a plain Set, not a bag/multiset — repeated words in one
// utterance shouldn't weight a match more than distinct topic words would.
function significantWords(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  );
}

// Overlap coefficient |A ∩ B| / min(|A|, |B|), plus the raw shared-term count
// (a floor on the coefficient alone would let two single-shared-word sets
// "match" at 100% — CTO-reviewed: require both a high ratio AND a minimum
// absolute overlap so one common topic word like "child" can't alone fire).
function wordSetOverlap(a, b) {
  const minSize = Math.min(a.size, b.size);
  if (minSize === 0) return { ratio: 0, shared: 0 };
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return { ratio: shared / minSize, shared };
}

let db = null;
function getDb() {
  if (!db) {
    db = new Database(resolvePath("data", "verses.db"));
    // Built lazily against the existing verses.db (external-content FTS5 —
    // indexes the same rows rather than duplicating verse text) so this works
    // against any install's verses.db, dev or already-packaged, without a rebuild
    // step. verses has an implicit rowid (no WITHOUT ROWID clause), so this is safe.
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='verses_fts'").get();
    if (!exists) {
      db.exec(`
        CREATE VIRTUAL TABLE verses_fts USING fts5(text, content='verses', content_rowid='rowid');
        INSERT INTO verses_fts(verses_fts) VALUES('rebuild');
      `);
    }
  }
  return db;
}

function toCandidate(row) {
  return {
    bookId: row.book_id,
    bookName: BOOK_NAME_BY_ID.get(row.book_id) ?? row.book_id,
    chapter: row.chapter,
    verseStart: row.verse,
    verseEnd: null,
    text: row.text,
    source: "content-search",
  };
}

function findShortestOrLongest(kind) {
  const order = kind === "shortest" ? "ASC" : "DESC";
  const rows = getDb()
    .prepare(`SELECT book_id, chapter, verse, text FROM verses ORDER BY length(text) ${order} LIMIT ?`)
    .all(MAX_RESULTS);
  return rows.map(toCandidate);
}

function searchByContent(phrase) {
  const cleaned = phrase.trim();
  if (!cleaned) return [];
  // FTS5 special characters (", *, etc.) in raw speech would otherwise throw a
  // syntax error from the MATCH query — quote each term and OR them together
  // instead of passing the phrase through as a raw FTS query string.
  const terms = cleaned
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => `"${w.replace(/"/g, '""')}"`);
  if (terms.length === 0) return [];

  const rows = getDb()
    .prepare(
      `SELECT v.book_id, v.chapter, v.verse, v.text
       FROM verses_fts JOIN verses v ON v.rowid = verses_fts.rowid
       WHERE verses_fts MATCH ? ORDER BY bm25(verses_fts) LIMIT ?`
    )
    .all(terms.join(" OR "), MAX_RESULTS);
  return rows.map(toCandidate);
}

// For lib/detection/phrase-miner.js: is this utterance gate-legitimate (i.e.
// would tryContentLookup have treated it as a lookup attempt at all)? Used to
// filter the mining pool down to no_match rows that are actually
// content-lookup misses, not unrelated ordinary speech that happened to end
// up as no_match for some other reason.
function passesLookupGate(rawText) {
  const text = rawText.toLowerCase().trim();
  return SHORTEST_LONGEST_PATTERN.test(text) || LOOKUP_TRIGGER_PATTERN.test(text);
}

// Returns an array of candidates (never a single one — see header on why), or
// null if this utterance isn't an explicit content-lookup request at all.
function tryContentLookup(rawText) {
  const text = rawText.toLowerCase().trim();

  const shortLong = SHORTEST_LONGEST_PATTERN.exec(text);
  if (shortLong) return findShortestOrLongest(shortLong[1]);

  const trigger = LOOKUP_TRIGGER_PATTERN.exec(text);
  if (!trigger) return null;

  // The captured group only covers content stated AFTER the trigger phrase
  // ("what's the verse that says X"). Real speech often puts it BEFORE instead
  // ("He said Jesus wept. What's the verse?") — if the captured group is too
  // thin to search on, fall back to the whole utterance with the matched trigger
  // substring removed, so leading content isn't silently dropped.
  const afterTrigger = trigger[1].replace(/[^a-z0-9\s]/g, "").trim();
  const searchPhrase = afterTrigger.length > 3 ? afterTrigger : text.replace(trigger[0], " ").trim();

  // CTO-reviewed placement: learned phrases (lib/detection/learned-phrases.js,
  // operator-approved past resolutions) are only ever consulted here, AFTER
  // the trigger gate above has already matched — never as an alternative way
  // to satisfy the gate itself. A word-overlap match has no structural anchor
  // like the alias miner's trailing-chapter-number requirement, so letting it
  // bypass the gate would risk firing on ordinary thematic sermon speech
  // ("training up a child" said while just preaching about parenting, not
  // asking for a verse). Once the gate has already confirmed this IS a lookup
  // request, a learned-phrase hit only improves ranking/recall within it —
  // prepended ahead of raw FTS results since an operator-approved historical
  // resolution should outrank bm25 ranking on a fresh, possibly-thin query.
  const { findLearnedPhraseMatches } = require("./learned-phrases");
  const incomingWords = significantWords(searchPhrase);
  const learnedCandidates = findLearnedPhraseMatches(incomingWords)
    .map((m) => {
      const row = getDb()
        .prepare("SELECT text FROM verses WHERE book_id = ? AND chapter = ? AND verse = ?")
        .get(m.bookId, m.chapter, m.verseStart);
      if (!row) return null; // stale learned entry pointing at a verse that no longer resolves
      return toCandidate({ book_id: m.bookId, chapter: m.chapter, verse: m.verseStart, text: row.text });
    })
    .filter(Boolean);

  const ftsCandidates = searchByContent(searchPhrase);
  const seen = new Set(learnedCandidates.map((c) => `${c.bookId}:${c.chapter}:${c.verseStart}`));
  const merged = [...learnedCandidates];
  for (const c of ftsCandidates) {
    const key = `${c.bookId}:${c.chapter}:${c.verseStart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  return merged.slice(0, MAX_RESULTS);
}

module.exports = { tryContentLookup, passesLookupGate, significantWords, wordSetOverlap };
