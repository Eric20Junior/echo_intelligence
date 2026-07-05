const { normalize } = require("./normalize");
const { extractCandidate } = require("./extract");
const { validateCandidate, getConfidenceThreshold } = require("./validate");

// Regex-only pass over a raw transcript chunk. LLM fallback (design doc §4 stage 3)
// is intentionally not wired in yet — this is stage 1/2/4/5 only.
function parseUtterance(rawText) {
  const normalized = normalize(rawText);
  const candidate = extractCandidate(normalized);
  if (!candidate) {
    return { status: "no_match", normalized };
  }

  const result = validateCandidate(candidate);
  if (!result.valid) {
    return { status: "invalid", normalized, candidate, reason: result.reason };
  }

  return {
    status: result.confidence >= getConfidenceThreshold() ? "auto_display" : "suggest",
    normalized,
    candidate,
    confidence: result.confidence,
  };
}

// Manual verse entry (operator types a reference directly): reuses the exact
// same normalize -> extract -> validate pipeline as spoken input (no separate
// grammar), so a typed reference obeys the same book/chapter/verse bounds and
// the same alias table (including its full-name-only limitation) as speech.
function parseManualReference(text) {
  const normalized = normalize(text);
  const candidate = extractCandidate(normalized);
  if (!candidate) return { valid: false, reason: "could not find a book name and chapter in that text" };

  const result = validateCandidate(candidate);
  if (!result.valid) return { valid: false, reason: result.reason };

  return { valid: true, candidate: { ...candidate, source: "manual" } };
}

module.exports = { parseUtterance, parseManualReference };
