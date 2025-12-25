const mongoose = require("mongoose");

const WebhookLogSchema = new mongoose.Schema(
  {
    merchantId: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", index: true },
    event: { type: String, required: true, index: true },
    deliveryId: { type: String, index: true },
    payloadHash: { type: String, required: true, index: true },
    status: { type: String, required: true, enum: ["received", "processed", "failed"], index: true },
    errorCode: { type: String },
    createdAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: false, collection: "webhook_logs" }
);

WebhookLogSchema.index({ event: 1, deliveryId: 1, status: 1 });

module.exports = mongoose.model("WebhookLog", WebhookLogSchema);
