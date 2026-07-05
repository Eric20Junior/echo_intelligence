// Candidate extraction (design doc §4, stage 2): deterministic regex/grammar pass.
// Book-alias occurrence is the load-bearing anchor — we never trigger on bare numbers.
const { ALIASES_BY_LENGTH_DESC, findBookByAlias } = require("../../data/books");
const { findLearnedAlias, getLearnedAliasesByLengthDesc, recordLearnedAliasMatch } = require("./learned-aliases");

// Separators are optional: compressed speech ("John three sixteen") never says
// "verse" or a colon out loud, so a bare trailing number is treated as the verse.
// The range connector is deliberately NOT a fixed word list (through/to/and/...)
// — every preacher phrases a verse range differently, and chasing each new word
// one at a time is a losing game. Instead: any single word standing between two
// nearby verse numbers counts as a connector, whatever that word actually is
// ("verse one and two", "verse one through two", "verse one plus two" all match
// the same way). Capped at one filler word so it can't drift into an unrelated
// number appearing later in the sentence.
const AFTER_BOOK_PATTERN =
  /^\s*(?:chapter\s+)?(\d{1,3})(?:\s*(?::|verses?)?\s*(\d{1,3})(?:\s+(?:\S+\s+)?(\d{1,3}))?)?/;

// Single-chapter books (Jude, Philemon, 2/3 John, Obadiah) are never spoken with
// a chapter number — "Jude verses three and four" means chapter 1 verses 3-4,
// not chapter 3 verse 4. AFTER_BOOK_PATTERN alone would misread the first verse
// number as the chapter, so these books get a second pattern that requires the
// literal "verse(s)" word (no ambiguous bare-number case, since there's no
// chapter to be bare about) and forces chapter 1.
const VERSE_ONLY_PATTERN = /^\s*verses?\s+(\d{1,3})(?:\s+(?:\S+\s+)?(\d{1,3}))?/;

function escapeAliases(aliases) {
  return aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

let aliasRegex = null;
function getAliasRegex() {
  if (!aliasRegex) {
    aliasRegex = new RegExp(`\\b(${escapeAliases(ALIASES_BY_LENGTH_DESC).join("|")})\\b`, "i");
  }
  return aliasRegex;
}

// Rebuilt on every call (unlike the static regex above, which never changes) —
// approvals happen rarely via the operator's own review action, so this isn't a
// hot path, and it's simpler than threading a cache-invalidation signal through
// from lib/detection/learned-aliases.js.
function getLearnedAliasRegex() {
  const aliases = getLearnedAliasesByLengthDesc();
  if (aliases.length === 0) return null;
  return new RegExp(`\\b(${escapeAliases(aliases).join("|")})\\b`, "i");
}

function parseChapterVerse(rest, book) {
  const numMatch = AFTER_BOOK_PATTERN.exec(rest);
  if (numMatch && numMatch[1]) {
    return {
      chapter: Number(numMatch[1]),
      verseStart: numMatch[2] ? Number(numMatch[2]) : null,
      verseEnd: numMatch[3] ? Number(numMatch[3]) : null,
    };
  }

  if (book.maxChapter === 1) {
    const verseOnlyMatch = VERSE_ONLY_PATTERN.exec(rest);
    if (verseOnlyMatch) {
      return {
        chapter: 1,
        verseStart: Number(verseOnlyMatch[1]),
        verseEnd: verseOnlyMatch[2] ? Number(verseOnlyMatch[2]) : null,
      };
    }
  }

  return null; // book name with no chapter number isn't structurally complete enough to act on
}

// Returns the first candidate reference found in normalized text, or null. Tries
// the static alias table first; only falls back to operator-approved learned
// aliases (lib/detection/learned-aliases.js) if that misses entirely — a learned
// alias is always tagged "variant" tier (never "primary"), same confidence
// ceiling as any other homophone correction in data/book-aliases.js.
function extractCandidate(normalizedText) {
  const bookMatch = getAliasRegex().exec(normalizedText);
  if (bookMatch) {
    const alias = bookMatch[1];
    const { book, tier } = findBookByAlias(alias);
    const parsed = parseChapterVerse(normalizedText.slice(bookMatch.index + bookMatch[0].length), book);
    if (!parsed) return null;
    return { bookId: book.id, bookName: book.name, matchedAlias: alias, aliasTier: tier, ...parsed };
  }

  const learnedRegex = getLearnedAliasRegex();
  const learnedMatch = learnedRegex && learnedRegex.exec(normalizedText);
  if (learnedMatch) {
    const alias = learnedMatch[1];
    const entry = findLearnedAlias(alias);
    const parsed = parseChapterVerse(normalizedText.slice(learnedMatch.index + learnedMatch[0].length), entry.book);
    if (!parsed) return null;
    recordLearnedAliasMatch(entry.suggestionId);
    return { bookId: entry.book.id, bookName: entry.book.name, matchedAlias: alias, aliasTier: "variant", ...parsed };
  }

  return null;
}

module.exports = { extractCandidate };
