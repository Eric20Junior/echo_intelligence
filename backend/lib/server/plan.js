// Pre-service plan (roadmap Phase 8 step 3): an ordered list of passages the
// operator expects to use, plus the current service section. In-memory only,
// per a CTO review — this doesn't need to survive a restart or be queryable
// across services (unlike data/log.db, which is deliberately durable for
// alias/threshold tuning); add persistence later only if that turns out wrong.
const crypto = require("crypto");

const items = []; // ordered: [{ id, reference, note, candidate, displayed }]
let section = "sermon"; // "worship" | "sermon" | "response"

function list() {
  return items.map(({ candidate, ...rest }) => rest);
}

function add(candidate, reference, note) {
  const id = crypto.randomUUID();
  items.push({ id, reference, note: note ?? "", candidate, displayed: false });
  return id;
}

function remove(id) {
  const i = items.findIndex((item) => item.id === id);
  if (i === -1) return false;
  items.splice(i, 1);
  return true;
}

function get(id) {
  return items.find((item) => item.id === id) ?? null;
}

// Loose match: same book/chapter/verseStart — a plan entry for "Romans 8:28"
// still counts as in-plan if the operator's own range nudge or a slightly
// different verseEnd comes through, only the anchor verse has to agree.
function sameCandidate(a, b) {
  return a.bookId === b.bookId && a.chapter === b.chapter && a.verseStart === b.verseStart;
}

function matchesPlan(candidate) {
  return items.some((item) => sameCandidate(item.candidate, candidate));
}

// Called from lib/presentation.js at every real display (live auto-display,
// approved suggestion, manual entry, or "Display now") so the Plan tab's
// "Shown" badge is accurate regardless of which path got it on screen.
function markDisplayed(candidate) {
  for (const item of items) {
    if (sameCandidate(item.candidate, candidate)) item.displayed = true;
  }
}

function getSection() {
  return section;
}

function setSection(value) {
  if (!["worship", "sermon", "response"].includes(value)) return null;
  section = value;
  return section;
}

function reset() {
  items.length = 0;
  section = "sermon";
}

module.exports = { list, add, remove, get, matchesPlan, markDisplayed, getSection, setSection, reset };
