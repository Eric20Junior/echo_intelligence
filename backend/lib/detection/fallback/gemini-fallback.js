// Gemini LLM fallback (design doc §4 stage 3). Mirrors llm-fallback.js's candidate
// shape and calling convention exactly, so lib/detection/detect.js can pick between
// the backends based on config.getDetectorBackend() with no other code change.
//
// Deliberately uses the REST endpoint via global fetch rather than @google/genai: the
// packaged single-file builds have twice shipped broken because a dependency's native
// binary or binary asset wasn't bundled (the local-LLM binary, then ffmpeg — both
// passed CI). A plain HTTPS call has nothing to bundle and cannot regress that way.
//
// Exists because Google's free tier means a church with no card on file can still run
// the cloud detector, which is strongly preferable to the local model — see
// local-llm.js for why that path can drop the STT connection mid-service.
const { findBookByAlias } = require("../../../data/books");

const API_ORIGIN = "https://generativelanguage.googleapis.com";
// Flash-Lite is the cheapest/fastest tier and has the most generous free-tier rate
// limit; this is a short classification, not generation, so the small model is ample.
// The moving "-latest" alias rather than a pinned version on purpose: Google retires
// specific versions for new API keys (gemini-2.5-flash-lite already 404s "no longer
// available to new users"), which would silently break the fallback in a shipped
// release long after the pin was chosen — precisely the ship-and-rot failure this
// codebase keeps hitting. The alias always resolves to the current flash-lite, and a
// short classification is insensitive enough to model drift that the trade is worth it.
// Set GEMINI_MODEL to pin a specific version if an install ever needs reproducibility.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

// Bounded so a slow or hung API call can't stall the detection pipeline during a live
// service. The fallback is best-effort by design — the regex pass already failed, so
// timing out here costs a detection we didn't have, not one we lose.
const REQUEST_TIMEOUT_MS = 8000;

// No separate `isReference` boolean, for the same reason local-llm.js omits one: with
// constrained JSON output the model emits keys in schema order, so a boolean listed
// before the fields it depends on gets committed before the model has worked them out.
// bookName === null is the "no reference" signal instead — it has no earlier field to
// contradict. propertyOrdering pins that order rather than leaving it to chance.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    bookName: { type: "STRING", nullable: true },
    chapter: { type: "INTEGER", nullable: true },
    verseStart: { type: "INTEGER", nullable: true },
    verseEnd: { type: "INTEGER", nullable: true },
  },
  propertyOrdering: ["bookName", "chapter", "verseStart", "verseEnd"],
};

function buildPrompt(rawText) {
  return `Transcript fragment from a live church service, possibly garbled by speech-to-text: "${rawText}"\n\nDoes this contain a spoken Bible reference (a book name plus a chapter, optionally a verse)? STT errors are common — a book name may be misheard as a similar-sounding word. If you can confidently infer the intended book, chapter, and verse despite STT noise, extract them. If there's no reference here at all, set bookName to null.`;
}

// Returns a candidate shaped like extract.js's output (with source: "llm"), or null.
async function extractCandidateViaLLM(rawText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const url = `${API_ORIGIN}/v1beta/models/${MODEL}:generateContent`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(rawText) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          maxOutputTokens: 256,
        },
      }),
    });
  } catch (err) {
    // Timeout, DNS failure, offline venue — degrade to "no candidate" rather than
    // throwing into the detection pipeline mid-service.
    console.warn(`[gemini-fallback] request failed: ${err.message}`);
    return null;
  }

  if (!response.ok) {
    // 429 (free-tier rate limit) is the expected one here and is not worth retrying
    // inline — the next utterance gets its own chance.
    console.warn(`[gemini-fallback] HTTP ${response.status}`);
    return null;
  }

  let parsed;
  try {
    const body = await response.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null; // safety block or empty candidate
    parsed = JSON.parse(text);
  } catch (err) {
    console.warn(`[gemini-fallback] unparseable response: ${err.message}`);
    return null;
  }

  if (!parsed.bookName) return null;

  const match = findBookByAlias(parsed.bookName.toLowerCase());
  if (!match) return null;

  return {
    bookId: match.book.id,
    bookName: match.book.name,
    matchedAlias: parsed.bookName.toLowerCase(),
    aliasTier: "llm", // distinct tier: correct extraction, but the deterministic pass already failed
    source: "llm",
    chapter: parsed.chapter,
    verseStart: parsed.verseStart,
    verseEnd: parsed.verseEnd,
  };
}

module.exports = { extractCandidateViaLLM };
