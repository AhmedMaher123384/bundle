const CartCoupon = require("../models/CartCoupon");
const { createCoupon, createSpecialOffer, updateSpecialOffer, changeSpecialOfferStatus, deleteSpecialOffer } = require("./sallaApi.service");
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

function buildSpecialOfferName(merchantStoreId, groupKey) {
  const store = String(merchantStoreId || "").trim() || "store";
  const key = String(groupKey || "").trim();
  const suffix = key ? `-${key.slice(0, 8)}` : "";
  // Add timestamp and random suffix to ensure uniqueness (Salla rejects duplicate offer names)
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `BO ${store}${suffix}-${ts}${rand}`.slice(0, 190);
}

function buildSpecialOfferMessage(discountAmount) {
  const amt = Number(discountAmount);
  const v = Number.isFinite(amt) ? Number(amt.toFixed(2)) : null;
  return v != null ? `خصم الباندل: ${v}` : "خصم الباندل";
}

function normalizeProductIdNumbers(productIds) {
  const out = [];
  for (const v of Array.isArray(productIds) ? productIds : []) {
    const s = String(v || "").trim();
    if (!/^\d+$/.test(s)) continue;
    const n = Number(s);
    if (Number.isFinite(n)) out.push(n);
  }
  return Array.from(new Set(out));
}

function formatDateOnlyUtc(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function formatDateTimeUtc(date) {
  return new Date(date).toISOString().replace("T", " ").slice(0, 19);
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

function formatDateTimeInTimeZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: String(timeZone || "UTC"),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(new Date(date));
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    const hour = parts.find((p) => p.type === "hour")?.value;
    const minute = parts.find((p) => p.type === "minute")?.value;
    const second = parts.find((p) => p.type === "second")?.value;
    if (year && month && day && hour && minute && second) return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    return formatDateTimeUtc(date);
  } catch {
    return formatDateTimeUtc(date);
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

function computeMinPurchaseAmountForDiscount(discountAmount) {
  const amt = Number(discountAmount);
  if (!Number.isFinite(amt) || amt <= 0) return 0;
  // For high discounts, we still need to ensure min_purchase_amount > discount_amount
  // but we want to make it more reasonable than discount + 1 for very high discounts
  if (amt >= 1000) {
    // Use discount + 10% of discount, with a minimum of discount + 100
    return Math.max(amt + 100, Math.ceil(amt * 1.1));
  }
  return Math.max(0, Math.ceil(amt + 1));
}

function unionStringIds(a, b) {
  const out = new Set();
  for (const v of Array.isArray(a) ? a : []) {
    const s = String(v || "").trim();
    if (/^\d+$/.test(s)) out.add(s);
  }
  for (const v of Array.isArray(b) ? b : []) {
    const s = String(v || "").trim();
    if (/^\d+$/.test(s)) out.add(s);
  }
  return Array.from(out);
}

function extractBundlesFromEvaluation(evaluationResult) {
  const arr = evaluationResult?.applied?.bundles;
  const out = [];
  for (const b of Array.isArray(arr) ? arr : []) {
    const bundleId = String(b?.bundleId || "").trim();
    const discountAmount = Number(b?.discountAmount || 0);
    if (!bundleId || !Number.isFinite(discountAmount) || discountAmount <= 0) continue;
    out.push({ bundleId, discountAmount: Number(discountAmount.toFixed(2)) });
  }
  return out;
}

function normalizeBundlesSummary(summary) {
  const out = [];
  for (const b of Array.isArray(summary) ? summary : []) {
    const bundleId = String(b?.bundleId || "").trim();
    const discountAmount = Number(b?.discountAmount || 0);
    if (!bundleId || !Number.isFinite(discountAmount) || discountAmount <= 0) continue;
    out.push({ bundleId, discountAmount: Number(discountAmount.toFixed(2)) });
  }
  return out;
}

function mergeBundlesSummary(existingSummary, incomingSummary) {
  const map = new Map();
  for (const b of normalizeBundlesSummary(existingSummary)) map.set(b.bundleId, b.discountAmount);
  for (const b of normalizeBundlesSummary(incomingSummary)) map.set(b.bundleId, b.discountAmount);
  const merged = Array.from(map.entries()).map(([bundleId, discountAmount]) => ({ bundleId, discountAmount }));
  const total = merged.reduce((acc, b) => acc + Number(b.discountAmount || 0), 0);
  return {
    bundlesSummary: merged,
    appliedBundleIds: merged.map((b) => b.bundleId),
    discountAmount: Number(Number(total).toFixed(2))
  };
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

function normalizeCartKey(cartKey) {
  const ck = String(cartKey || "").trim();
  if (!ck) return null;
  return ck.length > 200 ? ck.slice(0, 200) : ck;
}

async function getActiveIssuedCoupon(merchantObjectId, group) {
  const now = new Date();
  const existing = await CartCoupon.findOne(
    {
      merchantId: merchantObjectId,
      ...(group?.cartKey ? { cartKey: String(group.cartKey) } : { cartHash: String(group?.cartHash || "") }),
      status: "issued",
      expiresAt: { $gt: now }
    },
    null,
    { sort: { lastSeenAt: -1, createdAt: -1, _id: -1 } }
  );
  if (!existing) return null;
  existing.lastSeenAt = new Date();
  await existing.save();
  return existing;
}

async function markOtherIssuedCouponsSuperseded(merchantObjectId, group, keepCouponId) {
  await CartCoupon.updateMany(
    {
      merchantId: merchantObjectId,
      status: "issued",
      ...(group?.cartKey ? { cartKey: String(group.cartKey) } : { cartHash: String(group?.cartHash || "") }),
      ...(keepCouponId ? { _id: { $ne: keepCouponId } } : {})
    },
    { $set: { status: "superseded" } }
  );
}

async function clearCartStateForGroup(merchantObjectId, group) {
  await CartCoupon.deleteMany({
    merchantId: merchantObjectId,
    ...(group?.cartKey ? { cartKey: String(group.cartKey) } : { cartHash: String(group?.cartHash || "") }),
    status: { $in: ["issued", "superseded", "expired"] }
  });
}

async function clearSallaOffersForGroup(config, merchantAccessToken, merchantObjectId, group) {
  const docs = await CartCoupon.find(
    {
      merchantId: merchantObjectId,
      ...(group?.cartKey ? { cartKey: String(group.cartKey) } : { cartHash: String(group?.cartHash || "") }),
      status: { $in: ["issued", "superseded", "expired"] }
    },
    { offerId: 1 }
  );

  for (const d of Array.isArray(docs) ? docs : []) {
    const offerId = String(d?.offerId || "").trim();
    if (!offerId) continue;
    await deleteSpecialOffer(config.salla, merchantAccessToken, offerId).catch(() => undefined);
  }
}

async function issueOrReuseSpecialOfferForCartVerbose(config, merchant, merchantAccessToken, cartItems, evaluationResult, options) {
  const ttlHours = Math.max(1, Math.min(24, Number(options?.ttlHours || 24)));
  const { cartHash } = computeCartHash(cartItems);
  const cartKey = normalizeCartKey(options?.cartKey);
  const group = cartKey ? { cartKey } : { cartHash };
  const mode = options?.mode ? String(options.mode) : cartKey ? "incremental" : "authoritative";
  const resolvedMode = mode === "authoritative" ? "authoritative" : "incremental";

  const fail = (reason, extra) => ({
    offer: null,
    action: "fail",
    failure: { reason: String(reason || "UNKNOWN"), ...(extra || {}) }
  });

  const existing = await getActiveIssuedCoupon(merchant._id, group);

  const totalDiscount = evaluationResult?.applied?.totalDiscount;
  if (!Number.isFinite(totalDiscount) || totalDiscount <= 0) {
    if (existing) {
      return { offer: existing, action: "keep", failure: null };
    } else {
      await clearSallaOffersForGroup(config, merchantAccessToken, merchant._id, group).catch(() => undefined);
      await clearCartStateForGroup(merchant._id, group);
      return { offer: null, action: "clear", failure: null };
    }
  }

  const discountAmount = Number(Number(totalDiscount).toFixed(2));
  const includeProductIds = resolveIncludeProductIdsFromEvaluation(evaluationResult);
  if (!includeProductIds.length) {
    if (existing) {
      return { offer: existing, action: "keep", failure: null };
    } else {
      await clearSallaOffersForGroup(config, merchantAccessToken, merchant._id, group).catch(() => undefined);
      await clearCartStateForGroup(merchant._id, group);
      return { offer: null, action: "clear", failure: null };
    }
  }

  const incomingBundlesSummary = extractBundlesFromEvaluation(evaluationResult);
  // When using cartKey, we should merge if we found an existing coupon by cartKey, regardless of cartHash changes
  const shouldMerge =
    resolvedMode === "incremental" && existing && (
      cartKey ? (existing.cartKey === cartKey) : (String(existing?.cartHash || "") === String(cartHash || ""))
    );
  const mergedBundles = shouldMerge ? mergeBundlesSummary(existing?.bundlesSummary, incomingBundlesSummary) : null;
  const desiredDiscountAmount = mergedBundles?.discountAmount || discountAmount;
  const desiredIncludeProductIds =
    shouldMerge ? unionStringIds(existing?.includeProductIds, includeProductIds) : includeProductIds;
  const desiredAppliedBundleIds = mergedBundles?.appliedBundleIds || incomingBundlesSummary.map((b) => b.bundleId);
  const desiredBundlesSummary = mergedBundles?.bundlesSummary || incomingBundlesSummary;

  const now = new Date();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const sallaTimeZone = config?.salla?.timeZone || "Asia/Riyadh";
  const startAt = new Date(Date.now() + 60 * 1000);
  const startDate = formatDateTimeInTimeZone(startAt, sallaTimeZone);
  let expiryDate = formatDateTimeInTimeZone(expiresAt, sallaTimeZone);
  if (expiryDate <= startDate) expiryDate = formatDateTimeInTimeZone(new Date(startAt.getTime() + 60 * 60 * 1000), sallaTimeZone);

  const productNumbers = normalizeProductIdNumbers(desiredIncludeProductIds);
  if (!productNumbers.length) {
    if (existing) {
      return { offer: existing, action: "keep", failure: null };
    } else {
      await clearSallaOffersForGroup(config, merchantAccessToken, merchant._id, group).catch(() => undefined);
      await clearCartStateForGroup(merchant._id, group);
      return { offer: null, action: "clear", failure: null };
    }
  }

  const minPurchaseAmount = computeMinPurchaseAmountForDiscount(desiredDiscountAmount);
  const minQty = productNumbers.length;
  const messageText = `خصم الباندل: ${Number(desiredDiscountAmount.toFixed(2))} • نوع: fixed_amount • أقل كمية: ${minQty} • أولوية: 100`;
  const payloadBase = {
    name: buildSpecialOfferName(merchant.merchantId, cartKey || cartHash),
    message: messageText,
    applied_channel: "browser_and_application",
    offer_type: "fixed_amount",
    applied_to: "product",
    start_date: startDate,
    expiry_date: expiryDate,
    min_purchase_amount: minPurchaseAmount,
    min_items_count: productNumbers.length,
    min_items: 0,
    buy: {
      type: "product",
      min_amount: minPurchaseAmount,
      quantity: productNumbers.length,
      products: productNumbers
    },
    get: {
      discount_type: "fixed_amount",
      discount_amount: desiredDiscountAmount
    }
  };

  const existingType = String(existing?.discountType || "").trim().toLowerCase();
  const existingOfferId = String(existing?.offerId || "").trim();

  // In authoritative mode, delete the old offer from Salla first to ensure clean state
  if (resolvedMode === "authoritative" && existing && existingOfferId) {
    await deleteSpecialOffer(config.salla, merchantAccessToken, existingOfferId).catch(() => undefined);
    // Clear the existing record so we create a fresh offer
    await clearCartStateForGroup(merchant._id, group).catch(() => undefined);
    // Skip the update/reuse path and go directly to create new offer
  } else if (existing && existingType === "special_offer_fixed_amount" && existingOfferId) {
    if (amountsMatch(existing?.discountAmount, desiredDiscountAmount) && sameStringIdSet(existing?.includeProductIds, desiredIncludeProductIds)) {
      // Update the message in Salla even when reusing to ensure it shows the correct amount
      const messageUpdatePayload = {
        message: `خصم الباندل: ${Number(desiredDiscountAmount.toFixed(2))} • نوع: fixed_amount • أقل كمية: ${minQty} • أولوية: 100`
      };
      await updateSpecialOffer(config.salla, merchantAccessToken, existingOfferId, messageUpdatePayload).catch(() => undefined);
      
      existing.appliedBundleIds = desiredAppliedBundleIds;
      existing.bundlesSummary = desiredBundlesSummary;
      existing.lastSeenAt = new Date();
      await existing.save();
      await changeSpecialOfferStatus(config.salla, merchantAccessToken, existingOfferId, "active").catch(() => undefined);
      await markOtherIssuedCouponsSuperseded(merchant._id, group, existing?._id);
      return { offer: existing, action: "reuse", failure: null, reused: true };
    }

    const triedPayloads = [];
    try {
      triedPayloads.push(payloadBase);
      await updateSpecialOffer(config.salla, merchantAccessToken, existingOfferId, payloadBase);
      await changeSpecialOfferStatus(config.salla, merchantAccessToken, existingOfferId, "active").catch(() => undefined);

      existing.discountAmount = desiredDiscountAmount;
      existing.includeProductIds = desiredIncludeProductIds;
      existing.appliedBundleIds = desiredAppliedBundleIds;
      existing.bundlesSummary = desiredBundlesSummary;
      existing.expiresAt = expiresAt;
      existing.issuedAt = now;
      existing.lastSeenAt = now;
      await existing.save();

      await markOtherIssuedCouponsSuperseded(merchant._id, group, existing?._id);
      return { offer: existing, action: "update", failure: null, reused: false };
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 422) {
        const floored = Math.floor(desiredDiscountAmount);
        if (Number.isFinite(floored) && floored >= 1 && floored < desiredDiscountAmount) {
          const payload2 = {
            ...payloadBase,
            min_purchase_amount: computeMinPurchaseAmountForDiscount(floored),
            buy: { ...payloadBase.buy, min_amount: computeMinPurchaseAmountForDiscount(floored) },
            get: { discount_amount: floored },
            message: buildSpecialOfferMessage(floored)
          };
          try {
            triedPayloads.push(payload2);
            await updateSpecialOffer(config.salla, merchantAccessToken, existingOfferId, payload2);
            await changeSpecialOfferStatus(config.salla, merchantAccessToken, existingOfferId, "active").catch(() => undefined);

            existing.discountAmount = floored;
            existing.includeProductIds = desiredIncludeProductIds;
            existing.appliedBundleIds = desiredAppliedBundleIds;
            existing.bundlesSummary = desiredBundlesSummary;
            existing.expiresAt = expiresAt;
            existing.issuedAt = now;
            existing.lastSeenAt = now;
            await existing.save();

            await markOtherIssuedCouponsSuperseded(merchant._id, group, existing?._id);
            return { offer: existing, action: "update", failure: null, reused: false };
          } catch (e2) {
            return fail("SALLA_SPECIALOFFER_UPDATE_FAILED", {
              statusCode: e2 instanceof ApiError ? e2.statusCode : null,
              error: e2 instanceof ApiError ? e2.details ?? null : { message: e2?.message ?? "Unknown error" },
              triedPayloads
            });
          }
        }
      }
      return fail("SALLA_SPECIALOFFER_UPDATE_FAILED", {
        statusCode: err instanceof ApiError ? err.statusCode : null,
        error: err instanceof ApiError ? err.details ?? null : { message: err?.message ?? "Unknown error" }
      });
    }
  }

  let lastCreateError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = buildCouponCode(merchant.merchantId, cartHash);
    const triedPayloads = [];
    let offerId = null;
    let usedDiscountAmount = desiredDiscountAmount;

    // Build payload with fresh unique name on each attempt (Salla rejects duplicate names)
    const attemptPayload = {
      name: buildSpecialOfferName(merchant.merchantId, cartKey || cartHash),
      message: messageText,
      applied_channel: "browser_and_application",
      offer_type: "fixed_amount",
      applied_to: "product",
      start_date: startDate,
      expiry_date: expiryDate,
      min_purchase_amount: minPurchaseAmount,
      min_items_count: productNumbers.length,
      min_items: 0,
      buy: {
        type: "product",
        min_amount: minPurchaseAmount,
        quantity: productNumbers.length,
        products: productNumbers
      },
      get: {
        discount_type: "fixed_amount",
        discount_amount: desiredDiscountAmount
      }
    };

    try {
      triedPayloads.push(attemptPayload);
      const created = await createSpecialOffer(config.salla, merchantAccessToken, attemptPayload);
      offerId = created?.data?.id ?? null;
    } catch (err) {
      lastCreateError = err;
      if (err instanceof ApiError && err.statusCode === 422) {
        // Check if this is a name conflict error - if so, retry with new name
        const nameError = err.details?.error?.fields?.name || err.details?.fields?.name;
        if (nameError && attempt < 5) {
          continue; // Retry with a new unique name
        }

        const floored = Math.floor(desiredDiscountAmount);
        if (Number.isFinite(floored) && floored >= 1 && floored < desiredDiscountAmount) {
          const payload2 = {
            ...attemptPayload,
            min_purchase_amount: computeMinPurchaseAmountForDiscount(floored),
            buy: { ...attemptPayload.buy, min_amount: computeMinPurchaseAmountForDiscount(floored) },
            get: { discount_type: "fixed_amount", discount_amount: floored },
            message: `خصم الباندل: ${Number(floored.toFixed(2))} • نوع: fixed_amount • أقل كمية: ${minQty} • أولوية: 100`
          };
          try {
            triedPayloads.push(payload2);
            const created = await createSpecialOffer(config.salla, merchantAccessToken, payload2);
            offerId = created?.data?.id ?? null;
            usedDiscountAmount = floored;
          } catch (e2) {
            lastCreateError = e2;
            // Check if this is also a name conflict - retry
            const nameError2 = e2 instanceof ApiError && (e2.details?.error?.fields?.name || e2.details?.fields?.name);
            if (nameError2 && attempt < 5) {
              continue; // Retry with a new unique name
            }
            return fail("SALLA_SPECIALOFFER_CREATE_FAILED", {
              statusCode: 422,
              error: e2.details ?? null,
              triedPayloads
            });
          }
        } else {
          return fail("SALLA_SPECIALOFFER_CREATE_FAILED", { statusCode: 422, error: err.details ?? null, triedPayloads });
        }
      } else {
        return fail("SALLA_SPECIALOFFER_CREATE_FAILED", {
          statusCode: err instanceof ApiError ? err.statusCode : null,
          error: err instanceof ApiError ? err.details ?? null : { message: err?.message ?? "Unknown error" },
          triedPayloads
        });
      }
    }


    try {
      if (offerId != null) {
        await changeSpecialOfferStatus(config.salla, merchantAccessToken, offerId, "active").catch(() => undefined);
      }

      const record = await CartCoupon.findOneAndUpdate(
        cartKey ? { merchantId: merchant._id, cartKey, status: "issued" } : { merchantId: merchant._id, cartHash, status: "issued" },
        {
          $set: {
            offerId: offerId != null ? String(offerId) : undefined,
            code,
            status: "issued",
            discountType: "special_offer_fixed_amount",
            ...(cartKey ? { cartKey } : {}),
            discountAmount: usedDiscountAmount,
            includeProductIds: desiredIncludeProductIds,
            appliedBundleIds: desiredAppliedBundleIds,
            bundlesSummary: desiredBundlesSummary,
            expiresAt,
            issuedAt: now,
            lastSeenAt: now
          },
          $setOnInsert: { createdAt: now, cartHash },
          $unset: { redeemedAt: "", orderId: "", sallaCouponId: "" }
        },
        { upsert: true, new: true }
      );

      if (existing && String(existing?.offerId || "").trim()) {
        await deleteSpecialOffer(config.salla, merchantAccessToken, String(existing.offerId)).catch(() => undefined);
      }

      await markOtherIssuedCouponsSuperseded(merchant._id, group, record?._id);
      return { offer: record, action: "create", failure: null, reused: false };
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

async function issueOrReuseCouponForCart(config, merchant, merchantAccessToken, cartItems, evaluationResult, options) {
  const ttlHours = Math.max(1, Math.min(24, Number(options?.ttlHours || 24)));
  const { cartHash } = computeCartHash(cartItems);
  const cartKey = normalizeCartKey(options?.cartKey);
  const group = cartKey ? { cartKey } : { cartHash };

  const totalDiscount = evaluationResult?.applied?.totalDiscount;
  if (!Number.isFinite(totalDiscount) || totalDiscount <= 0) return null;

  const discountAmount = Number(Number(totalDiscount).toFixed(2));

  const includeProductIds = resolveIncludeProductIdsFromEvaluation(evaluationResult);
  if (!includeProductIds.length) return null;

  const existing = await getActiveIssuedCoupon(merchant._id, group);
  if (existing) {
    const existingType = String(existing?.discountType || existing?.sallaType || "").trim().toLowerCase();
    if (existingType === "fixed" && amountsMatch(existing?.discountAmount, discountAmount) && sameStringIdSet(existing?.includeProductIds, includeProductIds)) {
      await markOtherIssuedCouponsSuperseded(merchant._id, group, existing?._id);
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
    usage_limit_per_user: 1,
    include_product_ids: includeProductIds
  };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = buildCouponCode(merchant.merchantId, cartHash);
    const fixedPayload = { ...basePayload, code, type: "fixed", amount: discountAmount };

    let sallaCouponId = null;
    try {
      const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, fixedPayload);
      sallaCouponId = createdCouponResponse?.data?.id ?? null;
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        continue;
      }

      if (err instanceof ApiError && err.statusCode === 422) {
        const floored = Math.floor(discountAmount);
        if (Number.isFinite(floored) && floored >= 1 && floored < discountAmount) {
          try {
            const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, { ...fixedPayload, amount: floored });
            sallaCouponId = createdCouponResponse?.data?.id ?? null;
          } catch (e2) {
            if (e2 instanceof ApiError && e2.statusCode === 409) continue;
            if (e2 instanceof ApiError && e2.statusCode === 422) return null;
            throw e2;
          }
        } else {
          return null;
        }
      } else {
        throw err;
      }
    }

    try {
      const record = await CartCoupon.findOneAndUpdate(
        cartKey ? { merchantId: merchant._id, cartKey, status: "issued" } : { merchantId: merchant._id, cartHash, status: "issued" },
        {
          $set: {
            sallaCouponId: sallaCouponId ? String(sallaCouponId) : undefined,
            ...(cartKey ? { cartKey } : {}),
            code,
            status: "issued",
            discountType: "fixed",
            discountAmount,
            includeProductIds,
            expiresAt,
            lastSeenAt: now
          },
          $setOnInsert: { createdAt: now, cartHash },
          $unset: { redeemedAt: "", orderId: "" }
        },
        { upsert: true, new: true }
      );

      await markOtherIssuedCouponsSuperseded(merchant._id, group, record?._id);
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
  const cartKey = normalizeCartKey(options?.cartKey);
  const group = cartKey ? { cartKey } : { cartHash };
  const mode = options?.mode ? String(options.mode) : cartKey ? "incremental" : "authoritative";
  const resolvedMode = mode === "authoritative" ? "authoritative" : "incremental";

  const fail = (reason, extra) => ({
    coupon: null,
    action: 'fail',
    failure: { reason: String(reason || "UNKNOWN"), ...(extra || {}) }
  });

  const totalDiscount = evaluationResult?.applied?.totalDiscount;
  if (!Number.isFinite(totalDiscount) || totalDiscount <= 0) {
    await clearCartStateForGroup(merchant._id, group);
    return { coupon: null, action: 'clear', failure: null };
  }

  const discountAmount = Number(Number(totalDiscount).toFixed(2));

  const includeProductIds = resolveIncludeProductIdsFromEvaluation(evaluationResult);
  if (!includeProductIds.length) {
    await clearCartStateForGroup(merchant._id, group);
    return { coupon: null, action: 'clear', failure: null };
  }

  // ✅ التعديل الرئيسي: نبحث عن كوبون نشط بنفس الخصم والمنتجات
  const existing = await getActiveIssuedCoupon(merchant._id, group);

  const incomingBundlesSummary = extractBundlesFromEvaluation(evaluationResult);
  // When using cartKey, we should merge if we found an existing coupon by cartKey, regardless of cartHash changes
  const shouldMerge =
    resolvedMode === "incremental" && existing && (
      cartKey ? (existing.cartKey === cartKey) : (String(existing?.cartHash || "") === String(cartHash || ""))
    );
  const mergedBundles = shouldMerge ? mergeBundlesSummary(existing?.bundlesSummary, incomingBundlesSummary) : null;
  const desiredDiscountAmount = mergedBundles?.discountAmount || discountAmount;
  const desiredIncludeProductIds =
    shouldMerge ? unionStringIds(existing?.includeProductIds, includeProductIds) : includeProductIds;
  const desiredAppliedBundleIds = mergedBundles?.appliedBundleIds || incomingBundlesSummary.map((b) => b.bundleId);
  const desiredBundlesSummary = mergedBundles?.bundlesSummary || incomingBundlesSummary;

  if (existing) {
    const existingType = String(existing?.discountType || existing?.sallaType || "").trim().toLowerCase();
    const existingAmount = Number(existing?.discountAmount || 0);

    // ✅ نتحقق إذا الكوبون الموجود له نفس الخصم الإجمالي
    if (
      existingType === "fixed" &&
      amountsMatch(existingAmount, desiredDiscountAmount) &&
      sameStringIdSet(existing?.includeProductIds, desiredIncludeProductIds)
    ) {
      existing.appliedBundleIds = desiredAppliedBundleIds;
      existing.bundlesSummary = desiredBundlesSummary;
      existing.lastSeenAt = new Date();
      await existing.save();
      await markOtherIssuedCouponsSuperseded(merchant._id, group, existing?._id);
      return { coupon: existing, action: 'reuse', failure: null, reused: true };
    }

    // ✅ إذا الخصم مختلف، نحدّث الكوبون القديم بدلاً من إنشاء واحد جديد
    // (لكن سلة لا تدعم تحديث الكوبونات، لذا سننشئ واحد جديد)
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
    usage_limit_per_user: 1,
    include_product_ids: desiredIncludeProductIds
  };

  let lastCreateError = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = buildCouponCode(merchant.merchantId, cartHash);
    const fixedPayload = { ...basePayload, code, type: "fixed", amount: desiredDiscountAmount };

    let sallaCouponId = null;
    const triedPayloads = [];
    try {
      triedPayloads.push(fixedPayload);
      const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, fixedPayload);
      sallaCouponId = createdCouponResponse?.data?.id ?? null;
    } catch (err) {
      lastCreateError = err;
      if (err instanceof ApiError && err.statusCode === 409) {
        continue;
      }

      if (err instanceof ApiError && err.statusCode === 422) {
        const floored = Math.floor(desiredDiscountAmount);
        if (Number.isFinite(floored) && floored >= 1 && floored < desiredDiscountAmount) {
          try {
            triedPayloads.push({ ...fixedPayload, amount: floored });
            const createdCouponResponse = await createCoupon(config.salla, merchantAccessToken, { ...fixedPayload, amount: floored });
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
      // ✅ نحفظ معلومات الباقات المطبقة
      const record = await CartCoupon.findOneAndUpdate(
        cartKey ? { merchantId: merchant._id, cartKey, status: "issued" } : { merchantId: merchant._id, cartHash, status: "issued" },
        {
          $set: {
            sallaCouponId: sallaCouponId ? String(sallaCouponId) : undefined,
            code,
            status: "issued",
            discountType: "fixed",
            ...(cartKey ? { cartKey } : {}),
            discountAmount: desiredDiscountAmount,
            includeProductIds: desiredIncludeProductIds,
            appliedBundleIds: desiredAppliedBundleIds,
            bundlesSummary: desiredBundlesSummary,
            expiresAt,
            issuedAt: now,
            lastSeenAt: now
          },
          $setOnInsert: { createdAt: now, cartHash },
          $unset: { redeemedAt: "", orderId: "" }
        },
        { upsert: true, new: true }
      );

      await markOtherIssuedCouponsSuperseded(merchant._id, group, record?._id);
      return { coupon: record, action: 'create', failure: null, reused: false };
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
  issueOrReuseSpecialOfferForCartVerbose,
  extractCouponCodeFromOrderPayload,
  extractOrderId,
  markCouponRedeemed,
  expireOldCoupons
};
