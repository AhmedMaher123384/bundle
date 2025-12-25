const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const { createApiRouter } = require("./routes");
const { createWebhookRouter } = require("./routes/webhook.routes");
const { notFound } = require("./middlewares/notFound.middleware");
const { errorHandler } = require("./middlewares/error.middleware");
const { createRateLimiter } = require("./middlewares/rateLimit.middleware");

/**
 * Builds the Express app.
 * @param {import("./types").AppConfig} config
 */
function createApp(config) {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(morgan("combined"));

  app.get("/", (_req, res) => {
    return res.json({
      ok: true,
      name: "bundles-app-backend",
      health: "/health",
      oauthInstall: "/api/oauth/salla/install",
      oauthCallback: "/api/oauth/salla/callback",
      webhook: "/api/webhooks/salla",
      endpoints: {
        products: { list: "GET /api/products" },
        bundles: {
          create: "POST /api/bundles",
          list: "GET /api/bundles",
          update: "PATCH /api/bundles/:id",
          remove: "DELETE /api/bundles/:id",
          evaluate: "POST /api/bundles/evaluate",
          cartBanner: "POST /api/bundles/cart-banner"
        }
      }
    });
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use(
    "/api",
    createRateLimiter({
      windowMs: config.security.rateLimitWindowMs,
      maxRequests: config.security.rateLimitMaxRequests,
      keyPrefix: "api:"
    })
  );

  app.use("/api/webhooks", createWebhookRouter(config));

  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createApiRouter(config));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp
};
