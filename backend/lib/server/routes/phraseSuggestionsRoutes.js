const { Router } = require("express");
const { listPending, approve, reject, ignore } = require("../controllers/phraseSuggestionsController");

const router = Router();

router.get("/phrase-suggestions", listPending);
router.post("/phrase-suggestions/:id/approve", approve);
router.post("/phrase-suggestions/:id/reject", reject);
router.post("/phrase-suggestions/:id/ignore", ignore);

module.exports = router;
