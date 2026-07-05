// Non-technical API key setup (roadmap Phase 6): a packaged app has no `.env`
// file for a non-technical operator to hand-edit, so keys persist to a small
// JSON file in the user's home directory instead. `.env` (developer workflow)
// still takes priority if both keys are already set by the time this runs.
const fs = require("fs");
const os = require("os");
const path = require("path");

const CONFIG_DIR = path.join(os.homedir(), ".echo-intelligence");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

// Scripture-detection LLM fallback backend (see lib/detect.js): "local" runs a
// bundled small model on-device (lib/local-llm.js, no network, no API key) and
// is the default so a fresh install works fully offline; "anthropic" is kept
// as an opt-in comparison/rollback path (lib/llm-fallback.js) while the local
// model's accuracy is still being validated against real services.
function getDetectorBackend() {
  return process.env.DETECTOR_BACKEND === "anthropic" ? "anthropic" : "local";
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

function loadConfig() {
  const sttSatisfied = getSttBackend() === "local" || Boolean(process.env.DEEPGRAM_API_KEY);
  const detectorSatisfied = getDetectorBackend() === "local" || Boolean(process.env.ANTHROPIC_API_KEY);
  if (sttSatisfied && detectorSatisfied) return;
  const saved = readConfigFile();
  if (saved.deepgramApiKey) process.env.DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || saved.deepgramApiKey;
  if (saved.anthropicApiKey) process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || saved.anthropicApiKey;
}

function saveConfig({ deepgramApiKey, anthropicApiKey }) {
  // Merge rather than overwrite — confidenceThreshold (see below) is written
  // independently by the calibration loop and must survive a later key re-entry.
  const merged = { ...readConfigFile(), deepgramApiKey, anthropicApiKey };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
}

// Deepgram is only required when STT_BACKEND hasn't opted into the local
// Whisper path; Anthropic is only required when DETECTOR_BACKEND opts back
// into the API fallback.
function hasRequiredKeys() {
  if (getSttBackend() !== "local" && !process.env.DEEPGRAM_API_KEY) return false;
  return getDetectorBackend() === "local" || Boolean(process.env.ANTHROPIC_API_KEY);
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
  const merged = { ...readConfigFile(), confidenceThreshold: value };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
}

module.exports = {
  loadConfig,
  saveConfig,
  hasRequiredKeys,
  getDetectorBackend,
  getSttBackend,
  getConfidenceThreshold,
  setConfidenceThreshold,
  DEFAULT_CONFIDENCE_THRESHOLD,
};
