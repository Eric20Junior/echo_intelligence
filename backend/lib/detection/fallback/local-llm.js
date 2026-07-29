// Local LLM fallback (design doc §4 stage 3; roadmap "offline LLM migration"). Mirrors
// llm-fallback.js's candidate shape and calling convention exactly, so lib/detect.js can
// pick between the two based on config.getDetectorBackend() with no other code change.
// Runs a small quantized Qwen2.5 model in-process via node-llama-cpp — no network call,
// no API key, "improves over time" via the regex/alias tuning described in the roadmap
// rather than any fine-tuning of this model.
const fs = require("fs");
const { findBookByAlias } = require("../../../data/books");
const { resolveWritableDir } = require("../../paths");

// node-llama-cpp is ESM-only, so it's loaded via dynamic import from this CJS file.
const MODEL_URI = "hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M";
// Under the operator's data folder, not the install folder: this is a ~470MB
// download that happens on first use (see scripts/package.js on why it isn't
// bundled), and a native installer's app folder isn't writable.
const MODELS_DIR = resolveWritableDir("models");

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
let loadFailureLogged = false;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { getLlama, LlamaChatSession, resolveModelFile } = await import("node-llama-cpp");
      // Force CPU-only: operator laptops have unpredictable GPU drivers, and GPU
      // acceleration (Vulkan/CUDA/Metal) auto-detection here crashed on this dev
      // machine's Intel iGPU with a Vulkan "ErrorDeviceLost" — not worth the risk
      // for a product that must reliably run unattended during a live service.
      //
      // build: "never" because building from source is never a real option here and
      // attempting it makes a bad situation much worse. node-llama-cpp validates a
      // prebuilt binary by fork()ing a test process, and fork() runs
      // process.execPath — which in a packaged SEA build is our own executable, so
      // the "test process" relaunches Echo Intelligence instead of running the test
      // and the check can never pass. On Linux that check is mandatory for prebuilt
      // binaries (getShouldTestBinaryBeforeLoading returns true unconditionally
      // there; Windows with gpu:false and macOS skip it, which is why they load
      // fine), so the default "auto" then tries to git-clone and cmake-compile
      // llama.cpp on a volunteer's machine mid-service — verified directly against a
      // packaged Linux build. Without git and cmake that fails anyway, just after a
      // very long wait. "never" turns it into an immediate, legible failure that
      // extractCandidateViaLLM below reports and degrades past. The library itself
      // defaults to "never" under Electron for the same fork-can't-work reason.
      const llama = await getLlama({ gpu: false, build: "never" });
      // Downloads the model (~470MB) if it isn't in MODELS_DIR yet — packaged builds
      // ship that directory empty on purpose, see scripts/package.js. warmUp() below
      // is what normally triggers this, at startup rather than mid-service.
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
  let session, grammar;
  try {
    ({ session, grammar } = await getSession());
  } catch (err) {
    // Now that the model is fetched on demand rather than bundled, this is a
    // reachable path in a real venue: no uplink on first run, a blocked host, a
    // full disk. lib/detection/detect.js calls us without a try/catch (the regex
    // pass already failed, so a fallback returning nothing is an expected
    // outcome), and an unhandled rejection there would break detection for every
    // utterance, not just this one. Degrade to "no candidate" instead — matching
    // llm-fallback.js and gemini-fallback.js, so all three backends fail the same way.
    //
    // Logged once, not per utterance: getSession() caches the rejected promise, so
    // this branch is hit on every subsequent detection. Deliberately NOT retried —
    // a retry storm here means re-attempting a 470MB download during a service.
    if (!loadFailureLogged) {
      loadFailureLogged = true;
      console.warn(`[local-llm] model unavailable, local fallback disabled for this run: ${err.message}`);
    }
    return null;
  }

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

// Fetch + load the model ahead of time, called at startup by scripts/live-demo.js when
// this is the selected backend. Two reasons it isn't left to the first detection that
// needs one: the model is no longer bundled, so first use can mean a ~470MB download,
// and even once it's on disk the load + context build takes seconds. Both would
// otherwise land on a live utterance mid-service.
//
// Returns a promise but is safe to call without awaiting — failures are reported by
// extractCandidateViaLLM's handler, so this never produces an unhandled rejection and
// never blocks the server from coming up (the operator UI stays usable while a large
// download runs).
function warmUp() {
  // Only promise a download when there actually will be one — the message is the
  // operator's only warning that startup is about to pull ~470MB, and crying wolf on
  // every subsequent launch (or in a dev checkout, where the model is already there)
  // would train them to ignore it.
  const alreadyDownloaded =
    fs.existsSync(MODELS_DIR) && fs.readdirSync(MODELS_DIR).some((f) => f.endsWith(".gguf"));
  console.log(
    alreadyDownloaded
      ? "local scripture detection: loading model..."
      : "local scripture detection: downloading model (~470MB, one time only)...",
  );
  return getSession().then(
    () => console.log("local scripture detection: model ready"),
    (err) => console.warn(`local scripture detection unavailable: ${err.message}`),
  );
}

module.exports = { extractCandidateViaLLM, warmUp };
