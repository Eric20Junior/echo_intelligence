const { Router } = require("express");
const { listPending, approve, reject, ignore } = require("../controllers/aliasSuggestionsController");

const router = Router();

router.get("/alias-suggestions", listPending);
router.post("/alias-suggestions/:id/approve", approve);
router.post("/alias-suggestions/:id/reject", reject);
router.post("/alias-suggestions/:id/ignore", ignore);

module.exports = router;
