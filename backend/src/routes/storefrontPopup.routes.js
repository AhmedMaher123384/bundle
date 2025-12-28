const express = require("express");
const Joi = require("joi");
const { validate } = require("../middlewares/validate.middleware");
const { createStorefrontPopupController } = require("../controllers/storefrontPopup.controller");

const contentSchema = Joi.object({
  title: Joi.string().trim().min(1).max(120).allow(null, ""),
  subtitle: Joi.string().trim().min(1).max(200).allow(null, ""),
  highlights: Joi.array().items(Joi.string().trim().min(1).max(120)).max(4).default([]),
  imageUrl: Joi.string().trim().uri().max(500).allow(null, "")
});

const presentationSchema = Joi.object({
  backgroundColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  textColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  accentColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  overlayColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  overlayOpacity: Joi.number().min(0).max(0.9).default(0.55),
  fontFamily: Joi.string().trim().min(1).max(160).allow(null, ""),
  shape: Joi.object({
    radiusPx: Joi.number().min(0).max(40).default(18),
    widthPx: Joi.number().min(280).max(560).default(420)
  }).default({}),
  layout: Joi.string().valid("center", "bottom_left", "bottom_right").default("center"),
  glass: Joi.boolean().default(true),
  enterAnimation: Joi.string().valid("none", "slide", "fade", "pop").default("pop")
}).default({});

const formSchema = Joi.object({
  enabled: Joi.boolean().default(true),
  fields: Joi.object({
    name: Joi.boolean().default(true),
    email: Joi.boolean().default(true),
    phone: Joi.boolean().default(false)
  }).default({}),
  consentText: Joi.string().trim().min(1).max(220).allow(null, ""),
  submitText: Joi.string().trim().min(1).max(40).allow(null, ""),
  successTitle: Joi.string().trim().min(1).max(120).allow(null, ""),
  successMessage: Joi.string().trim().min(1).max(220).allow(null, ""),
  couponCode: Joi.string().trim().min(1).max(60).allow(null, ""),
  redirectUrl: Joi.string().trim().uri().max(500).allow(null, "")
}).default({});

const behaviorSchema = Joi.object({
  dismissible: Joi.boolean().default(true),
  closeOnOverlay: Joi.boolean().default(true),
  dismissTtlHours: Joi.number().min(0).max(24 * 365).default(72),
  showDelayMs: Joi.number().min(0).max(20000).default(800),
  frequency: Joi.string().valid("once_per_ttl", "every_pageview", "once_per_session").default("once_per_ttl")
});

const targetingSchema = Joi.object({
  showOn: Joi.string().valid("all", "home", "cart").default("all")
});

const schedulingSchema = Joi.object({
  startAt: Joi.date().allow(null),
  endAt: Joi.date().allow(null)
});

const createSchema = Joi.object({
  version: Joi.number().integer().valid(1).default(1),
  name: Joi.string().trim().min(1).max(160).required(),
  status: Joi.string().valid("draft", "active", "paused").default("draft"),
  content: contentSchema.default({}),
  presentation: presentationSchema.default({}),
  form: formSchema.default({}),
  behavior: behaviorSchema.default({}),
  targeting: targetingSchema.default({}),
  scheduling: schedulingSchema.default({}),
  priority: Joi.number().integer().min(0).max(9999).default(100)
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160),
  status: Joi.string().valid("draft", "active", "paused"),
  content: contentSchema,
  presentation: presentationSchema,
  form: formSchema,
  behavior: behaviorSchema,
  targeting: targetingSchema,
  scheduling: schedulingSchema,
  priority: Joi.number().integer().min(0).max(9999)
}).min(1);

const listQuerySchema = Joi.object({
  status: Joi.string().valid("draft", "active", "paused")
});

const leadsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(200).default(50)
});

function createStorefrontPopupRouter(config) {
  const router = express.Router();
  const controller = createStorefrontPopupController(config);

  router.post("/", validate(createSchema, "body"), controller.createStorefrontPopup);
  router.get("/", validate(listQuerySchema, "query"), controller.listStorefrontPopups);
  router.patch("/:id", validate(updateSchema, "body"), controller.updateStorefrontPopup);
  router.delete("/:id", controller.deleteStorefrontPopup);
  router.get("/:id/leads", validate(leadsQuerySchema, "query"), controller.listPopupLeads);

  return router;
}

module.exports = {
  createStorefrontPopupRouter
};
