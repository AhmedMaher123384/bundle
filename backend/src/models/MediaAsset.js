const mongoose = require("mongoose");

const MediaAssetSchema = new mongoose.Schema(
  {
    merchantId: { type: String, required: true, index: true },
    storeId: { type: String, required: true, index: true },

    resourceType: { type: String, required: true, enum: ["image", "video", "raw"], index: true },
    publicId: { type: String, required: true, index: true },
    assetId: { type: String, default: null, index: true },
    folder: { type: String, default: null, index: true },

    originalFilename: { type: String, default: null },
    format: { type: String, default: null },
    bytes: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration: { type: Number, default: null },

    url: { type: String, default: null },
    secureUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },

    tags: { type: [String], default: [] },
    context: { type: Object, default: null },
    cloudinaryCreatedAt: { type: Date, default: null, index: true },

    cloudinary: { type: Object, default: null },

    deletedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true, collection: "media_assets" }
);

MediaAssetSchema.index({ storeId: 1, resourceType: 1, deletedAt: 1, cloudinaryCreatedAt: -1, createdAt: -1 });
MediaAssetSchema.index({ storeId: 1, publicId: 1, deletedAt: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

module.exports = mongoose.model("MediaAsset", MediaAssetSchema);

