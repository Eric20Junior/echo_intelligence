// Local LLM fallback (design doc §4 stage 3; roadmap "offline LLM migration"). Mirrors
// llm-fallback.js's candidate shape and calling convention exactly, so lib/detect.js can
// pick between the two based on config.getDetectorBackend() with no other code change.
// Runs a small quantized Qwen2.5 model in-process via node-llama-cpp — no network call,
// no API key, "improves over time" via the regex/alias tuning described in the roadmap
// rather than any fine-tuning of this model.
const { findBookByAlias } = require("../../../data/books");
const { resolvePath } = require("../../paths");

// node-llama-cpp is ESM-only, so it's loaded via dynamic import from this CJS file.
const MODEL_URI = "hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M";
const MODELS_DIR = resolvePath("models");

// No separate `isReference` boolean: with grammar-constrained generation the model
// emits object keys strictly in schema order, so a boolean listed before the fields
// it should depend on gets committed before the model has "reasoned through" them —
// verified directly (it emitted isReference: false alongside a fully correct
// bookName/chapter/verse for an unambiguous input). bookName === null is the signal
// for "no reference" instead, since it has no earlier field to contradict.
const SCHEMA = {
  type: "object",
  properties: {
    bookName: { type: ["string", "null"] },
    chapter: { type: ["integer", "null"] },
    verseStart: { type: ["integer", "null"] },
    verseEnd: { type: ["integer", "null"] },
  },
};

// Lazily initialized once per process and reused across calls — loading the model and
// building a llama context takes seconds, far too slow to redo per utterance.
let sessionPromise = null;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { getLlama, LlamaChatSession, resolveModelFile } = await import("node-llama-cpp");
      // Force CPU-only: operator laptops have unpredictable GPU drivers, and GPU
      // acceleration (Vulkan/CUDA/Metal) auto-detection here crashed on this dev
      // machine's Intel iGPU with a Vulkan "ErrorDeviceLost" — not worth the risk
      // for a product that must reliably run unattended during a live service.
      const llama = await getLlama({ gpu: false });
      const modelPath = await resolveModelFile(MODEL_URI, MODELS_DIR);
      const model = await llama.loadModel({ modelPath });
      // Deliberately NOT threads: 0 (all cores). Saturating every core starves
      // the Node event loop of CPU time for the duration of inference (40-65s on
      // this machine's non-AVX2 CPU), which delays mic/audio-level processing and
      // Deepgram WS message handling badly enough to drop the STT connection
      // entirely mid-service — observed live, not theoretical. Leaving one core
      // free keeps the audio/STT pipeline responsive at the cost of somewhat
      // slower inference.
      const os = require("os");
      const threads = Math.max(1, os.cpus().length - 1);
      const context = await model.createContext({ threads });
      const grammar = await llama.createGrammarForJsonSchema(SCHEMA);
      const session = new LlamaChatSession({ contextSequence: context.getSequence() });
      return { session, grammar };
    })();
  }
  return sessionPromise;
}

// Returns a candidate shaped like extract.js's output (with source: "llm"), or null.
async function extractCandidateViaLLM(rawText) {
  const { session, grammar } = await getSession();

  const response = await session.prompt(
    `Transcript fragment from a live church service, possibly garbled by speech-to-text: "${rawText}"\n\nDoes this contain a spoken Bible reference (a book name plus a chapter, optionally a verse)? STT errors are common — a book name may be misheard as a similar-sounding word. If you can confidently infer the intended book, chapter, and verse despite STT noise, extract them. If there's no reference here at all, set bookName to null.`,
    { grammar }
  );

  const parsed = grammar.parse(response);
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
