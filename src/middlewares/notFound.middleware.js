const { ApiError } = require("../utils/apiError");

/**
 * Handles unknown routes.
 */
function notFound(_req, _res, next) {
  next(new ApiError(404, "Route not found", { code: "ROUTE_NOT_FOUND" }));
}

module.exports = {
  notFound
};

