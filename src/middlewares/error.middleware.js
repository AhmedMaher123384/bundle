const { ApiError } = require("../utils/apiError");
const { redact } = require("../utils/redact");

/**
 * Central error handler for Express.
 */
function errorHandler(err, _req, res, _next) {
  const statusCode = err instanceof ApiError ? err.statusCode : 500;
  const payload = {
    message: err.message || "Internal server error",
    code: err.code || (err instanceof ApiError ? err.code : "INTERNAL_ERROR"),
    details: redact(err.details)
  };

  if (process.env.NODE_ENV === "development" && !(err instanceof ApiError)) {
    payload.stack = err.stack;
  }

  res.status(statusCode).json(payload);
}

module.exports = {
  errorHandler
};
