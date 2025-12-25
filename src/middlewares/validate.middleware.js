const { ApiError } = require("../utils/apiError");

/**
 * Validates req parts (body/query/params) using Joi schema.
 * @param {import("joi").Schema} schema
 * @param {"body"|"query"|"params"} part
 */
function validate(schema, part) {
  return function validateMiddleware(req, _res, next) {
    const { error, value } = schema.validate(req[part], { abortEarly: false, stripUnknown: true });
    if (error) {
      return next(
        new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        })
      );
    }
    req[part] = value;
    return next();
  };
}

module.exports = {
  validate
};

