const { Router } = require("express");
const { getHistory } = require("../controllers/historyController");

const router = Router();

router.get("/history", getHistory);

module.exports = router;
