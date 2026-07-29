const config = require("../../config");

// Settings > API Keys: lets an operator pick the scripture-detection backend and
// rotate keys after first-run setup without deleting ~/.echo-intelligence/config.json.
// Never echoes keys back — only whether each is currently set.
//
// A saved key or backend change only takes effect on the *next* app launch, the same
// restart requirement the first-run setup flow (lib/server/setup-server.js) has. The
// *configured* flags below reflect a saved-but-not-yet-active key too (config.isKeyConfigured
// checks disk as well as env), so saving a key flips it to "set" immediately instead of
// falsely reading "not set" until restart; restartRequired on save carries the caveat.
function getConfig(req, res) {
  res.json({
    deepgramConfigured: config.isKeyConfigured("DEEPGRAM_API_KEY", "deepgramApiKey"),
    anthropicConfigured: config.isKeyConfigured("ANTHROPIC_API_KEY", "anthropicApiKey"),
    geminiConfigured: config.isKeyConfigured("GEMINI_API_KEY", "geminiApiKey"),
    detectorBackend: config.getDetectorBackend(),
    detectorBackends: config.DETECTOR_BACKENDS,
    // True when DETECTOR_BACKEND is set in the environment, which outranks anything
    // saved here — the UI disables the picker rather than accepting a click that
    // would be silently ignored on restart.
    detectorBackendLockedByEnv: config.DETECTOR_BACKENDS.includes(process.env.DETECTOR_BACKEND),
  });
}

function saveConfig(req, res) {
  const { deepgramApiKey, anthropicApiKey, geminiApiKey, detectorBackend } = req.body;

  if (!deepgramApiKey && !anthropicApiKey && !geminiApiKey && !detectorBackend) {
    return res.status(400).json({ error: "nothing to save" });
  }

  if (detectorBackend) {
    try {
      config.setDetectorBackend(detectorBackend);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // config.saveConfig ignores falsy values, so an untouched field leaves the stored
  // key alone instead of clobbering it — the UI sends only what the operator typed.
  config.saveConfig({ deepgramApiKey, anthropicApiKey, geminiApiKey });

  res.json({ ok: true, restartRequired: true });
}

module.exports = { getConfig, saveConfig };
