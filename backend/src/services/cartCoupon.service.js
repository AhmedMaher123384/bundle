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
  const seed = `${merchantId}:${cartHash}:${Date.now()}:${Math.random()}`;
  return `B${sha256Hex(seed).slice(0, 15).toUpperCase()}`;
}

function formatDateOnlyUtc(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function formatDateOnlyInTimeZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: String(timeZone || "UTC"),
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(date));
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
    return formatDateOnlyUtc(date);
  } catch {
    return formatDateOnlyUtc(date);
  }
}

function addDaysToDateOnly(dateOnly, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateOnly || "").trim());
  if (!m) return String(dateOnly || "").trim();
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const delta = Number(days);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (Number.isFinite(delta) ? delta : 0));
  return dt.toISOString().slice(0, 10);
}

function resolveIncludeProductIdsFromEvaluation(evaluationResult) {
  const ids = evaluationResult?.applied?.matchedProductIds || [];
  return Array.from(new Set((Array.isArray(ids) ? ids : []).map((v) => String(v || "").trim()).filter(Boolean))).filter((v) =>
    /^\d+$/.test(v)
  );
}

function sameStringIdSet(a, b) {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  if (aa.length !== bb.length) return false;
  const sa = new Set(aa.map((v) => String(v || "").trim()).filter(Boolean));
  const sb = new Set(bb.map((v) => String(v || "").trim()).filter(Boolean));
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}

function amountsMatch(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return Math.abs(x - y) <= 0.01;
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

  const totalDiscount = evaluationResult?.applied?.totalDiscount;
  if (!Number.isFinite(totalDiscount) || totalDiscount <= 0) return null;

  const discountAmount = Number(Number(totalDiscount).toFixed(2));

  const appliedRule = evaluationResult?.applied?.rule || null;
  const appliedRuleType = String(appliedRule?.type || "")
    .trim()
    .toLowerCase();

  let sallaType = "fixed";
  let sallaAmount = discountAmount;
  let includeProductIds = [];
  let maximumAmount = null;

  if (appliedRuleType === "percentage") {
    const pct = Number(appliedRule?.value);
    if (Number.isFinite(pct) && pct > 0) {
      sallaType = "percentage";
      sallaAmount = Math.max(0, Math.min(100, pct));
      includeProductIds = resolveIncludeProductIdsFromEvaluation(evaluationResult);
      maximumAmount = discountAmount;
    }
  }

  const storedIncludeProductIds = includeProductIds;

  const existing = await getActiveIssuedCoupon(merchant._id, cartHash);
  if (existing) {
    const existingType = String(existing?.sallaType || "").trim().toLowerCase();
    if (
      existingType === sallaType &&
      amountsMatch(existing?.discountAmount, discountAmount) &&
      sameStringIdSet(existing?.includeProductIds, storedIncludeProductIds)
    ) {
      await markOtherIssuedCouponsSuperseded(merchant._id, cartHash);
      return existing;
    }
  }

  const now = new Date();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const sallaTimeZone = config?.salla?.timeZone || "Asia/Riyadh";
  const startDate = formatDateOnlyInTimeZone(now, sallaTimeZone);
  let expiryDate = formatDateOnlyInTimeZone(expiresAt, sallaTimeZone);
  if (expiryDate <= startDate) expiryDate = addDaysToDateOnly(startDate, 1);

  const basePayload = {
    free_shipping: false,
    exclude_sale_products: false,
    is_apply_with_offer: true,
    start_date: startDate,
    expiry_date: expiryDate,
    usage_limit: 1,
    usage_limit_per_user: 1
  };
  if (maximumAmount != null) basePayload.maximum_amount = maximumAmount;
  if (includeProductIds.length) basePayload.include_product_ids = includeProductIds;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = buildCouponCode(merchant.merchantId, cartHash);
    const payload = { ...basePayload, code, type: sallaType, amount: sallaAmount };

    let sallaCouponId = null;
    try {
      const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, payload);
      sallaCouponId = createdCouponResponse?.data?.id ?? null;
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        continue;
      }

      if (err instanceof ApiError && err.statusCode === 422) {
        const amountRounded = Math.max(1, Math.min(100, Math.round(Number(sallaAmount))));
        const maxFloored = payload.maximum_amount == null ? null : Math.max(0, Math.floor(Number(payload.maximum_amount)));
        const fallbackPayload = {
          ...payload,
          amount: Number.isFinite(amountRounded) ? amountRounded : payload.amount
        };
        if (maxFloored != null && Number.isFinite(maxFloored)) fallbackPayload.maximum_amount = maxFloored;
        try {
          const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, fallbackPayload);
          sallaCouponId = createdCouponResponse?.data?.id ?? null;
        } catch (e2) {
          if (e2 instanceof ApiError && e2.statusCode === 409) continue;
          if (e2 instanceof ApiError && e2.statusCode === 422) return null;
          throw e2;
        }
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
            sallaType,
            discountAmount,
            includeProductIds: storedIncludeProductIds,
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

async function issueOrReuseCouponForCartVerbose(config, merchant, merchantAccessToken, cartItems, evaluationResult, options) {
  const ttlHours = Math.max(1, Math.min(24, Number(options?.ttlHours || 24)));
  const { cartHash } = computeCartHash(cartItems);

  const fail = (reason, extra) => ({
    coupon: null,
    failure: { reason: String(reason || "UNKNOWN"), ...(extra || {}) }
  });

  const totalDiscount = evaluationResult?.applied?.totalDiscount;
  if (!Number.isFinite(totalDiscount) || totalDiscount <= 0) {
    return fail("NO_DISCOUNT", { totalDiscount: totalDiscount ?? null });
  }

  const discountAmount = Number(Number(totalDiscount).toFixed(2));

  const appliedRule = evaluationResult?.applied?.rule || null;
  const appliedRuleType = String(appliedRule?.type || "")
    .trim()
    .toLowerCase();

  let sallaType = "fixed";
  let sallaAmount = discountAmount;
  let includeProductIds = [];
  let maximumAmount = null;

  if (appliedRuleType === "percentage") {
    const pct = Number(appliedRule?.value);
    if (Number.isFinite(pct) && pct > 0) {
      sallaType = "percentage";
      sallaAmount = Math.max(0, Math.min(100, pct));
      includeProductIds = resolveIncludeProductIdsFromEvaluation(evaluationResult);
      maximumAmount = discountAmount;
    }
  }
  const storedIncludeProductIds = includeProductIds;

  const existing = await getActiveIssuedCoupon(merchant._id, cartHash);
  if (existing) {
    const existingType = String(existing?.sallaType || "").trim().toLowerCase();
    if (
      existingType === sallaType &&
      amountsMatch(existing?.discountAmount, discountAmount) &&
      sameStringIdSet(existing?.includeProductIds, storedIncludeProductIds)
    ) {
      await markOtherIssuedCouponsSuperseded(merchant._id, cartHash);
      return { coupon: existing, failure: null, reused: true };
    }
  }

  const now = new Date();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const sallaTimeZone = config?.salla?.timeZone || "Asia/Riyadh";
  const startDate = formatDateOnlyInTimeZone(now, sallaTimeZone);
  let expiryDate = formatDateOnlyInTimeZone(expiresAt, sallaTimeZone);
  if (expiryDate <= startDate) expiryDate = addDaysToDateOnly(startDate, 1);

  const basePayload = {
    free_shipping: false,
    exclude_sale_products: false,
    is_apply_with_offer: true,
    start_date: startDate,
    expiry_date: expiryDate,
    usage_limit: 1,
    usage_limit_per_user: 1
  };
  if (maximumAmount != null) basePayload.maximum_amount = maximumAmount;
  if (includeProductIds.length) basePayload.include_product_ids = includeProductIds;

  let lastCreateError = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = buildCouponCode(merchant.merchantId, cartHash);
    const payload = { ...basePayload, code, type: sallaType, amount: sallaAmount };

    let sallaCouponId = null;
    const triedPayloads = [];
    try {
      triedPayloads.push(payload);
      const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, payload);
      sallaCouponId = createdCouponResponse?.data?.id ?? null;
    } catch (err) {
      lastCreateError = err;
      if (err instanceof ApiError && err.statusCode === 409) {
        continue;
      }

      if (err instanceof ApiError && err.statusCode === 422) {
        const amountRounded = Math.max(1, Math.min(100, Math.round(Number(sallaAmount))));
        const maxFloored = payload.maximum_amount == null ? null : Math.max(0, Math.floor(Number(payload.maximum_amount)));
        const fallbackPayload = {
          ...payload,
          amount: Number.isFinite(amountRounded) ? amountRounded : payload.amount
        };
        if (maxFloored != null && Number.isFinite(maxFloored)) fallbackPayload.maximum_amount = maxFloored;

        try {
          triedPayloads.push(fallbackPayload);
          const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, fallbackPayload);
          sallaCouponId = createdCouponResponse?.data?.id ?? null;
        } catch (e2) {
          lastCreateError = e2;
          if (e2 instanceof ApiError && e2.statusCode === 409) continue;
          if (e2 instanceof ApiError && e2.statusCode === 422) {
            return fail("SALLA_COUPON_CREATE_FAILED", {
              statusCode: 422,
              error: e2.details ?? null,
              triedPayloads
            });
          }
          throw e2;
        }
      } else {
        return fail("SALLA_COUPON_CREATE_FAILED", {
          statusCode: err instanceof ApiError ? err.statusCode : null,
          error: err instanceof ApiError ? err.details ?? null : { message: err?.message ?? "Unknown error" },
          triedPayloads
        });
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
            sallaType,
            discountAmount,
            includeProductIds: storedIncludeProductIds,
            expiresAt,
            lastSeenAt: now
          },
          $setOnInsert: { createdAt: now },
          $unset: { redeemedAt: "", orderId: "" }
        },
        { upsert: true, new: true }
      );

      await markOtherIssuedCouponsSuperseded(merchant._id, cartHash);
      return { coupon: record, failure: null, reused: false };
    } catch (dbErr) {
      if (dbErr?.code === 11000) continue;
      return fail("DB_WRITE_FAILED", { error: { message: dbErr?.message ?? "DB error", code: dbErr?.code ?? null } });
    }
  }

  return fail("MAX_ATTEMPTS_EXCEEDED", {
    lastError: lastCreateError instanceof ApiError
      ? { statusCode: lastCreateError.statusCode, code: lastCreateError.code ?? null, details: lastCreateError.details ?? null }
      : lastCreateError
        ? { message: lastCreateError.message ?? String(lastCreateError) }
        : null
  });
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
  issueOrReuseCouponForCartVerbose,
  extractCouponCodeFromOrderPayload,
  extractOrderId,
  markCouponRedeemed,
  expireOldCoupons
};
