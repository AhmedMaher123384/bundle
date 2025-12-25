const mongoose = require("mongoose");

const AuditSnapshotSchema = new mongoose.Schema(
  {
    merchantId: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", required: true, index: true },
    type: { type: String, required: true, enum: ["cart.updated", "order.created"], index: true },
    event: { type: String, required: true, index: true },
    deliveryId: { type: String, index: true },
    payloadHash: { type: String, required: true, index: true },
    cartSnapshotHash: { type: String, index: true },
    orderId: { type: String, index: true },
    couponCode: { type: String, index: true },
    severity: { type: String, required: true, enum: ["info", "warning", "critical"], index: true },
    snapshot: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: false, collection: "audit_snapshots" }
);

AuditSnapshotSchema.index({ merchantId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("AuditSnapshot", AuditSnapshotSchema);

