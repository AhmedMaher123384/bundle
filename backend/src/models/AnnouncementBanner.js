const mongoose = require("mongoose");

const AnnouncementBannerSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true, index: true },
    version: { type: Number, required: true, default: 1 },
    status: { type: String, required: true, enum: ["draft", "active", "paused"], default: "draft", index: true },
    name: { type: String, default: "" },
    content: {
      title: { type: String, default: null },
      message: { type: String, default: null },
      linkUrl: { type: String, default: null },
      linkText: { type: String, default: null }
    },
    presentation: {
      backgroundColor: { type: String, default: null },
      textColor: { type: String, default: null },
      linkColor: { type: String, default: null },
      accentColor: { type: String, default: null },
      sticky: { type: Boolean, default: true }
    },
    behavior: {
      dismissible: { type: Boolean, default: true },
      dismissTtlHours: { type: Number, default: 72 }
    },
    targeting: {
      showOn: { type: String, enum: ["all", "cart"], default: "all", index: true }
    },
    scheduling: {
      startAt: { type: Date, default: null, index: true },
      endAt: { type: Date, default: null, index: true }
    },
    priority: { type: Number, default: 100, index: true },
    deletedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true, collection: "announcement_banners" }
);

AnnouncementBannerSchema.index({ storeId: 1, status: 1, deletedAt: 1, updatedAt: -1 });
AnnouncementBannerSchema.index({ storeId: 1, status: 1, "targeting.showOn": 1, deletedAt: 1, priority: 1, updatedAt: -1 });

module.exports = mongoose.model("AnnouncementBanner", AnnouncementBannerSchema);

