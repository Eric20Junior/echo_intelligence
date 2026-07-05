// Named to match the "/api/plan" REST resource — distinct from lib/server/plan.js,
// the underlying pre-service-plan state module this delegates to via presentation.js.
const presentation = require("../presentation");

function listPlan(req, res) {
  res.json(presentation.listPlan());
}

function addPlanItem(req, res) {
  const { reference, note } = req.body;
  if (!reference || !reference.trim()) return res.status(400).json({ error: "reference is required" });
  const result = presentation.addPlanItem(reference, note);
  if (result.error) return res.status(422).json({ error: result.error });
  res.json(result);
}

function removePlanItem(req, res) {
  const removed = presentation.removePlanItem(req.params.id);
  res.json({ removed });
}

function displayPlanItem(req, res) {
  const display = presentation.displayPlanItem(req.params.id);
  if (!display) return res.status(404).json({ error: "no such plan item" });
  res.json(display);
}

module.exports = { listPlan, addPlanItem, removePlanItem, displayPlanItem };
