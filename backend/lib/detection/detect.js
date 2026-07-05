// Full pipeline (design doc §4, all 5 stages) + §6 logging. Layered on top of the
// synchronous, regex-only parseUtterance so the offline test corpus stays fast and
// doesn't need network access — this is the entry point live audio should call.
const { parseUtterance } = require("./parse");
const { validateCandidate, getConfidenceThreshold } = require("./validate");
const { logDetection } = require("../log");
const readingMode = require("./reading-mode");
const { getDetectorBackend } = require("../config");

// Required lazily (not at module load) so a "local" install never pulls in
// @anthropic-ai/sdk, and an "anthropic" install never pays node-llama-cpp's
// native-module load cost.
function getLLMFallback() {
  return getDetectorBackend() === "anthropic" ? require("./fallback/llm-fallback") : require("./fallback/local-llm");
}

async function detectReference(rawText) {
  // Content lookup ("what's the verse that talks about training up a child") is a
  // different question from every other stage below (which all try to parse a
  // spoken REFERENCE) — CTO-reviewed placement: checked first, as its own branch,
  // not a fallback stage, since a garbled reference could spuriously contain
  // lookup-trigger words. lib/detection/content-search.js's trigger-phrase gate is
  // deliberately narrow, so this only ever fires on an explicit "find me a verse"
  // style ask, never on ordinary sermon speech.
  //
  // Always suggest-tier, unconditionally — never computed against
  // getConfidenceThreshold(), so a future threshold calibration can never
  // accidentally let a content match auto-display. A content match is inherently
  // more ambiguous than a spoken reference (multiple verses can share wording), so
  // this always needs a human to confirm before it reaches the congregation.
  const { tryContentLookup } = require("./content-search");
  const contentMatches = tryContentLookup(rawText);
  if (contentMatches && contentMatches.length > 0) {
    const candidate = contentMatches[0];
    const result = {
      status: "suggest",
      normalized: rawText.toLowerCase(),
      candidate,
      confidence: 0.5,
    };
    const logId = logDetection(rawText, result);
    return { ...result, logId };
  }

  let result = parseUtterance(rawText);

  // Reading mode (roadmap Phase 4.5): cheap, deterministic, tried before the LLM
  // fallback for the same reason regex runs before the LLM — only kicks in once a
  // book/chapter has been locked in by an earlier confirmed reference.
  if (result.status === "no_match") {
    const navCandidate = readingMode.tryNavigate(result.normalized);
    if (navCandidate) {
      const validated = validateCandidate(navCandidate);
      result = validated.valid
        ? {
            status: validated.confidence >= getConfidenceThreshold() ? "auto_display" : "suggest",
            normalized: result.normalized,
            candidate: navCandidate,
            confidence: validated.confidence,
          }
        : { status: "invalid", normalized: result.normalized, candidate: navCandidate, reason: validated.reason };
    }
  }

  if (result.status === "no_match") {
    const llmCandidate = await getLLMFallback().extractCandidateViaLLM(rawText);
    if (llmCandidate) {
      const validated = validateCandidate(llmCandidate);
      result = validated.valid
        ? {
            status: validated.confidence >= getConfidenceThreshold() ? "auto_display" : "suggest",
            normalized: result.normalized,
            candidate: llmCandidate,
            confidence: validated.confidence,
          }
        : { status: "invalid", normalized: result.normalized, candidate: llmCandidate, reason: validated.reason };
    }
  }

  // Only auto_display locks automatically — a suggest-tier result (including a
  // reading-mode nav match, which is always capped below the threshold) only
  // becomes a lock once the operator confirms it (lib/presentation.js#approve).
  if (result.status === "auto_display") {
    readingMode.lock(result.candidate);
  }

  // Tag a still-unmatched utterance with the active reading-mode lock, if any
  // (lib/detection/reading-nav-miner.js mines these): reading mode was locked
  // to a specific book/chapter and neither the regex patterns nor the LLM
  // fallback could place this utterance there, so it's a candidate "reading
  // mode should have caught this phrasing but didn't" case — the same
  // "improves over time, human-reviewed" idea as alias-miner.js/phrase-miner.js,
  // applied to navigation phrasing instead of vocabulary. Doesn't change
  // `status` — this utterance is still logged as an ordinary no_match, just
  // with enough context attached to pair it with a later manual correction.
  if (result.status === "no_match") {
    const lockedState = readingMode.getState();
    if (lockedState) {
      result = {
        ...result,
        candidate: { bookId: lockedState.bookId, chapter: lockedState.chapter, verseStart: null, verseEnd: null },
        reason: "reading-mode-miss",
      };
    }
  }

  const logId = logDetection(rawText, result);
  return { ...result, logId };
}

module.exports = { detectReference };
