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

function buildCouponCode(merchantId, cartKey) {
  const seed = `${merchantId}:${cartKey}:${Date.now()}:${Math.random()}`;
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

function resolveAppliedBundleIdsFromEvaluation(evaluationResult) {
  const bundles = evaluationResult?.applied?.bundles || [];
  const ids = Array.isArray(bundles) ? bundles.map((b) => String(b?.bundleId || "").trim()).filter(Boolean) : [];
  return Array.from(new Set(ids)).sort();
}

function sumBundleDiscountFromEvaluation(evaluationResult) {
  const bundles = Array.isArray(evaluationResult?.applied?.bundles) ? evaluationResult.applied.bundles : [];
  const sum = bundles.reduce((acc, b) => {
    const v = Number(b?.discountAmount || 0);
    if (!Number.isFinite(v) || v <= 0) return acc;
    return acc + v;
  }, 0);
  return Number(sum.toFixed(2));
}

function toStringIdArray(v) {
  return Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];
}

function isSubsetArray(sub, sup) {
  const a = toStringIdArray(sub);
  const b = new Set(toStringIdArray(sup));
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function setsEqualArray(a, b) {
  const aa = new Set(toStringIdArray(a));
  const bb = new Set(toStringIdArray(b));
  if (aa.size !== bb.size) return false;
  for (const x of aa) if (!bb.has(x)) return false;
  return true;
}

function computeCartKeyFromOptions(cartItems, options) {
  const raw = String(options?.cartKey || "").trim();
  if (raw) return raw;
  const { cartHash } = computeCartHash(cartItems);
  return `hash:${cartHash}`;
}

async function getActiveIssuedCoupon(merchantObjectId, cartKey) {
  const now = new Date();
  const existing = await CartCoupon.findOne({
    merchantId: merchantObjectId,
    system: "mcoupon",
    cartKey,
    status: "issued",
    expiresAt: { $gt: now }
  }).sort({ createdAt: -1 });
  if (!existing) return null;
  existing.lastSeenAt = new Date();
  await existing.save();
  return existing;
}

async function invalidateIssuedCouponsForCartKey(merchantObjectId, cartKey, now) {
  const ts = now || new Date();
  await CartCoupon.updateMany(
    { merchantId: merchantObjectId, system: "mcoupon", cartKey, status: "issued" },
    { $set: { status: "invalidated", invalidatedAt: ts, lastSeenAt: ts } }
  );
}

async function clearIssuedCouponsForCartKey(merchantObjectId, cartKey, now) {
  const ts = now || new Date();
  await CartCoupon.updateMany(
    { merchantId: merchantObjectId, system: "mcoupon", cartKey, status: "issued" },
    { $set: { status: "cleared", invalidatedAt: ts, lastSeenAt: ts } }
  );
}

async function createMcouponInSalla(config, merchant, merchantAccessToken, cartKey, amount, includeProductIds, ttlHours) {
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
    usage_limit_per_user: 1,
    include_product_ids: includeProductIds
  };

  const discountAmount = Number(Number(amount).toFixed(2));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = buildCouponCode(merchant.merchantId, cartKey);
    const fixedPayload = { ...basePayload, code, type: "fixed", amount: discountAmount };
    try {
      const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, fixedPayload);
      const sallaCouponId = createdCouponResponse?.data?.id ?? null;
      return { code, couponId: sallaCouponId ? String(sallaCouponId) : null, expiresAt };
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) continue;
      if (err instanceof ApiError && err.statusCode === 422) {
        const floored = Math.floor(discountAmount);
        if (Number.isFinite(floored) && floored >= 1 && floored < discountAmount) {
          try {
            const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, { ...fixedPayload, amount: floored });
            const sallaCouponId = createdCouponResponse?.data?.id ?? null;
            return { code, couponId: sallaCouponId ? String(sallaCouponId) : null, expiresAt };
          } catch (e2) {
            if (e2 instanceof ApiError && e2.statusCode === 409) continue;
            if (e2 instanceof ApiError && e2.statusCode === 422) return null;
            throw e2;
          }
        }
        return null;
      }
      throw err;
    }
  }

  return null;
}

async function issueOrReuseCouponForCart(config, merchant, merchantAccessToken, cartItems, evaluationResult, options) {
  const ttlHours = Math.max(1, Math.min(24, Number(options?.ttlHours || 24)));
  const now = new Date();
  const cartKey = computeCartKeyFromOptions(cartItems, options);
  const { cartHash } = computeCartHash(cartItems);

  const appliedBundleIds = resolveAppliedBundleIdsFromEvaluation(evaluationResult);
  const totalBundleDiscount = sumBundleDiscountFromEvaluation(evaluationResult);

  const existing = await getActiveIssuedCoupon(merchant._id, cartKey);
  if (!appliedBundleIds.length || !Number.isFinite(totalBundleDiscount) || totalBundleDiscount <= 0) {
    if (existing) await clearIssuedCouponsForCartKey(merchant._id, cartKey, now);
    return null;
  }

  if (existing) {
    const prevBundleIds = toStringIdArray(existing?.appliedBundleIds);
    if (prevBundleIds.length && !isSubsetArray(prevBundleIds, appliedBundleIds)) {
      await clearIssuedCouponsForCartKey(merchant._id, cartKey, now);
      return null;
    }
    if (!setsEqualArray(prevBundleIds, appliedBundleIds) && isSubsetArray(prevBundleIds, appliedBundleIds)) {
      const includeProductIds = resolveIncludeProductIdsFromEvaluation(evaluationResult);
      if (!includeProductIds.length) {
        await clearIssuedCouponsForCartKey(merchant._id, cartKey, now);
        return null;
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const created = await createMcouponInSalla(
          config,
          merchant,
          merchantAccessToken,
          cartKey,
          totalBundleDiscount,
          includeProductIds,
          ttlHours
        );
        if (!created) break;
        await invalidateIssuedCouponsForCartKey(merchant._id, cartKey, now);
        try {
          const record = await CartCoupon.create({
            system: "mcoupon",
            merchantId: merchant._id,
            cartKey,
            cartHash,
            snapshotHash: evaluationResult?.cartSnapshotHash || undefined,
            couponId: created.couponId || undefined,
            code: created.code,
            status: "issued",
            sallaType: "fixed",
            discountAmount: Number(totalBundleDiscount.toFixed(2)),
            totalBundleDiscount: Number(totalBundleDiscount.toFixed(2)),
            includeProductIds,
            appliedBundleIds,
            expiresAt: created.expiresAt,
            createdAt: now,
            lastSeenAt: now
          });
          return record;
        } catch (dbErr) {
          if (dbErr?.code === 11000) continue;
          throw dbErr;
        }
      }
    }

    existing.lastSeenAt = now;
    await existing.save();
    return existing;
  }

  const includeProductIds = resolveIncludeProductIdsFromEvaluation(evaluationResult);
  if (!includeProductIds.length) return null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const created = await createMcouponInSalla(config, merchant, merchantAccessToken, cartKey, totalBundleDiscount, includeProductIds, ttlHours);
    if (!created) break;
    await invalidateIssuedCouponsForCartKey(merchant._id, cartKey, now);
    try {
      const record = await CartCoupon.create({
        system: "mcoupon",
        merchantId: merchant._id,
        cartKey,
        cartHash,
        snapshotHash: evaluationResult?.cartSnapshotHash || undefined,
        couponId: created.couponId || undefined,
        code: created.code,
        status: "issued",
        sallaType: "fixed",
        discountAmount: Number(totalBundleDiscount.toFixed(2)),
        totalBundleDiscount: Number(totalBundleDiscount.toFixed(2)),
        includeProductIds,
        appliedBundleIds,
        expiresAt: created.expiresAt,
        createdAt: now,
        lastSeenAt: now
      });
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
  const now = new Date();
  const cartKey = computeCartKeyFromOptions(cartItems, options);
  const { cartHash } = computeCartHash(cartItems);

  const appliedBundleIds = resolveAppliedBundleIdsFromEvaluation(evaluationResult);
  const totalBundleDiscount = sumBundleDiscountFromEvaluation(evaluationResult);

  const existing = await getActiveIssuedCoupon(merchant._id, cartKey);
  if (!appliedBundleIds.length || !Number.isFinite(totalBundleDiscount) || totalBundleDiscount <= 0) {
    if (existing) {
      await clearIssuedCouponsForCartKey(merchant._id, cartKey, now);
      return { coupon: null, failure: null, reused: false, action: "clear" };
    }
    return { coupon: null, failure: null, reused: false, action: "none" };
  }

  if (existing) {
    const prevBundleIds = toStringIdArray(existing?.appliedBundleIds);
    if (prevBundleIds.length && !isSubsetArray(prevBundleIds, appliedBundleIds)) {
      await clearIssuedCouponsForCartKey(merchant._id, cartKey, now);
      return { coupon: null, failure: null, reused: false, action: "clear" };
    }
    if (setsEqualArray(prevBundleIds, appliedBundleIds)) {
      existing.lastSeenAt = now;
      await existing.save();
      return { coupon: existing, failure: null, reused: true, action: "apply" };
    }
  }

  const includeProductIds = resolveIncludeProductIdsFromEvaluation(evaluationResult);
  if (!includeProductIds.length) {
    return {
      coupon: null,
      failure: {
        reason: "NO_MATCHED_PRODUCTS",
        matchedProductIds: Array.isArray(evaluationResult?.applied?.matchedProductIds) ? evaluationResult.applied.matchedProductIds : []
      },
      reused: false,
      action: "none"
    };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const created = await createMcouponInSalla(config, merchant, merchantAccessToken, cartKey, totalBundleDiscount, includeProductIds, ttlHours);
    if (!created) {
      return { coupon: null, failure: { reason: "SALLA_COUPON_CREATE_FAILED" }, reused: false, action: "none" };
    }
    await invalidateIssuedCouponsForCartKey(merchant._id, cartKey, now);
    try {
      const record = await CartCoupon.create({
        system: "mcoupon",
        merchantId: merchant._id,
        cartKey,
        cartHash,
        snapshotHash: evaluationResult?.cartSnapshotHash || undefined,
        couponId: created.couponId || undefined,
        code: created.code,
        status: "issued",
        sallaType: "fixed",
        discountAmount: Number(totalBundleDiscount.toFixed(2)),
        totalBundleDiscount: Number(totalBundleDiscount.toFixed(2)),
        includeProductIds,
        appliedBundleIds,
        expiresAt: created.expiresAt,
        createdAt: now,
        lastSeenAt: now
      });
      return { coupon: record, failure: null, reused: false, action: "apply" };
    } catch (dbErr) {
      if (dbErr?.code === 11000) continue;
      return {
        coupon: null,
        failure: { reason: "DB_WRITE_FAILED", error: { message: dbErr?.message ?? "DB error", code: dbErr?.code ?? null } },
        reused: false,
        action: "none"
      };
    }
  }

  return { coupon: null, failure: { reason: "DB_WRITE_CONFLICT" }, reused: false, action: "none" };
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
