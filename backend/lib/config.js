// Non-technical API key setup (roadmap Phase 6): a packaged app has no `.env`
// file for a non-technical operator to hand-edit, so keys persist to a small
// JSON file in the user's home directory instead. `.env` (developer workflow)
// still takes priority if both keys are already set by the time this runs.
const fs = require("fs");
const path = require("path");
const { USER_DATA_ROOT } = require("./paths");

// Always the user data folder, never the install folder — this file is written
// by the operator's own Settings panel, and a native installer's app folder is
// read-only. Same root the detection log and downloaded models use, so an
// operator's data is all in one place (see lib/paths.js).
const CONFIG_DIR = USER_DATA_ROOT;
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

// Scripture-detection LLM fallback backend (see lib/detection/detect.js). Three
// options, each a drop-in module exporting extractCandidateViaLLM():
//
//   "anthropic" (default) — fallback/llm-fallback.js. Paid, but the fallback only
//       fires when the regex pass finds nothing and each call is ~350 tokens, so a
//       service costs on the order of a cent on Haiku.
//   "gemini"              — fallback/gemini-fallback.js. Google's free tier, for
//       churches that can't put a card on file.
//   "local"               — fallback/local-llm.js. Fully offline, but 40-65s per
//       inference on non-AVX2 CPUs, and that inference starves the event loop hard
//       enough to drop the Deepgram WS mid-service (see that file's comments). Kept
//       for genuinely offline venues; never the default because of that failure mode.
//
// DETECTOR_BACKEND (developer workflow) wins over the operator's saved choice, same
// precedence .env already has over saved keys.
const DETECTOR_BACKENDS = ["anthropic", "gemini", "local"];
const DEFAULT_DETECTOR_BACKEND = "anthropic";

function getDetectorBackend() {
  const fromEnv = process.env.DETECTOR_BACKEND;
  if (DETECTOR_BACKENDS.includes(fromEnv)) return fromEnv;
  const saved = readConfigFile().detectorBackend;
  if (DETECTOR_BACKENDS.includes(saved)) return saved;
  return DEFAULT_DETECTOR_BACKEND;
}

function setDetectorBackend(value) {
  if (!DETECTOR_BACKENDS.includes(value)) throw new Error(`unknown detector backend: ${value}`);
  writeConfigFile({ detectorBackend: value });
}

// Which key the selected cloud backend needs, or null when it needs none.
function requiredDetectorKeyEnv() {
  const backend = getDetectorBackend();
  if (backend === "anthropic") return "ANTHROPIC_API_KEY";
  if (backend === "gemini") return "GEMINI_API_KEY";
  return null;
}

// STT backend (see lib/capture/stt-source.js vs stt-source-local.js): "deepgram"
// (the default, unchanged) is the accurate, network-dependent path already
// validated live; "local" runs Whisper on-device via @huggingface/transformers
// (no API key, no network) — accuracy not yet validated against real services,
// so it's opt-in rather than the default, same rollout stance as DETECTOR_BACKEND
// took with the local LLM before it was trusted.
function getSttBackend() {
  return process.env.STT_BACKEND === "local" ? "local" : "deepgram";
}

function readConfigFile() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {}; // corrupt config file — ignore, hasRequiredKeys() will still be false and the setup flow re-prompts
  }
}

// Merge rather than overwrite — confidenceThreshold and detectorBackend are written
// independently (by the calibration loop and the Settings panel respectively) and must
// survive each other's writes.
function writeConfigFile(patch) {
  const merged = { ...readConfigFile(), ...patch };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
}

// Saved keys hydrate process.env only where .env hasn't already set one. Every
// provider's key is hydrated regardless of the active backend, so switching backends
// in Settings doesn't require re-entering a key that's already on disk.
function loadConfig() {
  const saved = readConfigFile();
  const hydrate = (envVar, savedValue) => {
    if (savedValue && !process.env[envVar]) process.env[envVar] = savedValue;
  };
  hydrate("DEEPGRAM_API_KEY", saved.deepgramApiKey);
  hydrate("ANTHROPIC_API_KEY", saved.anthropicApiKey);
  hydrate("GEMINI_API_KEY", saved.geminiApiKey);
}

// Whether a key is available at all — set in the environment (active now) OR saved to
// disk (active on next launch). The Settings panel uses this so a key shows as "set"
// the moment it's saved, instead of falsely reading "not set" until the app restarts
// hydrates it into process.env. The active-vs-pending distinction is carried separately
// by saveConfig's restartRequired flag, not by pretending the key isn't there.
function isKeyConfigured(envVar, savedKey) {
  if (process.env[envVar]) return true;
  return Boolean(readConfigFile()[savedKey]);
}

function saveConfig({ deepgramApiKey, anthropicApiKey, geminiApiKey }) {
  const patch = {};
  if (deepgramApiKey) patch.deepgramApiKey = deepgramApiKey;
  if (anthropicApiKey) patch.anthropicApiKey = anthropicApiKey;
  if (geminiApiKey) patch.geminiApiKey = geminiApiKey;
  writeConfigFile(patch);
}

// Deepgram is only required when STT_BACKEND hasn't opted into the local Whisper
// path; the detector key is whichever the selected backend needs (none, for "local").
function hasRequiredKeys() {
  if (getSttBackend() !== "local" && !process.env.DEEPGRAM_API_KEY) return false;
  const detectorKey = requiredDetectorKeyEnv();
  return detectorKey === null || Boolean(process.env[detectorKey]);
}

// Confidence threshold (lib/detection/validate.js): starts at this default and can
// only be lowered over time by lib/detection/calibrate.js, based on real operator
// confirm/reject decisions — never hardcoded again once calibration has run once.
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

function getConfidenceThreshold() {
  const saved = readConfigFile().confidenceThreshold;
  return typeof saved === "number" ? saved : DEFAULT_CONFIDENCE_THRESHOLD;
}

function setConfidenceThreshold(value) {
  writeConfigFile({ confidenceThreshold: value });
}

module.exports = {
  loadConfig,
  saveConfig,
  isKeyConfigured,
  hasRequiredKeys,
  getDetectorBackend,
  setDetectorBackend,
  requiredDetectorKeyEnv,
  DETECTOR_BACKENDS,
  getSttBackend,
  getConfidenceThreshold,
  setConfidenceThreshold,
  DEFAULT_CONFIDENCE_THRESHOLD,
};
