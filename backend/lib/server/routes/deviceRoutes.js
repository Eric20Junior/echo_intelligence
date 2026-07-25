const { Router } = require("express");
const { listDevices, getStatus, startSession, stopSession, openMicSettings } = require("../controllers/deviceController");

const router = Router();

router.get("/devices", listDevices);
router.get("/status", getStatus);
router.post("/start", startSession);
router.post("/stop", stopSession);
router.post("/open-mic-settings", openMicSettings);

module.exports = router;
