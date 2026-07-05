// Operator suggestion queue (roadmap Phase 4): holds `suggest`-status detections
// awaiting manual approve/reject, per design doc §5 — never auto-projected.
const crypto = require("crypto");

const STALE_MS = 3 * 60 * 1000;

const queue = new Map();

function add(entry) {
  const id = crypto.randomUUID();
  queue.set(id, { id, createdAt: Date.now(), repeatCount: 1, ...entry });
  return id;
}

// Same reference re-detected while the original is still pending (roadmap
// Phase 8): bump the existing card's counter instead of piling up duplicates.
// Only matches entries whose *displayable* reference string is identical —
// deliberately not fuzzy, a different verse range is a different suggestion.
function findPendingByReference(reference) {
  for (const entry of queue.values()) {
    if (entry.reference === reference) return entry;
  }
  return null;
}

function bump(id) {
  const entry = queue.get(id);
  if (!entry) return null;
  entry.repeatCount = (entry.repeatCount ?? 1) + 1;
  return entry;
}

// ±1 verse range nudge (roadmap Phase 8): operator correction for an off-by-one
// detection, before they confirm. Only adjusts verseEnd when a range exists,
// otherwise nudges verseStart — caller (presentation.js) re-validates and
// re-resolves the text after this returns the updated candidate.
function nudge(id, delta) {
  const entry = queue.get(id);
  if (!entry || !entry.candidate) return null;
  const c = entry.candidate;
  if (c.verseEnd != null) c.verseEnd += delta;
  else if (c.verseStart != null) c.verseStart += delta;
  else return null;
  return entry;
}

function resolve(id) {
  const entry = queue.get(id);
  if (!entry) return null;
  queue.delete(id);
  return entry;
}

function withStaleFlag(entry) {
  return { ...entry, stale: Date.now() - entry.createdAt > STALE_MS };
}

function list() {
  return [...queue.values()].map(withStaleFlag);
}

function clear() {
  queue.clear();
}

module.exports = { add, resolve, list, clear, findPendingByReference, bump, nudge };
