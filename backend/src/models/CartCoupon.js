const mongoose = require("mongoose");

const CartCouponSchema = new mongoose.Schema(
  {
    merchantId: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", required: true, index: true },
    cartHash: { type: String, required: true, index: true },
    couponId: { type: String },
    code: { type: String, required: true },
    status: { type: String, required: true, enum: ["issued", "redeemed", "superseded", "expired"], index: true },
    discountAmount: { type: Number, required: true },
    discountType: { type: String, enum: ["fixed", "percentage"], default: "fixed" },
    discountValue: { type: Number, required: true },
    includeProductIds: { type: [String], default: [] },
    bundleId: { type: String, index: true },
    sallaCouponId: { type: String },
    expiresAt: { type: Date, required: true, index: true },
    issuedAt: { type: Date },
    createdAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    redeemedAt: { type: Date },
    orderId: { type: String }
  },
  { timestamps: false, collection: "cart_coupons" }
);

CartCouponSchema.index({ merchantId: 1, cartHash: 1, bundleId: 1 }, { unique: true });
CartCouponSchema.index({ code: 1 }, { unique: true });
CartCouponSchema.index({ merchantId: 1, bundleId: 1, status: 1 });

module.exports = mongoose.model("CartCoupon", CartCouponSchema);
