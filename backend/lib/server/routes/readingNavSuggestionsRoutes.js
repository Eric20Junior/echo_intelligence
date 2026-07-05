const { Router } = require("express");
const { listPending, approve, reject, ignore } = require("../controllers/readingNavSuggestionsController");

const router = Router();

router.get("/reading-nav-suggestions", listPending);
router.post("/reading-nav-suggestions/:id/approve", approve);
router.post("/reading-nav-suggestions/:id/reject", reject);
router.post("/reading-nav-suggestions/:id/ignore", ignore);

module.exports = router;
