const express = require("express");
const Joi = require("joi");
const { validate } = require("../middlewares/validate.middleware");
const { createOAuthController } = require("../controllers/oauth.controller");

function createOAuthRouter(config) {
  const router = express.Router();
  const controller = createOAuthController(config);

  const callbackQuerySchema = Joi.object({
    code: Joi.string().trim().min(1).required(),
    state: Joi.string().trim().min(1).required()
  });

  router.get("/install", controller.install);
  router.get("/callback", validate(callbackQuerySchema, "query"), controller.callback);

  return router;
}

module.exports = {
  createOAuthRouter
};

