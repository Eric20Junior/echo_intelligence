const presentation = require("../presentation");
const { parseManualReference } = require("../../detection/parse");
const { resolveVerseText } = require("../../detection/resolve");

function manualDisplay(req, res) {
  const { reference } = req.body;
  if (!reference || !reference.trim()) return res.status(400).json({ error: "reference is required" });

  const parsed = parseManualReference(reference);
  if (!parsed.valid) return res.status(422).json({ error: parsed.reason });

  const text = resolveVerseText(parsed.candidate);
  const display = presentation.manualDisplay(parsed.candidate, reference, text);
  res.json(display);
}

module.exports = { manualDisplay };
