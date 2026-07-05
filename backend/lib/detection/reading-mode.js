// Reading mode (roadmap Phase 4.5): a bounded state machine, not general anaphora
// resolution (design doc §7 explicitly excludes that from V1). Once a book/chapter
// is locked in by a confirmed reference, bare navigation ("next chapter", "verse 10")
// resolves relative to that lock instead of requiring a full reference every time.
const IDLE_TIMEOUT_MS = 8 * 60 * 1000;

// Deepgram's endpointing has been observed (2026-07-04 live service: pastor said
// "Genesis 17:6", system only ever received "Genesis 17," as its own finalized
// utterance — the verse number never arrived, in this utterance or any later one)
// to cut a chapter-only reference off before the verse number that follows it with
// only a brief pause. A bare number arriving shortly after a chapter-only lock is
// very likely that same dropped verse, not a coincidental unrelated number — but
// only within a short window, since sermons say plenty of ordinary numbers.
const BARE_NUMBER_VERSE_WINDOW_MS = 10 * 1000;

let state = null; // { bookId, bookName, chapter, verseStart, verseEnd, lockedAt }

function lock(candidate) {
  state = {
    bookId: candidate.bookId,
    bookName: candidate.bookName,
    chapter: candidate.chapter,
    verseStart: candidate.verseStart ?? null,
    verseEnd: candidate.verseEnd ?? null,
    lockedAt: Date.now(),
  };
}

function reset() {
  state = null;
}

function getState() {
  if (state && Date.now() - state.lockedAt > IDLE_TIMEOUT_MS) state = null;
  return state;
}

function buildCandidate(current, overrides) {
  return {
    bookId: current.bookId,
    bookName: current.bookName,
    chapter: current.chapter,
    verseStart: current.verseStart,
    verseEnd: current.verseEnd,
    ...overrides,
    matchedAlias: null,
    aliasTier: "reading-mode",
    source: "reading-mode",
  };
}

// Deliberately not anchored to the start or end of the utterance: real speech
// puts "verse one" anywhere in the sentence, before or after other words
// (observed live 2026-07-05: "Verse one says, now Naaman here's the guy..."
// and "Gonna read verse one through three, and I'm gonna read verse ten..."
// both never matched while this was start-and-end-anchored — that only ever
// caught the rare utterance that happened to say nothing else at all). The
// "verse"/"chapter" word plus a number right after it, word-bounded, is
// already a strong, low-false-positive anchor without also requiring it sit
// at a particular position in the sentence.
const VERSE_RANGE_PATTERN = /\bverses?\s+(\d{1,3})(?:\s*(?:through|to|-)\s*(\d{1,3}))?/;
const CHAPTER_PATTERN = /\bchapter\s+(\d{1,3})/;
const CHAPTER_AND_VERSE_PATTERN =
  /\bchapter\s+(\d{1,3})\s+verses?\s+(\d{1,3})(?:\s*(?:through|to|-)\s*(\d{1,3}))?/;

function nextVerse(current) {
  if (current.verseStart == null) return null; // no verse anchor to advance from
  return buildCandidate(current, { verseStart: (current.verseEnd ?? current.verseStart) + 1, verseEnd: null });
}

function previousVerse(current) {
  if (current.verseStart == null) return null;
  return buildCandidate(current, { verseStart: current.verseStart - 1, verseEnd: null });
}

function nextChapter(current) {
  return buildCandidate(current, { chapter: current.chapter + 1, verseStart: null, verseEnd: null });
}

function previousChapter(current) {
  return buildCandidate(current, { chapter: current.chapter - 1, verseStart: null, verseEnd: null });
}

// normalizedText: already lowercased/filler-stripped/number-word-converted by
// lib/normalize.js — reused here so "verse ten" and "verse 10" both match.
function tryNavigate(normalizedText) {
  const current = getState();
  if (!current) return null;

  if (/^next chapter$/.test(normalizedText)) return nextChapter(current);
  if (/^previous chapter$/.test(normalizedText)) return previousChapter(current);

  const chapterAndVerseMatch = CHAPTER_AND_VERSE_PATTERN.exec(normalizedText);
  if (chapterAndVerseMatch) {
    return buildCandidate(current, {
      chapter: Number(chapterAndVerseMatch[1]),
      verseStart: Number(chapterAndVerseMatch[2]),
      verseEnd: chapterAndVerseMatch[3] ? Number(chapterAndVerseMatch[3]) : null,
    });
  }
  const chapterMatch = CHAPTER_PATTERN.exec(normalizedText);
  if (chapterMatch) {
    return buildCandidate(current, { chapter: Number(chapterMatch[1]), verseStart: null, verseEnd: null });
  }

  if (/^next verse$/.test(normalizedText)) return nextVerse(current);
  if (/^previous verse$/.test(normalizedText)) return previousVerse(current);
  const verseMatch = VERSE_RANGE_PATTERN.exec(normalizedText);
  if (verseMatch) {
    return buildCandidate(current, {
      verseStart: Number(verseMatch[1]),
      verseEnd: verseMatch[2] ? Number(verseMatch[2]) : null,
    });
  }

  // Deepgram's endpointing frequently fragments "next verse"/"next chapter" down to
  // a bare "next" (confirmed in the field 2026-07-02) — advance the most granular
  // locked unit: verse if one's set, otherwise the whole chapter.
  if (/^next$/.test(normalizedText)) return current.verseStart != null ? nextVerse(current) : nextChapter(current);
  if (/^previous$/.test(normalizedText)) {
    return current.verseStart != null ? previousVerse(current) : previousChapter(current);
  }

  // See BARE_NUMBER_VERSE_WINDOW_MS above — only treats a standalone number as
  // the dropped verse of a just-locked chapter-only reference, never once a verse
  // is already set (that's ordinary sermon speech, not a fragmented reference).
  const bareNumberMatch = /^(\d{1,3})$/.exec(normalizedText);
  if (bareNumberMatch && current.verseStart == null && Date.now() - current.lockedAt <= BARE_NUMBER_VERSE_WINDOW_MS) {
    return buildCandidate(current, { verseStart: Number(bareNumberMatch[1]), verseEnd: null });
  }

  // Last resort: operator-approved phrasing mined from real logged misses (see
  // lib/detection/reading-nav-miner.js) — for wording that never puts "verse"/
  // "chapter" next to a number at all, so none of the fixed patterns above
  // could ever catch it. Lazy require avoids a load-order assumption, same as
  // detect.js's fallback requires.
  const { findLearnedNavMatch } = require("./learned-reading-nav");
  const learned = findLearnedNavMatch(normalizedText, current.bookId, current.chapter);
  if (learned) return buildCandidate(current, { verseStart: learned.verseStart, verseEnd: null });

  return null;
}

module.exports = { lock, reset, getState, tryNavigate };
