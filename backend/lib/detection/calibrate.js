// "Improves over time" (roadmap / offline-LLM migration design intent): rather than
// fine-tuning the local model per install (rejected earlier — too little data per
// church, no GPU guarantee on operator laptops), confidence-threshold calibration
// uses real operator confirm/reject decisions on suggest-tier detections to lower
// CONFIDENCE_THRESHOLD over time, so fewer clearly-good detections need a manual
// confirm click. Deliberately one-directional: presentation.js only ever writes
// "confirmed"/"rejected" for suggest-tier items that went through the operator
// queue — an already auto-displayed detection has no equivalent "this was wrong"
// signal to raise the threshold back up on, so this never raises it.
//
// CTO-reviewed guardrails (same reasoning applied here as for alias-table tuning,
// which is a separate not-yet-built feature): only act on a real minimum sample
// size, only ever move the threshold down by one band at a time, and always leave
// an audit trail (log.js's threshold_adjustments table) recording the evidence —
// never a silent config change nobody can explain later.
const { getSuggestOutcomes, recordThresholdAdjustment } = require("../log");
const { getConfidenceThreshold, setConfidenceThreshold, DEFAULT_CONFIDENCE_THRESHOLD } = require("../config");

const BAND_WIDTH = 0.05;
const MIN_SAMPLES = 10;
const MIN_CONFIRM_RATE = 0.9;
const FLOOR = 0.5; // matches scoreConfidence's baseline floor in validate.js — never tune below it

// Returns the new threshold if it lowered one, or null if nothing changed. Safe to
// call on every app startup — a no-op once there isn't enough fresh evidence.
function calibrateConfidenceThreshold() {
  const currentThreshold = getConfidenceThreshold();
  if (currentThreshold <= FLOOR) return null;

  // Rounded to avoid float drift (0.7 - 0.05 === 0.6499999999999999) leaking into the
  // persisted config and the audit trail.
  const bandStart = Math.round(Math.max(FLOOR, currentThreshold - BAND_WIDTH) * 100) / 100;
  const bandEnd = currentThreshold;

  const outcomes = getSuggestOutcomes().filter((o) => o.confidence >= bandStart && o.confidence < bandEnd);
  if (outcomes.length < MIN_SAMPLES) return null;

  const confirmedCount = outcomes.filter((o) => o.decision === "confirmed").length;
  const rejectedCount = outcomes.length - confirmedCount;
  const confirmRate = confirmedCount / outcomes.length;
  if (confirmRate < MIN_CONFIRM_RATE) return null;

  const newThreshold = bandStart;
  setConfidenceThreshold(newThreshold);
  recordThresholdAdjustment({
    oldThreshold: currentThreshold,
    newThreshold,
    bandStart,
    bandEnd,
    confirmedCount,
    rejectedCount,
  });
  return newThreshold;
}

module.exports = { calibrateConfidenceThreshold, DEFAULT_CONFIDENCE_THRESHOLD };
