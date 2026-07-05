// Validation layer (design doc §4 stage 4, §5): hard gate against the canonical
// book/chapter/verse-count table, plus a composite confidence score for the
// operator-confirm UX (below threshold => suggestion chip, not auto-display).
const { BOOKS } = require("../../data/books");
const plan = require("../server/plan");
const { getConfidenceThreshold } = require("../config");

function validateCandidate(candidate) {
  const book = BOOKS.find((b) => b.id === candidate.bookId);
  if (!book) return { valid: false, reason: "unknown book" };

  if (candidate.chapter < 1 || candidate.chapter > book.maxChapter) {
    return { valid: false, reason: `${book.name} has ${book.maxChapter} chapter(s), got ${candidate.chapter}` };
  }

  const maxVerse = book.versesPerChapter[candidate.chapter - 1];
  for (const verse of [candidate.verseStart, candidate.verseEnd]) {
    if (verse != null && (verse < 1 || verse > maxVerse)) {
      return {
        valid: false,
        reason: `${book.name} ${candidate.chapter} has ${maxVerse} verse(s), got ${verse}`,
      };
    }
  }
  if (candidate.verseEnd != null && candidate.verseStart != null && candidate.verseEnd < candidate.verseStart) {
    return { valid: false, reason: "verse range end before start" };
  }

  return { valid: true, confidence: scoreConfidence(candidate) };
}

function scoreConfidence(candidate) {
  let score = 0.5;
  if (candidate.aliasTier === "primary") score += 0.3; // clean/legitimate name
  else if (candidate.aliasTier === "variant") score += 0.1; // STT homophone correction
  else if (candidate.aliasTier === "reading-mode") score += 0.1; // deterministic nav, but no book-name anchor
  else score -= 0.1; // "llm": deterministic pass already failed — lower baseline (design doc §5)

  // reading-mode candidates never get the verseStart bonus or the plan-match
  // bonus below — capped at 0.6, always below CONFIDENCE_THRESHOLD, so every
  // nav match routes through operator confirm for V1 (roadmap Phase 4.5: zero
  // book-name safety net, only the app's own state).
  if (candidate.aliasTier !== "reading-mode") {
    score += candidate.verseStart != null ? 0.15 : 0; // full book+chapter+verse vs. chapter-only
    // Pre-service plan match (roadmap Phase 8 step 3): the operator already told
    // the app to expect this exact passage, so a detection matching it is less
    // likely a false positive than the same text would be blind.
    if (plan.matchesPlan(candidate)) score += 0.15;
  }
  return Math.max(0, Math.min(score, 1));
}

module.exports = { validateCandidate, getConfidenceThreshold };
