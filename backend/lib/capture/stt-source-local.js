// Fully offline STT (roadmap "offline LLM migration" extended to speech-to-text):
// runs Whisper in-process via @huggingface/transformers (ONNX Runtime — ships a
// prebuilt native binary per platform, no compiler needed on the operator's
// machine, same "no local build" requirement that made node-llama-cpp the right
// choice for the local LLM fallback; smart-whisper/whisper.cpp were rejected
// because they require compiling whisper.cpp's C++ source on install).
//
// Unlike Deepgram's websocket, there's no true streaming API here — audio is
// buffered and transcribed in silence-bounded chunks instead, using the same
// rmsLevel() mic-source.js already computes for the level meter. The silence
// threshold/hang time describe this app's mic input (room noise floor, podium
// mic characteristics), not any one preacher's cadence, so they don't need
// retuning per speaker — see the "avoid rigid patterns" note in project memory.
// Exposes the same connect({onTranscript, onError, onClose}) -> {sendAudio, stop}
// shape as stt-source.js, so lib/server/session.js needs zero changes to pick
// between the two (see lib/config.js's getSttBackend()).
const { rmsLevel } = require("./audio-level");
const { resolvePath } = require("../paths");
const { SAMPLE_RATE } = require("./mic-source");

const MODEL_ID = "onnx-community/whisper-tiny.en";
const CACHE_DIR = resolvePath("models", "whisper");

const SILENCE_RMS_THRESHOLD = 0.02; // below this = "quiet", tuned to mic noise floor, not speaking pace
const SILENCE_HANG_MS = 700; // finalize an utterance after this much continuous quiet
const MAX_SEGMENT_MS = 12000; // hard cap so a speaker who never pauses still gets periodic transcripts
const MIN_SPEECH_MS = 250; // ignore segments too short to be real speech (coughs, mic bumps)
// On CPU-only hardware without AVX2 (confirmed on this machine, same limitation
// already documented for the local LLM fallback), transcribing MAX_SEGMENT_MS of
// audio can take longer than MAX_SEGMENT_MS itself — real-time audio keeps
// arriving faster than it can be transcribed. Without a hard ceiling, the
// buffered segment snowballs past Whisper's fixed 30s context window (observed
// live: several sentences merged into one slow, increasingly stale block).
// Past this ceiling, the stale backlog is dropped rather than grown further —
// losing that stretch of speech, but keeping the delay bounded instead of
// compounding indefinitely. Not a fix for the underlying throughput limit;
// see lib/capture/stt-source-local.js's header for the real recommendation.
const OVERLOAD_DROP_MS = MAX_SEGMENT_MS * 2;

// Lazily initialized once per process and reused across calls — loading the
// model takes a couple of seconds, far too slow to redo per utterance.
let transcriberPromise = null;
function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Force CPU (no GPU backend selection) — mirrors local-llm.js's reasoning:
      // operator laptops have unpredictable GPU drivers, not worth the crash
      // risk for a product that must run unattended during a service.
      return pipeline("automatic-speech-recognition", MODEL_ID, {
        cache_dir: CACHE_DIR,
        dtype: "q8",
        device: "cpu",
      });
    })();
  }
  return transcriberPromise;
}

function pcmChunksToFloat32(chunks) {
  let totalSamples = 0;
  for (const chunk of chunks) totalSamples += chunk.length / 2;
  const out = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length - 1; i += 2) {
      out[offset++] = chunk.readInt16LE(i) / 32768;
    }
  }
  return out;
}

async function connect({ onTranscript, onError, onClose }) {
  const transcriber = await getTranscriber();

  let stopped = false;
  let busy = false;
  let chunks = [];
  let segmentMs = 0;
  let silenceMs = 0;
  let hasSpeech = false;

  async function finalizeSegment() {
    if (busy || !hasSpeech || segmentMs < MIN_SPEECH_MS) return;

    const pcm = pcmChunksToFloat32(chunks);
    chunks = [];
    segmentMs = 0;
    silenceMs = 0;
    hasSpeech = false;
    busy = true;
    try {
      // whisper-tiny.en is an English-only checkpoint — it errors if `language`
      // (or `task`) is passed at all, unlike the multilingual checkpoints.
      const result = await transcriber(pcm);
      const text = result?.text?.trim();
      if (text) onTranscript(text);
    } catch (err) {
      onError?.(err);
    } finally {
      busy = false;
    }
  }

  return {
    sendAudio: (chunk) => {
      if (stopped) return;

      // Still transcribing a previous segment and already over the overload
      // ceiling — drop the growing backlog instead of letting it snowball
      // further (see OVERLOAD_DROP_MS above).
      if (busy && segmentMs >= OVERLOAD_DROP_MS) {
        chunks = [];
        segmentMs = 0;
        silenceMs = 0;
        hasSpeech = false;
        return;
      }

      const level = rmsLevel(chunk);
      const chunkMs = (chunk.length / 2 / SAMPLE_RATE) * 1000;
      chunks.push(chunk);
      segmentMs += chunkMs;

      if (level >= SILENCE_RMS_THRESHOLD) {
        hasSpeech = true;
        silenceMs = 0;
      } else {
        silenceMs += chunkMs;
      }

      if (hasSpeech && (silenceMs >= SILENCE_HANG_MS || segmentMs >= MAX_SEGMENT_MS)) {
        finalizeSegment();
      }
    },
    stop: () => {
      stopped = true;
      finalizeSegment().finally(() => onClose?.());
    },
  };
}

module.exports = { connect };
