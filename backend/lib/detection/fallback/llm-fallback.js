// LLM fallback (design doc §4 stage 3): only invoked when the regex pass finds
// nothing. Classification, not generation — a small/fast model is sufficient
// (design doc explicitly calls out Haiku 4.5 for this reason).
const Anthropic = require("@anthropic-ai/sdk");
const { findBookByAlias } = require("../../../data/books");

const client = new Anthropic();

const EXTRACT_TOOL = {
  name: "extract_scripture_reference",
  description: "Record whether the text contains a spoken Bible reference, and its fields if so.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      isReference: { type: "boolean", description: "True if the text contains a scripture reference." },
      bookName: { type: ["string", "null"], description: "Canonical English book name, e.g. 'Psalms', '1 Corinthians'." },
      chapter: { type: ["integer", "null"] },
      verseStart: { type: ["integer", "null"] },
      verseEnd: { type: ["integer", "null"], description: "Set only for a verse range." },
    },
    required: ["isReference", "bookName", "chapter", "verseStart", "verseEnd"],
    additionalProperties: false,
  },
};

// Returns a candidate shaped like extract.js's output (with source: "llm"), or null.
async function extractCandidateViaLLM(rawText) {
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "extract_scripture_reference" },
    messages: [
      {
        role: "user",
        content: `Transcript fragment from a live church service, possibly garbled by speech-to-text: "${rawText}"\n\nDoes this contain a spoken Bible reference (a book name plus a chapter, optionally a verse)? STT errors are common — a book name may be misheard as a similar-sounding word. If you can confidently infer the intended book, chapter, and verse despite STT noise, extract them. If there's no reference here at all, set isReference to false.`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || !toolUse.input.isReference || !toolUse.input.bookName) {
    return null;
  }

  const match = findBookByAlias(toolUse.input.bookName.toLowerCase());
  if (!match) return null;

  return {
    bookId: match.book.id,
    bookName: match.book.name,
    matchedAlias: toolUse.input.bookName.toLowerCase(),
    aliasTier: "llm", // distinct tier: correct extraction, but the deterministic pass already failed
    source: "llm",
    chapter: toolUse.input.chapter,
    verseStart: toolUse.input.verseStart,
    verseEnd: toolUse.input.verseEnd,
  };
}

module.exports = { extractCandidateViaLLM };
