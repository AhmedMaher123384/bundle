const express = require("express");
const Joi = require("joi");
const { validate } = require("../middlewares/validate.middleware");
const { createAnnouncementBannerController } = require("../controllers/announcementBanner.controller");

const contentSchema = Joi.object({
  title: Joi.string().trim().min(1).max(120).allow(null, ""),
  message: Joi.string().trim().min(1).max(220).allow(null, ""),
  linkUrl: Joi.string().trim().uri().max(400).allow(null, ""),
  linkText: Joi.string().trim().min(1).max(40).allow(null, "")
});

const presentationSchema = Joi.object({
  backgroundColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  textColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  linkColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  accentColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  fontFamily: Joi.string().trim().min(1).max(160).allow(null, ""),
  sticky: Joi.boolean().default(true),
  motion: Joi.object({
    enabled: Joi.boolean().default(false),
    durationSec: Joi.number().min(1).max(20).default(8)
  }).default({})
});

const behaviorSchema = Joi.object({
  dismissible: Joi.boolean().default(true),
  selectable: Joi.boolean().default(true),
  dismissTtlHours: Joi.number().min(0).max(24 * 365).default(72)
});

const targetingSchema = Joi.object({
  showOn: Joi.string().valid("all", "cart").default("all")
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
  behavior: behaviorSchema,
  targeting: targetingSchema,
  scheduling: schedulingSchema,
  priority: Joi.number().integer().min(0).max(9999)
}).min(1);

const listQuerySchema = Joi.object({
  status: Joi.string().valid("draft", "active", "paused")
});

function createAnnouncementBannerRouter(config) {
  const router = express.Router();
  const controller = createAnnouncementBannerController(config);

  router.post("/", validate(createSchema, "body"), controller.createAnnouncementBanner);
  router.get("/", validate(listQuerySchema, "query"), controller.listAnnouncementBanners);
  router.patch("/:id", validate(updateSchema, "body"), controller.updateAnnouncementBanner);
  router.delete("/:id", controller.deleteAnnouncementBanner);

  return router;
}

module.exports = {
  createAnnouncementBannerRouter
};
