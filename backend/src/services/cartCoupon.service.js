const CartCoupon = require("../models/CartCoupon");
const { createCoupon } = require("./sallaApi.service");
const { ApiError } = require("../utils/apiError");
const { sha256Hex } = require("../utils/hash");

function normalizeCartItems(items) {
  const map = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const variantId = String(it?.variantId || "").trim();
    const qty = Number(it?.quantity || 0);
    if (!variantId || !Number.isFinite(qty) || qty <= 0) continue;
    map.set(variantId, (map.get(variantId) || 0) + Math.floor(qty));
  }
  return Array.from(map.entries())
    .map(([variantId, quantity]) => ({ variantId, quantity }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
}

function computeCartHash(items) {
  const normalized = normalizeCartItems(items);
  return { normalized, cartHash: sha256Hex(JSON.stringify(normalized)) };
}

function buildCouponCode(merchantId, cartHash) {
  const codeHash = sha256Hex(`${merchantId}:${cartHash}`).slice(0, 10).toUpperCase();
  const nonce = sha256Hex(`${Date.now()}:${Math.random()}`).slice(0, 6).toUpperCase();
  return `BNDL${codeHash}${nonce}`;
}

function formatDateOnly(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function resolveIncludeProductIdsFromEvaluation(evaluationResult) {
  const ids = evaluationResult?.applied?.matchedProductIds || [];
  return Array.from(new Set((Array.isArray(ids) ? ids : []).map((v) => String(v || "").trim()).filter(Boolean))).filter((v) =>
    /^\d+$/.test(v)
  );
}

async function getActiveIssuedCoupon(merchantObjectId, cartHash) {
  const now = new Date();
  const existing = await CartCoupon.findOne({
    merchantId: merchantObjectId,
    cartHash,
    status: "issued",
    expiresAt: { $gt: now }
  });
  if (!existing) return null;
  existing.lastSeenAt = new Date();
  await existing.save();
  return existing;
}

async function markOtherIssuedCouponsSuperseded(merchantObjectId, currentCartHash) {
  await CartCoupon.updateMany(
    { merchantId: merchantObjectId, status: "issued", cartHash: { $ne: currentCartHash } },
    { $set: { status: "superseded" } }
  );
}

async function issueOrReuseCouponForCart(config, merchant, merchantAccessToken, cartItems, evaluationResult, options) {
  const ttlHours = Math.max(1, Math.min(24, Number(options?.ttlHours || 24)));
  const { cartHash } = computeCartHash(cartItems);

  const existing = await getActiveIssuedCoupon(merchant._id, cartHash);
  if (existing) {
    await markOtherIssuedCouponsSuperseded(merchant._id, cartHash);
    return existing;
  }

  const totalDiscount = evaluationResult?.applied?.totalDiscount;
  if (!Number.isFinite(totalDiscount) || totalDiscount <= 0) return null;

  const discountAmount = Number(Number(totalDiscount).toFixed(2));

  const includeProductIds = resolveIncludeProductIdsFromEvaluation(evaluationResult);
  if (!includeProductIds.length) return null;

  const appliedRule = evaluationResult?.applied?.rule || null;
  const pctRaw = appliedRule && String(appliedRule.type || "").trim() === "percentage" ? Number(appliedRule.value) : null;
  const pct =
    Number.isFinite(pctRaw) && pctRaw > 0
      ? Math.max(1, Math.min(100, Math.round(pctRaw)))
      : null;

  const now = new Date();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const basePayload = {
    free_shipping: false,
    exclude_sale_products: false,
    is_apply_with_offer: true,
    start_date: formatDateOnly(now),
    expiry_date: formatDateOnly(expiresAt),
    usage_limit: 1,
    usage_limit_per_user: 1,
    include_product_ids: includeProductIds
  };
  const preferPercentage = Boolean(pct != null);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = buildCouponCode(merchant.merchantId, cartHash);
    const fixedPayload = { ...basePayload, code, type: "fixed", amount: discountAmount };
    const percentagePayload = pct != null ? { ...basePayload, code, type: "percentage", amount: pct } : null;
    const firstPayload = preferPercentage && percentagePayload ? percentagePayload : fixedPayload;
    const secondPayload = preferPercentage && percentagePayload ? fixedPayload : percentagePayload;

    let sallaCouponId = null;
    try {
      const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, firstPayload);
      sallaCouponId = createdCouponResponse?.data?.id ?? null;
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        continue;
      }

      if (err instanceof ApiError && err.statusCode === 422) {
        let created = false;

        if (firstPayload.type === "fixed") {
          const floored = Math.floor(discountAmount);
          if (Number.isFinite(floored) && floored >= 1 && floored < discountAmount) {
            try {
              const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, { ...fixedPayload, amount: floored });
              sallaCouponId = createdCouponResponse?.data?.id ?? null;
              created = true;
            } catch (e2) {
              if (e2 instanceof ApiError && e2.statusCode === 409) continue;
              if (!(e2 instanceof ApiError) || e2.statusCode !== 422) throw e2;
            }
          }
        }

        if (!created && secondPayload) {
          try {
            const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, secondPayload);
            sallaCouponId = createdCouponResponse?.data?.id ?? null;
            created = true;
          } catch (e3) {
            if (e3 instanceof ApiError && e3.statusCode === 409) continue;
            if (e3 instanceof ApiError && e3.statusCode === 422) return null;
            throw e3;
          }
        }

        if (!created) return null;
      } else {
        throw err;
      }
    }

    try {
      const record = await CartCoupon.findOneAndUpdate(
        { merchantId: merchant._id, cartHash },
        {
          $set: {
            couponId: sallaCouponId ? String(sallaCouponId) : undefined,
            code,
            status: "issued",
            discountAmount,
            includeProductIds,
            expiresAt,
            lastSeenAt: now
          },
          $setOnInsert: { createdAt: now },
          $unset: { redeemedAt: "", orderId: "" }
        },
        { upsert: true, new: true }
      );

      await markOtherIssuedCouponsSuperseded(merchant._id, cartHash);
      return record;
    } catch (dbErr) {
      if (dbErr?.code === 11000) continue;
      throw dbErr;
    }
  }

  return null;
}

function extractCouponCodeFromOrderPayload(payload) {
  const candidates = [
    payload?.data?.order?.coupon?.code,
    payload?.order?.coupon?.code,
    payload?.data?.order?.discount?.coupon?.code,
    payload?.order?.discount?.coupon?.code,
    payload?.data?.coupon?.code,
    payload?.coupon?.code,
    payload?.data?.order?.coupon_code,
    payload?.order?.coupon_code,
    payload?.coupon_code
  ];
  for (const c of candidates) {
    const v = String(c || "").trim();
    if (v) return v;
  }
  return null;
}

function extractOrderId(payload) {
  const candidates = [payload?.data?.order?.id, payload?.order?.id, payload?.data?.id, payload?.id, payload?.order_id, payload?.data?.order_id];
  for (const c of candidates) {
    const v = String(c || "").trim();
    if (v) return v;
  }
  return null;
}

async function markCouponRedeemed(merchantObjectId, couponCode, orderId) {
  const code = String(couponCode || "").trim();
  if (!code) return null;
  const now = new Date();
  const updated = await CartCoupon.findOneAndUpdate(
    { merchantId: merchantObjectId, code, status: "issued" },
    { $set: { status: "redeemed", redeemedAt: now, orderId: orderId ? String(orderId) : undefined, lastSeenAt: now } },
    { new: true }
  );
  return updated;
}

async function expireOldCoupons() {
  const now = new Date();
  await CartCoupon.updateMany({ status: { $in: ["issued", "superseded"] }, expiresAt: { $lte: now } }, { $set: { status: "expired" } });
}

module.exports = {
  computeCartHash,
  issueOrReuseCouponForCart,
  extractCouponCodeFromOrderPayload,
  extractOrderId,
  markCouponRedeemed,
  expireOldCoupons
};
