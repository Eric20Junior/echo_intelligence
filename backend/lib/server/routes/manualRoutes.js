const { Router } = require("express");
const { manualDisplay } = require("../controllers/manualController");

const router = Router();

router.post("/manual", manualDisplay);

module.exports = router;
