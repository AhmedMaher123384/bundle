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
            if (e3 instanceof ApiError && e3.statusCode === 422) {
              if (secondPayload.type === "fixed") {
                const secondAmount = Number(secondPayload.amount);
                const floored = Math.floor(secondAmount);
                if (Number.isFinite(floored) && floored >= 1 && floored < secondAmount) {
                  try {
                    const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, {
                      ...secondPayload,
                      amount: floored
                    });
                    sallaCouponId = createdCouponResponse?.data?.id ?? null;
                    created = true;
                  } catch (e4) {
                    if (e4 instanceof ApiError && e4.statusCode === 409) continue;
                    if (e4 instanceof ApiError && e4.statusCode === 422) return null;
                    throw e4;
                  }
                } else {
                  return null;
                }
              } else {
                return null;
              }
            }
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

async function issueOrReuseCouponForCartVerbose(config, merchant, merchantAccessToken, cartItems, evaluationResult, options) {
  const ttlHours = Math.max(1, Math.min(24, Number(options?.ttlHours || 24)));
  const { cartHash } = computeCartHash(cartItems);

  const fail = (reason, extra) => ({
    coupon: null,
    failure: { reason: String(reason || "UNKNOWN"), ...(extra || {}) }
  });

  const existing = await getActiveIssuedCoupon(merchant._id, cartHash);
  if (existing) {
    await markOtherIssuedCouponsSuperseded(merchant._id, cartHash);
    return { coupon: existing, failure: null, reused: true };
  }

  const totalDiscount = evaluationResult?.applied?.totalDiscount;
  if (!Number.isFinite(totalDiscount) || totalDiscount <= 0) {
    return fail("NO_DISCOUNT", { totalDiscount: totalDiscount ?? null });
  }

  const discountAmount = Number(Number(totalDiscount).toFixed(2));

  const includeProductIds = resolveIncludeProductIdsFromEvaluation(evaluationResult);
  if (!includeProductIds.length) {
    return fail("NO_MATCHED_PRODUCTS", {
      matchedProductIds: Array.isArray(evaluationResult?.applied?.matchedProductIds) ? evaluationResult.applied.matchedProductIds : []
    });
  }

  const appliedRule = evaluationResult?.applied?.rule || null;
  const pctRaw = appliedRule && String(appliedRule.type || "").trim() === "percentage" ? Number(appliedRule.value) : null;
  const pct =
    Number.isFinite(pctRaw) && pctRaw > 0
      ? Math.max(1, Math.min(100, Math.round(pctRaw)))
      : null;

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
  const preferPercentage = Boolean(pct != null);

  let lastCreateError = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = buildCouponCode(merchant.merchantId, cartHash);
    const fixedPayload = { ...basePayload, code, type: "fixed", amount: discountAmount };
    const percentagePayload = pct != null ? { ...basePayload, code, type: "percentage", amount: pct } : null;
    const firstPayload = preferPercentage && percentagePayload ? percentagePayload : fixedPayload;
    const secondPayload = preferPercentage && percentagePayload ? fixedPayload : percentagePayload;

    let sallaCouponId = null;
    const triedPayloads = [];
    try {
      triedPayloads.push(firstPayload);
      const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, firstPayload);
      sallaCouponId = createdCouponResponse?.data?.id ?? null;
    } catch (err) {
      lastCreateError = err;
      if (err instanceof ApiError && err.statusCode === 409) {
        continue;
      }

      if (err instanceof ApiError && err.statusCode === 422) {
        let created = false;

        if (firstPayload.type === "fixed") {
          const floored = Math.floor(discountAmount);
          if (Number.isFinite(floored) && floored >= 1 && floored < discountAmount) {
            try {
              triedPayloads.push({ ...fixedPayload, amount: floored });
              const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, { ...fixedPayload, amount: floored });
              sallaCouponId = createdCouponResponse?.data?.id ?? null;
              created = true;
            } catch (e2) {
              lastCreateError = e2;
              if (e2 instanceof ApiError && e2.statusCode === 409) continue;
              if (!(e2 instanceof ApiError) || e2.statusCode !== 422) throw e2;
            }
          }
        }

        if (!created && secondPayload) {
          try {
            triedPayloads.push(secondPayload);
            const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, secondPayload);
            sallaCouponId = createdCouponResponse?.data?.id ?? null;
            created = true;
          } catch (e3) {
            lastCreateError = e3;
            if (e3 instanceof ApiError && e3.statusCode === 409) continue;
            if (e3 instanceof ApiError && e3.statusCode === 422) {
              if (secondPayload.type === "fixed") {
                const secondAmount = Number(secondPayload.amount);
                const floored = Math.floor(secondAmount);
                if (Number.isFinite(floored) && floored >= 1 && floored < secondAmount) {
                  try {
                    const p4 = { ...secondPayload, amount: floored };
                    triedPayloads.push(p4);
                    const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, p4);
                    sallaCouponId = createdCouponResponse?.data?.id ?? null;
                    created = true;
                  } catch (e4) {
                    lastCreateError = e4;
                    if (e4 instanceof ApiError && e4.statusCode === 409) continue;
                    if (e4 instanceof ApiError && e4.statusCode === 422) {
                      return fail("SALLA_COUPON_CREATE_FAILED", {
                        statusCode: 422,
                        error: e4.details ?? null,
                        triedPayloads
                      });
                    }
                    throw e4;
                  }
                } else {
                  return fail("SALLA_COUPON_CREATE_FAILED", {
                    statusCode: 422,
                    error: e3.details ?? null,
                    triedPayloads
                  });
                }
              } else {
                return fail("SALLA_COUPON_CREATE_FAILED", {
                  statusCode: 422,
                  error: e3.details ?? null,
                  triedPayloads
                });
              }
            }
            throw e3;
          }
        }

        if (!created) {
          return fail("SALLA_COUPON_CREATE_FAILED", {
            statusCode: 422,
            error: err.details ?? null,
            triedPayloads
          });
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
