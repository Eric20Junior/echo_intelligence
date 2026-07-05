// Reading-navigation suggestions ("improves over time", human-reviewed half —
// see lib/detection/reading-nav-miner.js's header). Always requires an
// explicit operator action; nothing here is ever applied automatically.
// Mirrors phraseSuggestionsController.js's shape exactly.
const log = require("../../log");
const { reloadLearnedReadingNav } = require("../../detection/learned-reading-nav");

function listPending(req, res) {
  res.json({ suggestions: log.getPendingReadingNavSuggestions() });
}

function approve(req, res) {
  log.resolveReadingNavSuggestion(req.params.id, "approved");
  reloadLearnedReadingNav(); // pick up the new phrase immediately, no restart needed
  res.json({ ok: true });
}

function reject(req, res) {
  log.resolveReadingNavSuggestion(req.params.id, "rejected");
  res.json({ ok: true });
}

function ignore(req, res) {
  log.resolveReadingNavSuggestion(req.params.id, "ignored");
  res.json({ ok: true });
}

module.exports = { listPending, approve, reject, ignore };
