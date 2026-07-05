const config = require("../../config");

// Settings > API Keys: lets an operator rotate keys after first-run setup
// without deleting ~/.echo-intelligence/config.json. Never echoes the keys
// back — only whether each is currently set — and a saved key only takes
// effect for the *next* app launch (lib/llm-fallback.js constructs its
// Anthropic client at require-time), same restart requirement the first-run
// setup flow (lib/setup-server.js) already has.
function getConfig(req, res) {
  res.json({
    deepgramConfigured: Boolean(process.env.DEEPGRAM_API_KEY),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}

function saveConfig(req, res) {
  const { deepgramApiKey, anthropicApiKey } = req.body;
  if (!deepgramApiKey && !anthropicApiKey) return res.status(400).json({ error: "at least one key is required" });
  config.saveConfig({
    deepgramApiKey: deepgramApiKey || process.env.DEEPGRAM_API_KEY,
    anthropicApiKey: anthropicApiKey || process.env.ANTHROPIC_API_KEY,
  });
  res.json({ ok: true, restartRequired: true });
}

module.exports = { getConfig, saveConfig };
