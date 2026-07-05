const { Router } = require("express");
const { listPlan, addPlanItem, removePlanItem, displayPlanItem } = require("../controllers/planController");

const router = Router();

router.get("/plan", listPlan);
router.post("/plan", addPlanItem);
router.delete("/plan/:id", removePlanItem);
router.post("/plan/:id/display", displayPlanItem);

module.exports = router;
