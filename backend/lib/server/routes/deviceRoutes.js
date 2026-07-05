const { Router } = require("express");
const { listDevices, getStatus, startSession, stopSession } = require("../controllers/deviceController");

const router = Router();

router.get("/devices", listDevices);
router.get("/status", getStatus);
router.post("/start", startSession);
router.post("/stop", stopSession);

module.exports = router;
