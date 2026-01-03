const mongoose = require("mongoose");

const BundleComponentSchema = new mongoose.Schema(
  {
    variantId: { type: String, required: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    group: { type: String, required: true }
  },
  { _id: false }
);

const BundleSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true, index: true },
    version: { type: Number, required: true, default: 1 },
    status: { type: String, required: true, enum: ["draft", "active", "paused"], default: "draft", index: true },
    kind: {
      type: String,
      required: false,
      enum: ["quantity_discount", "products_discount", "products_no_discount", "post_add_upsell", "popup"],
      default: undefined,
      index: true
    },
    name: { type: String, default: "" },
    components: { type: [BundleComponentSchema], required: true, default: [] },
    rules: {
      type: { type: String, required: true, enum: ["fixed", "percentage", "bundle_price"] },
      value: { type: Number, required: true, min: 0 },
      tiers: {
        type: [
          new mongoose.Schema(
            {
              minQty: { type: Number, required: true, min: 1 },
              type: { type: String, required: true, enum: ["fixed", "percentage", "bundle_price"] },
              value: { type: Number, required: true, min: 0 }
            },
            { _id: false }
          )
        ],
        required: false,
        default: undefined
      },
      eligibility: {
        mustIncludeAllGroups: { type: Boolean, required: true, default: true },
        minCartQty: { type: Number, required: true, min: 1, default: 1 }
      },
      limits: {
        maxUsesPerOrder: { type: Number, required: true, min: 1, default: 1 }
      }
    },
    settings: {
      selectionRequired: { type: Boolean, default: false },
      variantRequired: { type: Boolean, default: true },
      variantPickerVisible: { type: Boolean, default: true },
      defaultSelectedProductIds: { type: [String], default: [] },
      productOrder: { type: [String], default: [] }
    },
    presentation: {
      coverVariantId: { type: String, default: null },
      title: { type: String, default: null },
      subtitle: { type: String, default: null },
      label: { type: String, default: null },
      labelSub: { type: String, default: null },
      cta: { type: String, default: null },
      bannerColor: { type: String, default: null },
      badgeColor: { type: String, default: null },
      textColor: { type: String, default: null },
      ctaBgColor: { type: String, default: null },
      ctaTextColor: { type: String, default: null },
      labelBgColor: { type: String, default: null },
      labelTextColor: { type: String, default: null },
      showItems: { type: Boolean, default: null },
      showPrice: { type: Boolean, default: null },
      showTiers: { type: Boolean, default: null }
    },
    popupTriggers: {
      type: [String],
      required: false,
      enum: ["all", "home_load", "product_view", "product_exit", "cart_add", "cart_remove", "cart_view"],
      default: undefined
    },
    popupSettings: {
      type: new mongoose.Schema(
        {
          allowDoNotShow: { type: Boolean, default: true },
          maxViews: { type: Number, min: 1, default: 3 },
          viewScope: { type: String, enum: ["session", "user"], default: "session" },
          showCartTotal: { type: Boolean, default: true },
          allowBulkAdd: { type: Boolean, default: true }
        },
        { _id: false }
      ),
      required: false,
      default: undefined
    },
    triggerProductId: { type: String, default: null, index: true },
    deletedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true, collection: "bundles" }
);

BundleSchema.index({ storeId: 1, status: 1, deletedAt: 1, updatedAt: -1 });
BundleSchema.index({ storeId: 1, triggerProductId: 1, status: 1, deletedAt: 1, updatedAt: -1 });

module.exports = mongoose.model("Bundle", BundleSchema);
