const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { DeepgramClient } = require("@deepgram/sdk");
const { detectReference } = require("../lib/detection/detect");
const { resolveVerseText } = require("../lib/detection/resolve");
const { BOOK_KEYTERMS } = require("../lib/capture/keyterms");

const AUDIO_DIR = path.join(__dirname, "..", "test-audio");
const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

async function transcribeWith(audio, options) {
  const start = Date.now();
  const response = await deepgram.listen.v1.media.transcribeFile(audio, options);
  return { elapsedMs: Date.now() - start, alt: response.results.channels[0].alternatives[0] };
}

// nova-3 + keyterm boosting recovers book names best, but occasionally returns an
// empty/near-empty transcript on a clip nova-2 handles fine (observed 2026-07-02) —
// fall back rather than silently losing the whole utterance.
const MIN_WORDS_BEFORE_FALLBACK = 3;

async function transcribe(filePath) {
  const audio = fs.readFileSync(filePath);

  let result;
  try {
    result = await transcribeWith(audio, {
      model: "nova-3",
      smart_format: "true",
      punctuate: "true",
      keyterm: BOOK_KEYTERMS,
    });
  } catch (error) {
    console.error(`  ERROR: ${error.message}`);
    return;
  }

  if (result.alt.transcript.trim().split(/\s+/).filter(Boolean).length < MIN_WORDS_BEFORE_FALLBACK) {
    console.log(`  (nova-3 returned too little, falling back to nova-2)`);
    try {
      result = await transcribeWith(audio, { model: "nova-2", smart_format: "true", punctuate: "true" });
    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
      return;
    }
  }

  const { elapsedMs, alt } = result;
  console.log(`  latency: ${elapsedMs}ms | confidence: ${alt.confidence.toFixed(3)} | words: ${alt.words.length}`);

  // A full sermon transcript isn't one utterance — parsing it as a single blob would
  // only ever surface the first reference in the whole recording. Split into sentences
  // (a rough stand-in for the per-utterance chunks live streaming STT would emit) and
  // parse each independently, same as production would see them one at a time.
  const sentences = alt.transcript.split(/(?<=[.!?])\s+/).filter(Boolean);
  console.log(`  transcript: ${sentences.length} sentence(s), ${alt.transcript.length} chars`);

  let found = 0;
  for (const sentence of sentences) {
    const parsed = await detectReference(sentence);
    if (parsed.status === "auto_display" || parsed.status === "suggest") {
      found++;
      const { bookName, chapter, verseStart, verseEnd } = parsed.candidate;
      const ref = verseStart == null ? `${bookName} ${chapter}` : `${bookName} ${chapter}:${verseStart}${verseEnd ? `-${verseEnd}` : ""}`;
      console.log(`\n  [${parsed.status}] "${sentence.trim()}"`);
      console.log(`  -> ${ref}\n  ${resolveVerseText(parsed.candidate)}`);
    }
  }
  console.log(`\n  ${found} reference(s) detected across ${sentences.length} sentences`);
}

async function main() {
  const files = fs
    .readdirSync(AUDIO_DIR)
    .filter((f) => f.endsWith(".aac") || f.endsWith(".opus"));

  for (const file of files) {
    console.log(`\n=== ${file} ===`);
    await transcribe(path.join(AUDIO_DIR, file));
  }
}

main();
