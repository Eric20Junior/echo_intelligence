// Alias suggestions ("improves over time", human-reviewed half — see
// lib/detection/alias-miner.js's header). Always requires an explicit operator
// action; nothing here is ever applied automatically.
const log = require("../../log");
const { reloadLearnedAliases } = require("../../detection/learned-aliases");

function listPending(req, res) {
  res.json({ suggestions: log.getPendingAliasSuggestions() });
}

function approve(req, res) {
  log.resolveAliasSuggestion(req.params.id, "approved");
  reloadLearnedAliases(); // pick up the new alias immediately, no restart needed
  res.json({ ok: true });
}

function reject(req, res) {
  log.resolveAliasSuggestion(req.params.id, "rejected");
  res.json({ ok: true });
}

function ignore(req, res) {
  log.resolveAliasSuggestion(req.params.id, "ignored");
  res.json({ ok: true });
}

module.exports = { listPending, approve, reject, ignore };
