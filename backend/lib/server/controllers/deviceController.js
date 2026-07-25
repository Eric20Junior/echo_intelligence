const { exec } = require("child_process");
const micSource = require("../../capture/mic-source");
const session = require("../session");
const presentation = require("../presentation");
const readingMode = require("../../detection/reading-mode");

async function listDevices(req, res) {
  const devices = await micSource.listDevices();
  res.json({ devices });
}

function getStatus(req, res) {
  res.json({
    active: session.isActive(),
    readingMode: readingMode.getState(),
    ...presentation.getSnapshot(),
  });
}

async function startSession(req, res) {
  try {
    const { device } = req.body;
    const result = await session.start({ device });
    res.status(result.alreadyActive ? 409 : 200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function stopSession(req, res) {
  const stopped = session.stop();
  res.json({ stopped });
}

// One-click fix for the most common silent-mic cause on Windows (see
// session.js's silence watchdog): deep-links straight to the "let desktop
// apps access the microphone" toggle instead of making the operator hunt for
// it. No equivalent OS-level settings URI exists on Linux/macOS, so this is
// a no-op there — the frontend only shows the button when canOpenSettings
// (win32-only) came back true on the mic_error message.
function openMicSettings(req, res) {
  if (process.platform !== "win32") {
    res.status(400).json({ error: "not supported on this platform" });
    return;
  }
  exec('start "" ms-settings:privacy-microphone', (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ opened: true });
  });
}

module.exports = { listDevices, getStatus, startSession, stopSession, openMicSettings };
