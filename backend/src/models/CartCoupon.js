const mongoose = require("mongoose");

const CartCouponSchema = new mongoose.Schema(
  {
    merchantId: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", required: true, index: true },
    cartHash: { type: String, required: true, index: true },
    couponId: { type: String },
    code: { type: String, required: true },
    status: { type: String, required: true, enum: ["issued", "redeemed", "superseded", "expired"], index: true },
    sallaType: { type: String },
    discountAmount: { type: Number, required: true },
    includeProductIds: { type: [String], default: [] },
    expiresAt: { type: Date, required: true, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    redeemedAt: { type: Date },
    orderId: { type: String }
  },
  { timestamps: false, collection: "cart_coupons" }
);

CartCouponSchema.index({ merchantId: 1, cartHash: 1 }, { unique: true });
CartCouponSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.model("CartCoupon", CartCouponSchema);
