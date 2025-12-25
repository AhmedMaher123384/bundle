const mongoose = require("mongoose");

const LogSchema = new mongoose.Schema(
  {
    merchantId: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", required: true, index: true },
    bundleId: { type: mongoose.Schema.Types.ObjectId, ref: "Bundle", index: true },
    matchedVariants: { type: [String], default: [] },
    cartSnapshotHash: { type: String, index: true },
    createdAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: false, collection: "logs" }
);

module.exports = mongoose.model("Log", LogSchema);

