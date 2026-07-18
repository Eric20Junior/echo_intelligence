// Session orchestration (roadmap Phase 3): wires mic-source -> stt-source ->
// detectReference -> presentation. One session at a time; starting a second one
// while active is a no-op that returns the existing session instead of spawning
// a second `arecord` process.
const micSource = require("../capture/mic-source");
const { getSttBackend } = require("../config");
const { detectReference } = require("../detection/detect");
const { resolveVerseText } = require("../detection/resolve");
const presentation = require("./presentation");
const readingMode = require("../detection/reading-mode");
const { formatReference } = require("../format");
const { rmsLevel } = require("../capture/audio-level");
const { applyGain } = require("../capture/gain");

const LEVEL_BROADCAST_INTERVAL_MS = 100; // ~10Hz, matches the meter's visual refresh needs

// Required lazily (not at module load), same reasoning as lib/detection/detect.js's
// getLLMFallback(): a "deepgram" install never pays @huggingface/transformers'
// ONNX runtime load cost, and a "local" install never pulls in @deepgram/sdk's ws.
function getSttSource() {
  return getSttBackend() === "local" ? require("../capture/stt-source-local") : require("../capture/stt-source");
}

let active = null; // { device, mic, stt }
let lastTranscript = null; // one-utterance lookback, for the cross-utterance merge in onTranscript below

function isActive() {
  return active !== null;
}

const RECONNECT_DELAY_MS = 1000;

function onTranscript(transcript) {
  // Service-section pause (roadmap Phase 8 step 3): worship music/lyrics are
  // a real source of false-positive book-name matches, so detection is
  // skipped entirely rather than just filtered after the fact.
  if (presentation.getSection() === "worship") return;

  console.log(`\n[utterance] "${transcript}"`);
  presentation.emitTranscript(transcript);

  const previousTranscript = lastTranscript;
  lastTranscript = transcript;

  detectReference(transcript).then(async (parsed) => {
    // Deepgram's endpointing can split one spoken reference across two "final"
    // utterances when the speaker pauses mid-reference (observed live: "like
    // Jude" / "verses three and four." as two separate utterances). If this
    // utterance alone didn't produce a candidate, retry once against it
    // prefixed with the immediately preceding utterance before giving up —
    // narrow window (one utterance back only), so it can't merge across an
    // unrelated earlier sentence.
    if ((parsed.status === "no_match" || parsed.status === "invalid") && previousTranscript) {
      const merged = await detectReference(`${previousTranscript} ${transcript}`);
      if (merged.status === "auto_display" || merged.status === "suggest") parsed = merged;
    }

    if (parsed.status !== "auto_display" && parsed.status !== "suggest") return;

    const reference = formatReference(parsed.candidate);
    const text = resolveVerseText(parsed.candidate);

    console.log(`  [${parsed.status}] -> ${reference}`);
    presentation.handleResult({
      status: parsed.status,
      reference,
      text,
      candidate: parsed.candidate,
      confidence: parsed.confidence,
      logId: parsed.logId,
    });
  });
}

// Deepgram closes idle/stalled connections; on this hardware a slow local-LLM
// fallback call can starve the event loop long enough to trigger exactly that
// (observed live). Rather than leave the operator silently un-listened-to
// until they notice and manually restart, reconnect automatically as long as
// the session is still meant to be active.
async function connectStt(device) {
  const backendLabel = getSttBackend() === "local" ? "local whisper" : "deepgram";
  const stt = await getSttSource().connect({
    onTranscript,
    onError: (err) => console.error(`${backendLabel} error:`, err.message),
    onClose: () => {
      console.log(`${backendLabel}: connection closed`);
      if (active) {
        setTimeout(() => {
          if (!active) return;
          connectStt(device).then((stt) => {
            if (active) active.stt = stt;
          });
        }, RECONNECT_DELAY_MS);
      }
    },
  });
  console.log(`${backendLabel}: connected`);
  return stt;
}

async function start({ device }) {
  if (active) return { alreadyActive: true, device: active.device };

  presentation.reset();
  readingMode.reset();
  lastTranscript = null;

  active = { device, mic: null, stt: null };
  active.stt = await connectStt(device);

  let lastLevelBroadcast = 0;
  const mic = await micSource.start({
    device,
    onChunk: (rawChunk) => {
      const chunk = applyGain(rawChunk, presentation.getSettings().gain);
      // Reads active.stt (not a captured local) so a reconnect mid-session
      // (see connectStt's onClose above) swaps in the new socket transparently.
      active?.stt.sendAudio(chunk);
      const now = Date.now();
      if (now - lastLevelBroadcast >= LEVEL_BROADCAST_INTERVAL_MS) {
        lastLevelBroadcast = now;
        presentation.emitAudioLevel(rmsLevel(chunk));
      }
    },
    onError: (err) => console.error(err.message),
  });
  console.log(`listening on mic "${device || "default"}" — speak a scripture reference`);

  active.mic = mic;
  return { alreadyActive: false, device };
}

function stop() {
  if (!active) return false;
  active.mic.stop();
  active.stt.stop();
  active = null;
  return true;
}

module.exports = { start, stop, isActive };
