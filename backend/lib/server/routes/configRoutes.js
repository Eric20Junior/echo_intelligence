const { Router } = require("express");
const { getConfig, saveConfig } = require("../controllers/configController");

const router = Router();

router.get("/config", getConfig);
router.post("/config", saveConfig);

module.exports = router;
