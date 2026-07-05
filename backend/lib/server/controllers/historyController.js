const log = require("../../log");

function getHistory(req, res) {
  const limit = Math.min(Number(req.query.limit) || 20, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const search = typeof req.query.search === "string" ? req.query.search : "";
  res.json(log.getHistory({ limit, offset, search }));
}

module.exports = { getHistory };
