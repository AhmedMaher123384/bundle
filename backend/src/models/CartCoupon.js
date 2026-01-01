const mongoose = require("mongoose");

const CartCouponSchema = new mongoose.Schema(
  {
    system: { type: String, enum: ["mcoupon"], default: "mcoupon", index: true },
    merchantId: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", required: true, index: true },
    cartKey: { type: String, index: true },
    cartHash: { type: String, index: true },
    snapshotHash: { type: String, index: true },
    couponId: { type: String },
    code: { type: String, required: true },
    status: { type: String, required: true, enum: ["issued", "redeemed", "invalidated", "superseded", "expired", "cleared"], index: true },
    sallaType: { type: String },
    discountAmount: { type: Number, required: true },
    totalBundleDiscount: { type: Number, required: true },
    includeProductIds: { type: [String], default: [] },
    appliedBundleIds: { type: [String], default: [] },
    expiresAt: { type: Date, required: true, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    invalidatedAt: { type: Date, index: true },
    redeemedAt: { type: Date },
    orderId: { type: String }
  },
  { timestamps: false, collection: "cart_coupons" }
);

CartCouponSchema.index({ merchantId: 1, cartHash: 1 }, { unique: true, sparse: true });
CartCouponSchema.index({ merchantId: 1, cartKey: 1, status: 1, createdAt: -1 });
CartCouponSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.model("CartCoupon", CartCouponSchema);
