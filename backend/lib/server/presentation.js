// Presentation stage (roadmap Phase 3/4): the one place that decides what reaches
// the projector overlay vs. the operator's confirm queue. `auto_display` goes to
// both; `suggest` goes to the operator only, per design doc §5, until approved.
const crypto = require("crypto");
const suggestionQueue = require("./suggestion-queue");
const readingMode = require("../detection/reading-mode");
const { resolveVerseText } = require("../detection/resolve");
const { formatReference } = require("../format");
const { validateCandidate } = require("../detection/validate");
const log = require("../log");
const plan = require("./plan");
const { parseManualReference } = require("../detection/parse");

const HISTORY_LIMIT = 20;
const recentHistory = [];

// The app ships one translation (KJV — public domain, see docs/roadmap.md
// Phase 6). NIV/GNT require a commercial license (Biblica/American Bible
// Society respectively) that hasn't been secured, so verse *text* stays
// KJV-only until that changes. They're still listed in Settings > Bible
// (as unavailable) so the operator can see them on the roadmap rather than
// wonder if they were forgotten.
const TRANSLATION = "KJV";
const TRANSLATION_OPTIONS = [
  { id: "KJV", label: "King James Version", available: true },
  { id: "NIV", label: "New International Version", available: false, reason: "Requires a Biblica license — not yet configured" },
  { id: "GNT", label: "Good News Translation", available: false, reason: "Requires an American Bible Society license — not yet configured" },
];

// In-memory only (roadmap Phase 8 step 1) — an operator toggle, not something
// that needs to survive a server restart.
const settings = {
  confirmAll: false, // force every detection through the operator queue, even high-confidence ones
  collapseRepeats: true, // re-detections of the same reference bump an existing pending card instead of adding a new one
  gain: 1, // input gain multiplier applied to the mic PCM (Settings > Audio), see lib/gain.js
};

let broadcastFn = () => {};

function init(broadcast) {
  broadcastFn = broadcast;
}

// Live-display dwell gate (observed live 2026-07-04: a pastor rattling off
// several unrelated references in a row — "2 Timothy 1:5... 2 Timothy 3:15...
// and John 4" as things to note down, not to read in sequence — flashed all
// three across the projector within ~6 seconds). A congregation can't read
// that fast, and only the operator's queue, not raw detection speed, should
// decide what actually reaches the screen when references come in faster than
// a human could follow. Only gates a *different* reference; re-detecting the
// same one (repeat emphasis) still displays immediately since it changes
// nothing on screen. Not persisted — resets with the process, same as the
// rest of this module's in-memory state.
const LIVE_DWELL_MS = 6000;
let lastLive = null; // { reference, at }

function markLive(reference) {
  lastLive = { reference, at: Date.now() };
}

function pushHistory(entry) {
  recentHistory.push(entry);
  if (recentHistory.length > HISTORY_LIMIT) recentHistory.shift();
}

function handleResult({ status, reference, text, candidate, confidence, logId }) {
  let effectiveStatus = settings.confirmAll && status === "auto_display" ? "suggest" : status;
  if (
    effectiveStatus === "auto_display" &&
    lastLive &&
    lastLive.reference !== reference &&
    Date.now() - lastLive.at < LIVE_DWELL_MS
  ) {
    effectiveStatus = "suggest";
  }
  // confirmAll/dwell-gate override what lib/detect.js already logged as "auto"
  // at insert time (it doesn't know about either) — correct the log row to
  // reflect that it actually went to the pending queue instead.
  if (effectiveStatus !== status) log.updateDecision(logId, "pending");

  if (effectiveStatus === "auto_display") {
    if (candidate) plan.markDisplayed(candidate);
    markLive(reference);
    const entry = { id: crypto.randomUUID(), status: "auto_display", reference, text, confidence, translation: TRANSLATION };
    pushHistory(entry);
    broadcastFn("overlay", entry);
    broadcastFn("operator", { type: "auto_display", entry });
    return entry;
  }

  if (effectiveStatus === "suggest") {
    if (settings.collapseRepeats) {
      const existing = suggestionQueue.findPendingByReference(reference);
      if (existing) {
        const bumped = suggestionQueue.bump(existing.id);
        broadcastFn("operator", {
          type: "suggestion_added",
          entry: { id: bumped.id, status: "suggest", reference, text: bumped.text, confidence: bumped.confidence, translation: TRANSLATION, repeatCount: bumped.repeatCount },
        });
        return bumped;
      }
    }

    // candidate/logId are kept server-side only (for a possible reading-mode
    // lock on approve, the ±1 nudge below, and updating the log row's eventual
    // decision) — never included in the client-facing broadcast payload.
    const id = suggestionQueue.add({ status: "suggest", reference, text, candidate, confidence, logId });
    broadcastFn("operator", {
      type: "suggestion_added",
      entry: { id, status: "suggest", reference, text, confidence, translation: TRANSLATION, repeatCount: 1 },
    });
    return { id, status: "suggest", reference, text };
  }

  return null;
}

function approve(id) {
  const entry = suggestionQueue.resolve(id);
  if (!entry) return null;
  if (entry.candidate) {
    readingMode.lock(entry.candidate);
    plan.markDisplayed(entry.candidate);
  }
  log.updateDecision(entry.logId, "confirmed");
  markLive(entry.reference);
  const display = { id: entry.id, status: "auto_display", reference: entry.reference, text: entry.text, confidence: entry.confidence, translation: TRANSLATION };
  pushHistory(display);
  broadcastFn("overlay", display);
  broadcastFn("operator", { type: "suggestion_resolved", id, action: "approved" });
  return display;
}

function reject(id) {
  const entry = suggestionQueue.resolve(id);
  if (!entry) return null;
  log.updateDecision(entry.logId, "rejected");
  broadcastFn("operator", { type: "suggestion_resolved", id, action: "rejected" });
  return entry;
}

// ±1 verse range nudge (roadmap Phase 8): re-validates and re-resolves so an
// out-of-range nudge (e.g. past a chapter's last verse) is rejected rather than
// silently producing bad text, same bound-checking as live detection.
function nudge(id, delta) {
  const entry = suggestionQueue.nudge(id, delta);
  if (!entry) return null;

  const result = validateCandidate(entry.candidate);
  if (!result.valid) {
    // Roll back — don't leave the queue holding an invalid range.
    suggestionQueue.nudge(id, -delta);
    return null;
  }

  entry.reference = formatReference(entry.candidate);
  entry.text = resolveVerseText(entry.candidate);
  entry.confidence = result.confidence;

  broadcastFn("operator", {
    type: "suggestion_added",
    entry: { id: entry.id, status: "suggest", reference: entry.reference, text: entry.text, confidence: entry.confidence, translation: TRANSLATION, repeatCount: entry.repeatCount },
  });
  return entry;
}

// Manual verse entry (roadmap Phase 8) and "Display now" from the Plan tab
// share this path: the operator explicitly chose this reference, so it goes
// straight to the projector — no confidence gate, same as an approved
// suggestion. Still locks reading mode, same as any other confirmed display,
// so "next verse" afterward works. Logged directly (unlike live detections,
// there's no detect.js pass to log it first) with a decision that distinguishes
// how it got on screen, for the History tab.
function manualDisplay(candidate, rawInput, text, decision = "manual") {
  const logId = log.logDetection(rawInput, { status: "auto_display", candidate, confidence: 1 });
  log.updateDecision(logId, decision);
  readingMode.lock(candidate);
  plan.markDisplayed(candidate);
  const reference = formatReference(candidate);
  markLive(reference);
  const display = {
    id: crypto.randomUUID(),
    status: "auto_display",
    reference,
    text,
    confidence: 1,
    translation: TRANSLATION,
  };
  pushHistory(display);
  broadcastFn("overlay", display);
  broadcastFn("operator", { type: "auto_display", entry: display });
  return display;
}

// Mic input level meter (roadmap Phase 8 step 4) — purely transient, so this
// just forwards to the operator's WS, nothing to log or snapshot.
function emitAudioLevel(level) {
  broadcastFn("operator", { type: "audio_level", level });
}

// Live transcript (roadmap: landing page redesign) — every STT utterance,
// matched or not, so the operator can see what's actually being heard, not
// just the detections that came out of it.
function emitTranscript(text) {
  broadcastFn("operator", { type: "transcript", text });
}

// --- Plan tab (roadmap Phase 8 step 3) ---

function listPlan() {
  return { items: plan.list(), section: plan.getSection() };
}

function addPlanItem(reference, note) {
  const parsed = parseManualReference(reference);
  if (!parsed.valid) return { error: parsed.reason };
  const id = plan.add(parsed.candidate, formatReference(parsed.candidate), note);
  return { id };
}

function removePlanItem(id) {
  return plan.remove(id);
}

function displayPlanItem(id) {
  const item = plan.get(id);
  if (!item) return null;
  const text = resolveVerseText(item.candidate);
  return manualDisplay(item.candidate, item.reference, text, "plan");
}

function setSection(value) {
  const result = plan.setSection(value);
  if (result) broadcastFn("operator", { type: "section_updated", value: result });
  return result;
}

function getSection() {
  return plan.getSection();
}

function getSettings() {
  return { ...settings };
}

function setSetting(key, value) {
  if (!(key in settings)) return null;
  settings[key] = value;
  broadcastFn("operator", { type: "setting_updated", key, value });
  return settings[key];
}

function getSnapshot() {
  // candidate is server-side only (see handleResult) — stripped here before this
  // ever reaches a client-facing broadcast.
  const pending = suggestionQueue.list().map(({ candidate, ...rest }) => rest);
  return {
    pending,
    recent: recentHistory,
    settings: getSettings(),
    section: plan.getSection(),
    translations: { current: TRANSLATION, options: TRANSLATION_OPTIONS },
  };
}

function reset() {
  suggestionQueue.clear();
  recentHistory.length = 0;
  lastLive = null;
}

module.exports = {
  init,
  handleResult,
  approve,
  reject,
  nudge,
  manualDisplay,
  getSettings,
  setSetting,
  getSnapshot,
  reset,
  listPlan,
  addPlanItem,
  removePlanItem,
  displayPlanItem,
  getSection,
  setSection,
  emitAudioLevel,
  emitTranscript,
};
