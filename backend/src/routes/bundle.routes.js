const express = require("express");
const Joi = require("joi");
const { createBundleController } = require("../controllers/bundle.controller");
const { validate } = require("../middlewares/validate.middleware");

const componentSchema = Joi.object({
  variantId: Joi.string().trim().min(1).max(120).required(),
  quantity: Joi.number().integer().min(1).max(999).required(),
  group: Joi.string().trim().min(1).max(50).required()
});

const tierSchema = Joi.object({
  minQty: Joi.number().integer().min(1).max(999).required(),
  type: Joi.string().valid("fixed", "percentage", "bundle_price").required(),
  value: Joi.number().min(0).required()
});

const rulesSchema = Joi.object({
  type: Joi.string().valid("fixed", "percentage", "bundle_price").required(),
  value: Joi.number().min(0).required(),
  tiers: Joi.array().items(tierSchema).min(1),
  eligibility: Joi.object({
    mustIncludeAllGroups: Joi.boolean().default(true),
    minCartQty: Joi.number().integer().min(1).default(1)
  }).default({ mustIncludeAllGroups: true, minCartQty: 1 }),
  limits: Joi.object({
    maxUsesPerOrder: Joi.number().integer().min(1).max(50).default(1)
  }).default({ maxUsesPerOrder: 1 })
});

const settingsSchema = Joi.object({
  selectionRequired: Joi.boolean().default(false),
  variantRequired: Joi.boolean().default(true),
  variantPickerVisible: Joi.boolean().default(true),
  defaultSelectedProductIds: Joi.array().items(Joi.string().trim().min(1).max(40)).max(80).default([]),
  productOrder: Joi.array().items(Joi.string().trim().min(1).max(40)).max(120).default([])
}).default({ selectionRequired: false, variantRequired: true, variantPickerVisible: true, defaultSelectedProductIds: [], productOrder: [] });

const presentationSchema = Joi.object({
  coverVariantId: Joi.string().trim().min(1).max(120).allow(null, ""),
  title: Joi.string().trim().min(1).max(140).allow(null, ""),
  subtitle: Joi.string().trim().min(1).max(160).allow(null, ""),
  label: Joi.string().trim().min(1).max(60).allow(null, ""),
  labelSub: Joi.string().trim().min(1).max(120).allow(null, ""),
  cta: Joi.string().trim().min(1).max(60).allow(null, ""),
  bannerColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  badgeColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  textColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  ctaBgColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  ctaTextColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  labelBgColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  labelTextColor: Joi.string().trim().min(1).max(40).allow(null, ""),
  showItems: Joi.boolean().allow(null),
  showPrice: Joi.boolean().allow(null),
  showTiers: Joi.boolean().allow(null)
}).default({});

const createBundleSchema = Joi.object({
  version: Joi.number().integer().valid(1).default(1),
  kind: Joi.string().valid("quantity_discount", "products_discount", "products_no_discount", "post_add_upsell"),
  name: Joi.string().trim().min(1).max(200).required(),
  status: Joi.string().valid("draft", "active", "paused").default("draft"),
  components: Joi.array().items(componentSchema).min(1).required(),
  rules: rulesSchema.required(),
  settings: settingsSchema,
  presentation: presentationSchema
});

const updateBundleSchema = Joi.object({
  kind: Joi.string().valid("quantity_discount", "products_discount", "products_no_discount", "post_add_upsell"),
  name: Joi.string().trim().min(1).max(200),
  status: Joi.string().valid("draft", "active", "paused"),
  components: Joi.array().items(componentSchema).min(1),
  rules: rulesSchema,
  settings: settingsSchema,
  presentation: presentationSchema
}).min(1);

const listQuerySchema = Joi.object({
  status: Joi.string().valid("draft", "active", "paused")
});

const evaluateQuerySchema = Joi.object({
  createCoupon: Joi.boolean().default(false)
});

const cartItemsSchema = Joi.array()
  .items(
    Joi.object({
      variantId: Joi.string().trim().min(1).required(),
      quantity: Joi.number().integer().min(1).required()
    })
  )
  .min(1)
  .required();

const evaluateSchema = Joi.object({
  items: cartItemsSchema
});

const previewSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).allow(""),
  kind: Joi.string().valid("quantity_discount", "products_discount", "products_no_discount", "post_add_upsell"),
  components: Joi.array().items(componentSchema).min(1).required(),
  rules: rulesSchema.required(),
  settings: settingsSchema,
  presentation: presentationSchema,
  items: cartItemsSchema
});

function createBundleRouter(config) {
  const router = express.Router();
  const bundleController = createBundleController(config);

  router.post("/", validate(createBundleSchema, "body"), bundleController.createBundle);
  router.get("/", validate(listQuerySchema, "query"), bundleController.listBundles);
  router.post("/preview", validate(previewSchema, "body"), bundleController.previewBundle);
  router.patch("/:id", validate(updateBundleSchema, "body"), bundleController.updateBundle);
  router.delete("/:id", bundleController.deleteBundle);
  router.post(
    "/evaluate",
    validate(evaluateQuerySchema, "query"),
    validate(evaluateSchema, "body"),
    bundleController.evaluateBundles
  );
  router.post("/cart-banner", validate(evaluateSchema, "body"), bundleController.cartBanner);

  return router;
}

module.exports = {
  createBundleRouter
};
