// Phrase suggestions ("improves over time", human-reviewed half — see
// lib/detection/phrase-miner.js's header). Always requires an explicit operator
// action; nothing here is ever applied automatically. Mirrors
// aliasSuggestionsController.js's shape exactly.
const log = require("../../log");
const { reloadLearnedPhrases } = require("../../detection/learned-phrases");

function listPending(req, res) {
  res.json({ suggestions: log.getPendingPhraseSuggestions() });
}

function approve(req, res) {
  log.resolvePhraseSuggestion(req.params.id, "approved");
  reloadLearnedPhrases(); // pick up the new phrase immediately, no restart needed
  res.json({ ok: true });
}

function reject(req, res) {
  log.resolvePhraseSuggestion(req.params.id, "rejected");
  res.json({ ok: true });
}

function ignore(req, res) {
  log.resolvePhraseSuggestion(req.params.id, "ignored");
  res.json({ ok: true });
}

module.exports = { listPending, approve, reject, ignore };
