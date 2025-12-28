const mongoose = require("mongoose");

const StorefrontPopupSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true, index: true },
    version: { type: Number, required: true, default: 1 },
    status: { type: String, required: true, enum: ["draft", "active", "paused"], default: "draft", index: true },
    name: { type: String, default: "" },
    content: {
      title: { type: String, default: null },
      subtitle: { type: String, default: null },
      highlights: { type: [String], default: [] },
      imageUrl: { type: String, default: null }
    },
    presentation: {
      backgroundColor: { type: String, default: null },
      textColor: { type: String, default: null },
      accentColor: { type: String, default: null },
      overlayColor: { type: String, default: null },
      overlayOpacity: { type: Number, default: 0.55 },
      fontFamily: { type: String, default: null },
      shape: {
        radiusPx: { type: Number, default: 18 },
        widthPx: { type: Number, default: 420 }
      },
      layout: { type: String, default: "center" },
      glass: { type: Boolean, default: true },
      enterAnimation: { type: String, default: "pop" }
    },
    form: {
      enabled: { type: Boolean, default: true },
      fields: {
        name: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        phone: { type: Boolean, default: false }
      },
      consentText: { type: String, default: null },
      submitText: { type: String, default: null },
      successTitle: { type: String, default: null },
      successMessage: { type: String, default: null },
      couponCode: { type: String, default: null },
      redirectUrl: { type: String, default: null }
    },
    behavior: {
      dismissible: { type: Boolean, default: true },
      closeOnOverlay: { type: Boolean, default: true },
      dismissTtlHours: { type: Number, default: 72 },
      showDelayMs: { type: Number, default: 800 },
      frequency: { type: String, default: "once_per_ttl" }
    },
    targeting: {
      showOn: { type: String, enum: ["all", "home", "cart"], default: "all", index: true }
    },
    scheduling: {
      startAt: { type: Date, default: null, index: true },
      endAt: { type: Date, default: null, index: true }
    },
    priority: { type: Number, default: 100, index: true },
    deletedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true, collection: "storefront_popups" }
);

StorefrontPopupSchema.index({ storeId: 1, status: 1, deletedAt: 1, updatedAt: -1 });
StorefrontPopupSchema.index({ storeId: 1, status: 1, "targeting.showOn": 1, deletedAt: 1, priority: 1, updatedAt: -1 });

module.exports = mongoose.model("StorefrontPopup", StorefrontPopupSchema);

