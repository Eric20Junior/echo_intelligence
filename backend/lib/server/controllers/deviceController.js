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

module.exports = { listDevices, getStatus, startSession, stopSession };
