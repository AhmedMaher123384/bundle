const express = require("express");
const { createWebhookController } = require("../controllers/webhook.controller");

function createWebhookRouter(config) {
  const router = express.Router();
  const controller = createWebhookController(config);

  router.post(
    "/salla",
    express.raw({ type: "application/json", limit: "1mb" }),
    (req, res, next) => {
      Promise.resolve(controller.sallaWebhook(req, res)).catch(next);
    }
  );

  return router;
}

module.exports = {
  createWebhookRouter
};
