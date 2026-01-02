const mongoose = require("mongoose");

const CartCouponSchema = new mongoose.Schema(
  {
    merchantId: { type: mongoose.Schema.Types.ObjectId, ref: "Merchant", required: true, index: true },
    cartKey: { type: String, index: true },
    cartHash: { type: String, required: true, index: true },
    sallaCouponId: { type: String }, // ✅ تم تغيير الاسم من couponId
    code: { type: String, required: true },
    status: { type: String, required: true, enum: ["issued", "redeemed", "superseded", "expired"], index: true },
    discountType: { type: String }, // ✅ بدلاً من sallaType
    discountValue: { type: Number }, // ✅ جديد: قيمة الخصم الأصلية
    discountAmount: { type: Number, required: true },
    includeProductIds: { type: [String], default: [] },
    appliedBundleIds: { type: [String], default: [] }, // ✅ جديد
    bundlesSummary: { type: [{ bundleId: String, discountAmount: Number }], default: [] }, // ✅ جديد
    expiresAt: { type: Date, required: true, index: true },
    issuedAt: { type: Date, default: Date.now }, // ✅ جديد
    createdAt: { type: Date, default: Date.now, index: true },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    redeemedAt: { type: Date },
    orderId: { type: String }
  },
  { timestamps: false, collection: "cart_coupons" }
);

CartCouponSchema.index({ merchantId: 1, cartHash: 1 }, { unique: true });
CartCouponSchema.index(
  { merchantId: 1, cartKey: 1, status: 1 },
  { unique: true, partialFilterExpression: { cartKey: { $exists: true, $type: "string" }, status: "issued" } }
);
CartCouponSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.model("CartCoupon", CartCouponSchema);
