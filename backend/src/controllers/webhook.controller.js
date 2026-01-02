const { ApiError } = require("../utils/apiError");
const { hmacSha256Hex, timingSafeEqualHex, sha256Hex } = require("../utils/hash");
const WebhookLog = require("../models/WebhookLog");
const AuditSnapshot = require("../models/AuditSnapshot");
const Bundle = require("../models/Bundle");
const { findMerchantByMerchantId, markMerchantUninstalled, upsertInstalledMerchant } = require("../services/merchant.service");
const { evaluateBundles } = require("../services/bundle.service");
const { issueOrReuseCouponForCart, extractCouponCodeFromOrderPayload, extractOrderId, markCouponRedeemed } = require("../services/cartCoupon.service");
const { refreshAccessToken } = require("../services/sallaOAuth.service");
const { fetchVariantsSnapshotMap } = require("../services/sallaCatalog.service");
const { getOrderById } = require("../services/sallaApi.service");
const { Buffer } = require("buffer");

function extractEvent(req, payload) {
  const headerEvent = req.headers["x-salla-event"] || req.headers["x-salla-topic"] || req.headers["x-event"];
  return String(headerEvent || payload?.event || payload?.type || "").trim() || "unknown";
}

function extractMerchantId(payload) {
  const candidates = [
    payload?.merchant,
    payload?.merchant?.id,
    payload?.data?.merchant?.id,
    payload?.store?.id,
    payload?.data?.store?.id,
    payload?.store_id,
    payload?.data?.store_id
  ];
  for (const c of candidates) {
    const v = String(c || "").trim();
    if (v) return v;
  }
  return null;
}

function extractDeliveryId(req, payload) {
  const candidates = [
    req.headers["x-salla-delivery-id"],
    req.headers["x-delivery-id"],
    req.headers["x-request-id"],
    payload?.delivery_id,
    payload?.deliveryId,
    payload?.id,
    payload?.event_id,
    payload?.eventId
  ];
  for (const c of candidates) {
    const v = String(c || "").trim();
    if (v) return v;
  }
  return null;
}

function extractCartItems(payload) {
  const candidates = [
    payload?.data?.cart?.items,
    payload?.cart?.items,
    payload?.data?.items,
    payload?.items
  ];
  const items = candidates.find((c) => Array.isArray(c)) || [];

  return items
    .map((it) => {
      const rawVariantId = String(it?.variant_id || it?.variantId || it?.variant?.id || "").trim();
      const rawProductId = String(
        it?.product_id ||
          it?.productId ||
          it?.product?.id ||
          it?.product?.product_id ||
          it?.product?.productId ||
          ""
      ).trim();
      const variantId = rawVariantId || (rawProductId ? `product:${rawProductId}` : String(it?.id || "").trim());
      const quantity = Number(it?.quantity || it?.qty || it?.amount || 0);
      return { variantId, quantity };
    })
    .filter((it) => it.variantId && Number.isFinite(it.quantity) && it.quantity > 0);
}

function extractOrderDiscountAmount(payload) {
  const candidates = [
    payload?.data?.order?.discount?.amount,
    payload?.order?.discount?.amount,
    payload?.data?.order?.discount_amount,
    payload?.order?.discount_amount,
    payload?.data?.order?.totals?.discount,
    payload?.order?.totals?.discount
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractOrderProductIdsFromOrder(order) {
  const candidates = [order?.items, order?.data?.items].filter((c) => Array.isArray(c));
  const items = candidates[0] || [];
  return Array.from(
    new Set(
      items
        .map((it) => it?.product?.id ?? it?.product_id ?? it?.productId ?? it?.product?.product_id)
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    )
  );
}

function extractCouponDiscountFromOrder(order, couponCode) {
  const code = String(couponCode || "").trim();
  if (!code) return null;
  const discounts = order?.amounts?.discounts || order?.totals?.discounts || order?.discounts;
  if (!Array.isArray(discounts)) return null;
  for (const d of discounts) {
    const dCode = String(d?.code || d?.coupon || d?.coupon_code || "").trim();
    if (!dCode || dCode !== code) continue;
    const amount = Number(d?.discount ?? d?.amount ?? d?.value);
    if (Number.isFinite(amount)) return amount;
  }
  return null;
}

function orderHasCouponCode(order, couponCode) {
  const code = String(couponCode || "").trim();
  if (!code) return false;
  const discounts = order?.amounts?.discounts || order?.totals?.discounts || order?.discounts;
  if (!Array.isArray(discounts)) return false;
  return discounts.some((d) => String(d?.code || d?.coupon || d?.coupon_code || "").trim() === code);
}

async function ensureMerchantTokenFresh(config, merchant) {
  const skewMs = Math.max(0, Number(config.security.tokenRefreshSkewSeconds || 0)) * 1000;
  const expiresAtMs = merchant.tokenExpiresAt ? new Date(merchant.tokenExpiresAt).getTime() : 0;
  const shouldRefresh = !expiresAtMs || expiresAtMs <= Date.now() + skewMs;
  if (shouldRefresh) await refreshAccessToken(config.salla, merchant);
}

function createWebhookController(config) {
  async function sallaWebhook(req, res) {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const signature = String(req.headers["x-salla-signature"] || "").trim();
    const authHeader = String(req.headers.authorization || "").trim();
    const securityStrategy = String(req.headers["x-salla-security-strategy"] || "").trim().toLowerCase();
    const secret = config.salla.webhookSecret;

    if (!secret) throw new ApiError(500, "Webhook secret is not configured", { code: "SALLA_WEBHOOK_SECRET_MISSING" });

    if (signature) {
      const computed = hmacSha256Hex(secret, rawBody);
      if (!timingSafeEqualHex(signature, computed)) {
        throw new ApiError(401, "Invalid webhook signature", { code: "SALLA_WEBHOOK_SIGNATURE_INVALID" });
      }
    } else if (securityStrategy === "token") {
      if (!authHeader) throw new ApiError(401, "Missing webhook authorization", { code: "SALLA_WEBHOOK_AUTH_MISSING" });
      const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader;
      if (token !== secret) {
        throw new ApiError(401, "Invalid webhook authorization", { code: "SALLA_WEBHOOK_AUTH_INVALID" });
      }
    } else {
      throw new ApiError(401, "Missing webhook signature", { code: "SALLA_WEBHOOK_SIGNATURE_MISSING" });
    }

    const bodyText = rawBody.toString("utf8") || "{}";
    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      throw new ApiError(400, "Invalid JSON payload", { code: "INVALID_JSON" });
    }

    const event = extractEvent(req, payload);
    const payloadHash = sha256Hex(bodyText);
    const merchantIdString = extractMerchantId(payload);
    const deliveryId = extractDeliveryId(req, payload);

    const alreadyProcessed = await WebhookLog.findOne(
      deliveryId ? { event, deliveryId, status: "processed" } : { event, payloadHash, status: "processed" }
    ).lean();
    if (alreadyProcessed) return res.status(200).json({ ok: true });

    const logBase = {
      event,
      deliveryId: deliveryId || undefined,
      payloadHash,
      status: "received",
      createdAt: new Date()
    };

    let merchant = null;
    if (merchantIdString) {
      merchant = await findMerchantByMerchantId(merchantIdString);
      if (merchant) logBase.merchantId = merchant._id;
    }

    await WebhookLog.create(logBase);

    try {
      if (event === "app.store.authorize") {
        if (!merchantIdString) throw new ApiError(400, "Missing merchant id", { code: "MERCHANT_ID_MISSING" });

        const accessToken = String(payload?.data?.access_token || "").trim();
        const refreshToken = String(payload?.data?.refresh_token || "").trim();
        const expires = Number(payload?.data?.expires || 0);

        if (!accessToken) throw new ApiError(400, "Missing access_token", { code: "ACCESS_TOKEN_MISSING" });
        if (!refreshToken) throw new ApiError(400, "Missing refresh_token", { code: "REFRESH_TOKEN_MISSING" });
        if (!Number.isFinite(expires) || expires <= 0) throw new ApiError(400, "Missing expires", { code: "TOKEN_EXPIRES_MISSING" });

        const tokenExpiresAt = new Date(expires * 1000);
        merchant = await upsertInstalledMerchant({
          merchantId: merchantIdString,
          accessToken,
          refreshToken,
          tokenExpiresAt
        });
      }

      if (event === "app.installed" && merchant && merchant.appStatus !== "installed") {
        merchant.appStatus = "installed";
        await merchant.save();
      }

      if (event === "app.uninstalled" || event === "app.deleted") {
        if (merchantIdString) await markMerchantUninstalled(merchantIdString);
      }

      if (event === "cart.updated" && merchant && merchant.appStatus === "installed") {
        await ensureMerchantTokenFresh(config, merchant);
        const items = extractCartItems(payload);
        if (!items.length) {
          return res.status(200).json({ ok: true });
        }

        const activeTriggerProductIds = await Bundle.distinct("triggerProductId", {
          storeId: String(merchant.merchantId || "").trim(),
          status: "active",
          deletedAt: null,
          triggerProductId: { $nin: [null, ""] }
        });
        if (!activeTriggerProductIds.length) {
          return res.status(200).json({ ok: true });
        }

        const variantIds = Array.from(new Set(items.map((i) => String(i.variantId)).filter(Boolean)));
        let snapshots;
        try {
          snapshots = await fetchVariantsSnapshotMap(config.salla, merchant.accessToken, variantIds, { concurrency: 5, maxAttempts: 3 });
        } catch (err) {
          await AuditSnapshot.create({
            merchantId: merchant._id,
            type: "cart.updated",
            event,
            deliveryId: deliveryId || undefined,
            payloadHash,
            severity: "critical",
            snapshot: {
              reason: "salla_api_failure",
              error: { message: err?.message, code: err?.code, statusCode: err?.statusCode },
              cartItems: items
            }
          }).catch(() => undefined);
          throw new ApiError(503, "Failed to fetch live variants from Salla. Bundles feature disabled.", {
            code: "SALLA_VARIANTS_FETCH_FAILED_FEATURE_DISABLED"
          });
        }

        const cartProductIds = new Set();
        for (const it of items) {
          const snap = snapshots?.get ? snapshots.get(String(it.variantId)) : null;
          const pid = String(snap?.productId || "").trim();
          if (pid) cartProductIds.add(pid);
        }
        const relevant = activeTriggerProductIds.some((pid) => cartProductIds.has(String(pid || "").trim()));
        if (!relevant) {
          return res.status(200).json({ ok: true });
        }

        const evaluation = await evaluateBundles(merchant, items, snapshots);
        const coupon = await issueOrReuseCouponForCart(config, merchant, merchant.accessToken, items, evaluation, { ttlHours: 24 });

        const hasDiscount = Boolean(coupon && Number(evaluation?.applied?.totalDiscount || 0) > 0);
        if (hasDiscount) {
          await AuditSnapshot.create({
            merchantId: merchant._id,
            type: "cart.updated",
            event,
            deliveryId: deliveryId || undefined,
            payloadHash,
            cartSnapshotHash: evaluation?.cartSnapshotHash || undefined,
            couponCode: coupon.code,
            severity: "info",
            snapshot: {
              cartItems: evaluation?.cart || items,
              applied: evaluation?.applied,
              coupon: { code: coupon.code, id: coupon.sallaCouponId || null, status: coupon.status },
              variants: Array.from(snapshots.values())
            }
          }).catch(() => undefined);
        }
      }

      if (event === "order.created" && merchant && merchant.appStatus === "installed") {
        await ensureMerchantTokenFresh(config, merchant);
        const couponCode = extractCouponCodeFromOrderPayload(payload);
        const orderId = extractOrderId(payload);
        const redeemed = await markCouponRedeemed(merchant._id, couponCode, orderId);

        let orderDetails = null;
        if (orderId) {
          try {
            orderDetails = await getOrderById(config.salla, merchant.accessToken, orderId);
          } catch (err) {
            await AuditSnapshot.create({
              merchantId: merchant._id,
              type: "order.created",
              event,
              deliveryId: deliveryId || undefined,
              payloadHash,
              orderId: orderId || undefined,
              couponCode: couponCode || undefined,
              severity: "critical",
              snapshot: {
                reason: "salla_api_failure",
                error: { message: err?.message, code: err?.code, statusCode: err?.statusCode }
              }
            }).catch(() => undefined);
          }
        }

        const order = orderDetails?.data || null;
        const couponPresentInOrder = order ? orderHasCouponCode(order, couponCode) : null;
        const orderCouponDiscount = order ? extractCouponDiscountFromOrder(order, couponCode) : null;
        const orderProductIds = order ? extractOrderProductIdsFromOrder(order) : [];

        const actualDiscount = extractOrderDiscountAmount(payload) ?? orderCouponDiscount;
        const expectedDiscount = redeemed?.discountAmount != null ? Number(redeemed.discountAmount) : null;
        if (expectedDiscount != null && actualDiscount != null) {
          const delta = Math.abs(expectedDiscount - actualDiscount);
          if (delta > 0.01) {
            await AuditSnapshot.create({
              merchantId: merchant._id,
              type: "order.created",
              event,
              deliveryId: deliveryId || undefined,
              payloadHash,
              orderId: orderId || undefined,
              couponCode: couponCode || undefined,
              severity: "critical",
              snapshot: {
                mismatch: true,
                expectedDiscount,
                actualDiscount,
                delta,
                couponPresentInOrder,
                orderProductIds,
                couponRecord: redeemed ? { code: redeemed.code, cartHash: redeemed.cartHash, includeProductIds: redeemed.includeProductIds } : null
              }
            }).catch(() => undefined);
          }
        }

        if (redeemed && order) {
          const expectedProductIds = Array.isArray(redeemed?.includeProductIds) ? redeemed.includeProductIds.map((v) => String(v || "").trim()).filter(Boolean) : [];
          const overlap = expectedProductIds.filter((pid) => orderProductIds.includes(pid));
          if (couponPresentInOrder === false || (expectedProductIds.length && overlap.length === 0)) {
            await AuditSnapshot.create({
              merchantId: merchant._id,
              type: "order.created",
              event,
              deliveryId: deliveryId || undefined,
              payloadHash,
              orderId: orderId || undefined,
              couponCode: couponCode || undefined,
              severity: "critical",
              snapshot: {
                reason: "coupon_mismatch",
                couponPresentInOrder,
                expectedProductIds,
                orderProductIds,
                overlapProductIds: overlap
              }
            }).catch(() => undefined);
          }
        }
      }

      await WebhookLog.create({
        merchantId: merchant?._id,
        event,
        deliveryId: deliveryId || undefined,
        payloadHash,
        status: "processed",
        createdAt: new Date()
      });

      return res.status(200).json({ ok: true });
    } catch (err) {
      await WebhookLog.create({
        merchantId: merchant?._id,
        event,
        deliveryId: deliveryId || undefined,
        payloadHash,
        status: "failed",
        errorCode: err?.code || err?.name || "WEBHOOK_FAILED",
        createdAt: new Date()
      }).catch(() => undefined);
      throw err;
    }
  }

  return { sallaWebhook };
}

module.exports = {
  createWebhookController
};
