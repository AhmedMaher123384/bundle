const express = require("express");
const Joi = require("joi");
const { createBundleRouter } = require("./bundle.routes");
const { merchantAuth } = require("../middlewares/merchantAuth.middleware");
const { createOAuthRouter } = require("./oauth.routes");
const { validate } = require("../middlewares/validate.middleware");
const { listProducts, getProductById, getProductVariant } = require("../services/sallaApi.service");
const { refreshAccessToken } = require("../services/sallaOAuth.service");
const { ApiError } = require("../utils/apiError");
const { fetchVariantsSnapshotReport } = require("../services/sallaCatalog.service");
const { findMerchantByMerchantId } = require("../services/merchant.service");
const bundleService = require("../services/bundle.service");
const { issueOrReuseCouponForCartVerbose } = require("../services/cartCoupon.service");
const { hmacSha256, sha256Hex } = require("../utils/hash");
const { Buffer } = require("buffer");
const { readSnippetCss } = require("../storefront/snippet/styles");
const mountBundle = require("../storefront/snippet/features/bundle/bundle.mount");
const mountAnnouncementBanner = require("../storefront/snippet/features/announcementBanner/banner.mount");
const { createAnnouncementBannerRouter } = require("./announcementBanner.routes");
const announcementBannerService = require("../services/announcementBanner.service");

function createApiRouter(config) {
  const router = express.Router();

  function base64UrlEncodeUtf8(input) {
    return Buffer.from(String(input || ""), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function base64UrlDecodeUtf8(input) {
    const raw = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = raw.length % 4 ? "=".repeat(4 - (raw.length % 4)) : "";
    return Buffer.from(`${raw}${pad}`, "base64").toString("utf8");
  }

  function timingSafeEqualString(a, b) {
    const aBuf = Buffer.from(String(a || ""), "utf8");
    const bBuf = Buffer.from(String(b || ""), "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return require("crypto").timingSafeEqual(aBuf, bBuf);
  }

  function buildCanonicalQueryString(query, delimiter) {
    const keys = Object.keys(query || {})
      .filter((k) => !["signature", "hmac"].includes(String(k || "").toLowerCase()))
      .sort((a, b) => a.localeCompare(b));

    const parts = [];
    for (const key of keys) {
      const raw = query[key];
      const value = Array.isArray(raw) ? raw.map((v) => String(v)).join(",") : String(raw);
      parts.push(`${key}=${value}`);
    }
    return parts.join(delimiter);
  }

  function stableStringify(value) {
    const t = typeof value;
    if (value == null || t === "number" || t === "boolean" || t === "string") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
    if (t !== "object") return JSON.stringify(String(value));
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }

  function resolveBaseVariantIdFromBundle(bundle) {
    const cover = String(bundle?.presentation?.coverVariantId || "").trim();
    const componentVariantIds = new Set(
      (Array.isArray(bundle?.components) ? bundle.components : []).map((c) => String(c?.variantId || "").trim()).filter(Boolean)
    );
    if (cover && componentVariantIds.has(cover)) return cover;
    const first = (Array.isArray(bundle?.components) ? bundle.components : []).map((c) => String(c?.variantId || "").trim()).find(Boolean);
    return first || null;
  }

  function uniqStrings(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).map((v) => String(v || "").trim()).filter(Boolean)));
  }

  function sortBundlesNewestFirst(bundles) {
    return (Array.isArray(bundles) ? bundles : []).slice().sort((a, b) => {
      const at = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bt = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (bt !== at) return bt - at;
      return String(b?._id || "").localeCompare(String(a?._id || ""));
    });
  }

  async function loadActiveBundlesForTriggerProduct(merchant, merchantAccessToken, triggerProductId) {
    const storeId = String(merchant?.merchantId || "").trim();
    const trigger = String(triggerProductId || "").trim();
    if (!storeId || !trigger) return { bundles: [], coverReport: { snapshots: new Map(), missing: [] } };

    const activeBundles = await bundleService.listBundles(storeId, { status: "active" });
    const direct = activeBundles.filter((b) => String(b?.triggerProductId || "").trim() === trigger);

    const coverVariantIdByBundleId = new Map();
    for (const b of activeBundles) {
      const coverVariantId = String(b?.presentation?.coverVariantId || "").trim() || resolveBaseVariantIdFromBundle(b);
      if (!coverVariantId) continue;
      coverVariantIdByBundleId.set(String(b?._id), String(coverVariantId));
    }
    const coverVariantIds = uniqStrings(Array.from(coverVariantIdByBundleId.values())).filter((v) => !String(v).startsWith("product:"));
    const coverReport = coverVariantIds.length
      ? await fetchVariantsSnapshotReport(config.salla, merchantAccessToken, coverVariantIds, { concurrency: 5, maxAttempts: 3 })
      : { snapshots: new Map(), missing: [] };

    const byCover = activeBundles.filter((b) => {
      const coverVariantId = coverVariantIdByBundleId.get(String(b?._id));
      if (!coverVariantId) return false;
      if (String(coverVariantId).startsWith("product:")) {
        const pid = String(coverVariantId).slice("product:".length).trim();
        return Boolean(pid && pid === trigger);
      }
      const snap = coverReport.snapshots.get(String(coverVariantId));
      const pid = String(snap?.productId || "").trim();
      return Boolean(pid && pid === trigger);
    });

    const byId = new Map();
    for (const b of [...direct, ...byCover]) byId.set(String(b?._id), b);
    return { bundles: sortBundlesNewestFirst(Array.from(byId.values())), coverReport };
  }

  function parseProductRefVariantId(variantId) {
    const s = String(variantId || "").trim();
    if (!s.startsWith("product:")) return null;
    const pid = s.slice("product:".length).trim();
    return pid ? pid : null;
  }

  async function mapWithConcurrency(items, concurrency, mapper) {
    const list = Array.isArray(items) ? items : [];
    const limit = Math.max(1, Math.floor(Number(concurrency || 1)));
    const results = new Array(list.length);
    let idx = 0;
    async function worker() {
      while (idx < list.length) {
        const i = idx;
        idx += 1;
        results[i] = await mapper(list[i], i);
      }
    }
    const runners = Array.from({ length: Math.min(limit, list.length) }, () => worker());
    await Promise.allSettled(runners);
    return results;
  }

  async function fetchSingleVariantSnapshotsByProductId(sallaConfig, accessToken, productIds) {
    const uniqProductIds = uniqStrings(productIds);
    const variantIdByProductId = new Map();

    await mapWithConcurrency(uniqProductIds, 4, async (productId) => {
      try {
        const productResp = await getProductById(sallaConfig, accessToken, productId, {});
        const variantIds = extractVariantIdsFromProductPayload(productResp);
        const uniqVariantIds = uniqStrings(variantIds);
        if (uniqVariantIds.length === 1) variantIdByProductId.set(productId, uniqVariantIds[0]);
      } catch (err) {
        void err;
      }
    });

    const variantIds = uniqStrings(Array.from(variantIdByProductId.values()));
    const report = variantIds.length
      ? await fetchVariantsSnapshotReport(sallaConfig, accessToken, variantIds, { concurrency: 6, maxAttempts: 3 })
      : { snapshots: new Map(), missing: [] };

    const snapshotByProductId = new Map();
    for (const [productId, variantId] of variantIdByProductId.entries()) {
      const snap = report.snapshots.get(String(variantId));
      if (!snap || snap.isActive !== true) continue;
      snapshotByProductId.set(String(productId), snap);
    }

    return { snapshotByProductId, report };
  }

  function normalizeComponentsForStorefront(bundle, variantSnapshots, ctx) {
    const baseRefVariantId = resolveBaseVariantIdFromBundle(bundle);
    const components = Array.isArray(bundle?.components) ? bundle.components : [];
    return components
      .map((c) => {
        const variantId = String(c?.variantId || "").trim();
        const quantity = Math.max(1, Math.floor(Number(c?.quantity || 1)));
        if (!variantId) return null;
        const isBase = baseRefVariantId ? variantId === baseRefVariantId : false;

        const isProductRef = variantId.startsWith("product:");
        const refProductId = isProductRef ? String(variantId.slice("product:".length) || "").trim() : "";

        let snap = variantSnapshots?.get ? variantSnapshots.get(variantId) : null;
        if (isProductRef) {
          const triggerProductId = String(ctx?.triggerProductId || "").trim();
          const triggerVariantId = String(ctx?.triggerVariantId || "").trim();
          if (isBase && triggerVariantId && refProductId && triggerProductId && refProductId === triggerProductId) {
            const s = variantSnapshots?.get ? variantSnapshots.get(triggerVariantId) : null;
            if (s && String(s?.productId || "").trim() === triggerProductId) {
              snap = s;
            }
          } else if (refProductId) {
            const resolved = ctx?.singleVariantSnapshotByProductId?.get ? ctx.singleVariantSnapshotByProductId.get(refProductId) : null;
            if (resolved) {
              snap = resolved;
            }
          }
        }

        const resolvedVariantId = String(snap?.variantId || "").trim();
        const finalVariantId = isProductRef && resolvedVariantId ? resolvedVariantId : variantId;
        const productId = String(snap?.productId || "").trim() || (isProductRef ? (refProductId || null) : null);
        const imageUrl = snap?.imageUrl ? String(snap.imageUrl).trim() || null : null;
        const price = snap?.price != null ? Number(snap.price) : null;
        const name = snap?.name != null ? String(snap.name).trim() || null : null;
        const attributes =
          snap?.attributes && typeof snap.attributes === "object" && !Array.isArray(snap.attributes) ? snap.attributes : null;
        return {
          variantId: finalVariantId,
          productId,
          quantity,
          group: String(c?.group || "").trim() || null,
          isBase,
          imageUrl,
          price: Number.isFinite(price) ? price : null,
          name,
          attributes
        };
      })
      .filter(Boolean);
  }

  function buildBundleItemsFromComponents(components) {
    return (Array.isArray(components) ? components : [])
      .slice()
      .sort((a, b) => Number(Boolean(b?.isBase)) - Number(Boolean(a?.isBase)))
      .map((c) => ({
        variantId: String(c?.variantId || "").trim() || null,
        productId: String(c?.productId || "").trim() || null,
        quantity: Math.max(1, Math.floor(Number(c?.quantity || 1))),
        group: String(c?.group || "").trim() || null,
        isBase: Boolean(c?.isBase),
        imageUrl: c?.imageUrl ? String(c.imageUrl).trim() || null : null
      }))
      .filter((it) => Boolean(it.variantId || it.productId));
  }

  function calcDiscountAmount(offer, subtotal) {
    const st = Number(subtotal);
    if (!Number.isFinite(st) || st <= 0) return 0;
    const type = String(offer?.type || "").trim();
    const value = Number(offer?.value ?? 0);
    if (type === "percentage") {
      const pct = Math.max(0, Math.min(100, value));
      return (st * pct) / 100;
    }
    if (type === "fixed") {
      const amt = Math.max(0, value);
      return Math.min(st, amt);
    }
    if (type === "bundle_price") {
      const price = Math.max(0, value);
      return Math.max(0, Math.min(st, st - price));
    }
    return 0;
  }

  function computePricing(bundle, components) {
    const offer = bundle?.rules || {};
    const missingPriceVariantIds = [];
    let baseMissing = false;
    const baseSubtotal = (Array.isArray(components) ? components : []).reduce((acc, c) => {
      const unit = c?.price == null ? null : Number(c.price);
      const qty = Math.max(1, Math.floor(Number(c?.quantity || 1)));
      if (unit == null || !Number.isFinite(unit) || unit < 0) {
        missingPriceVariantIds.push(String(c?.variantId || "").trim());
        baseMissing = true;
        return acc;
      }
      return acc + unit * qty;
    }, 0);
    const baseDiscount = baseMissing ? null : calcDiscountAmount(offer, baseSubtotal);
    const base = baseMissing
      ? { originalTotal: null, discountAmount: null, finalTotal: null }
      : {
          originalTotal: Number(baseSubtotal.toFixed(2)),
          discountAmount: Number(Math.max(0, baseDiscount).toFixed(2)),
          finalTotal: Number(Math.max(0, baseSubtotal - baseDiscount).toFixed(2))
        };

    const baseVariantId =
      (Array.isArray(components) ? components : []).find((c) => c && c.isBase === true)?.variantId ??
      resolveBaseVariantIdFromBundle(bundle);
    const tiers = (Array.isArray(offer?.tiers) ? offer.tiers : [])
      .map((t) => ({
        minQty: Math.max(1, Math.floor(Number(t?.minQty ?? 1))),
        type: String(t?.type || "").trim(),
        value: Number(t?.value ?? 0)
      }))
      .filter((t) => Number.isFinite(t.value) && t.value >= 0 && t.type)
      .sort((a, b) => a.minQty - b.minQty)
      .map((tier) => {
        const missingTier = [];
        let tierMissing = false;
        const tierSubtotal = (Array.isArray(components) ? components : []).reduce((acc, c) => {
          const unit = c?.price == null ? null : Number(c.price);
          const qtyRaw = Math.max(1, Math.floor(Number(c?.quantity || 1)));
          const qty = baseVariantId && String(c?.variantId) === String(baseVariantId) ? tier.minQty : qtyRaw;
          if (unit == null || !Number.isFinite(unit) || unit < 0) {
            missingTier.push(String(c?.variantId || "").trim());
            tierMissing = true;
            return acc;
          }
          return acc + unit * qty;
        }, 0);
        const discount = tierMissing ? null : calcDiscountAmount(tier, tierSubtotal);
        return {
          minQty: tier.minQty,
          type: tier.type,
          value: tier.value,
          originalTotal: tierMissing ? null : Number(tierSubtotal.toFixed(2)),
          discountAmount: tierMissing ? null : Number(Math.max(0, discount).toFixed(2)),
          finalTotal: tierMissing ? null : Number(Math.max(0, tierSubtotal - discount).toFixed(2)),
          missingPriceVariantIds: Array.from(new Set(missingTier)).filter(Boolean)
        };
      });

    return { base, tiers, missingPriceVariantIds: Array.from(new Set(missingPriceVariantIds)).filter(Boolean) };
  }

  function computeDisplay(bundle, offer, pricing) {
    const name = String(bundle?.name || "").trim() || "Bundle";
    const type = String(offer?.type || "").trim();
    const value = Number(offer?.value ?? 0);
    const bestTier = Array.isArray(pricing?.tiers) && pricing.tiers.length ? pricing.tiers[pricing.tiers.length - 1] : null;
    const badge = (() => {
      if (bestTier && bestTier.type === "percentage") {
        const v = Number(bestTier.value);
        return Number.isFinite(v) && v > 0 ? `${v}%` : null;
      }
      if (bestTier && bestTier.type === "fixed") {
        const v = Number(bestTier.value);
        return Number.isFinite(v) && v > 0 ? `${v}` : null;
      }
      if (type === "percentage") {
        return Number.isFinite(value) && value > 0 ? `${value}%` : null;
      }
      if (type === "fixed") {
        return Number.isFinite(value) && value > 0 ? `${value}` : null;
      }
      return null;
    })();

    const presentation = bundle?.presentation || {};
    const rawKind = String(bundle?.kind || "").trim();
    const inferredKind = (() => {
      if (rawKind === "quantity_discount" || rawKind === "products_discount" || rawKind === "products_no_discount" || rawKind === "post_add_upsell") return rawKind;
      if (Array.isArray(bundle?.rules?.tiers) && bundle.rules.tiers.length) return "quantity_discount";
      const v = Number(bundle?.rules?.value ?? 0);
      if (Number.isFinite(v) && v <= 0) return "products_no_discount";
      return "products_discount";
    })();

    const rawTitle = String(presentation?.title || "").trim();
    const rawSubtitle = String(presentation?.subtitle || "").trim();
    const rawLabel = String(presentation?.label || "").trim();
    const rawLabelSub = String(presentation?.labelSub || "").trim();
    const rawCta = String(presentation?.cta || "").trim();
    const rawBannerColor = String(presentation?.bannerColor || "").trim();
    const rawBadgeColor = String(presentation?.badgeColor || "").trim();
    const rawTextColor = String(presentation?.textColor || "").trim();
    const rawCtaBgColor = String(presentation?.ctaBgColor || "").trim();
    const rawCtaTextColor = String(presentation?.ctaTextColor || "").trim();
    const rawLabelBgColor = String(presentation?.labelBgColor || "").trim();
    const rawLabelTextColor = String(presentation?.labelTextColor || "").trim();

    const defaultBannerColor = type === "percentage" ? "#16a34a" : type === "bundle_price" ? "#7c3aed" : "#0ea5e9";
    const bannerColor = rawBannerColor || defaultBannerColor;
    const badgeColor = rawBadgeColor || bannerColor;
    const defaultTitle =
      inferredKind === "quantity_discount"
        ? "اشترِ أكثر ووفّر أكثر"
        : inferredKind === "post_add_upsell"
          ? "ناس كتير اشتروا كمان"
          : name;
    const canShowSave = inferredKind !== "products_no_discount" && badge;
    const title = rawTitle || (canShowSave ? `${defaultTitle} - وفر ${badge}` : defaultTitle);
    const subtitle = rawSubtitle || null;
    const label = rawLabel || null;
    const labelSub = rawLabelSub || null;
    const cta = rawCta || (inferredKind === "post_add_upsell" ? "أضف مع السلة" : "أضف الباقة");
    const textColor = rawTextColor || "#ffffff";
    const ctaBgColor = rawCtaBgColor || null;
    const ctaTextColor = rawCtaTextColor || null;
    const labelBgColor = rawLabelBgColor || null;
    const labelTextColor = rawLabelTextColor || null;

    const showItems = typeof presentation?.showItems === "boolean" ? presentation.showItems : true;
    const showPrice = typeof presentation?.showPrice === "boolean" ? presentation.showPrice : true;
    const showTiers = typeof presentation?.showTiers === "boolean" ? presentation.showTiers : true;

    return {
      title,
      subtitle,
      label,
      labelSub,
      cta,
      bannerColor,
      badgeColor,
      textColor,
      ctaBgColor,
      ctaTextColor,
      labelBgColor,
      labelTextColor,
      showItems,
      showPrice,
      showTiers
    };
  }

  function serializeBundleForStorefront(bundle, variantSnapshots, triggerProductId, ctx) {
    const components = normalizeComponentsForStorefront(bundle, variantSnapshots, ctx);
    const rules = bundle?.rules || {};
    const rawKind = String(bundle?.kind || "").trim();
    const kind =
      rawKind === "quantity_discount" || rawKind === "products_discount" || rawKind === "products_no_discount" || rawKind === "post_add_upsell"
        ? rawKind
        : Array.isArray(rules?.tiers) && rules.tiers.length
          ? "quantity_discount"
          : Number(rules?.value ?? 0) <= 0
            ? "products_no_discount"
            : "products_discount";
    const offer = {
      type: String(rules?.type || "").trim() || null,
      value: Number(rules?.value ?? 0),
      tiers: Array.isArray(rules?.tiers) ? rules.tiers : [],
      eligibility: rules?.eligibility || null,
      limits: rules?.limits || null
    };
    const pricing = computePricing(bundle, components);
    const display = computeDisplay(bundle, offer, pricing);
    const settings = bundle?.settings && typeof bundle.settings === "object" ? bundle.settings : {};
    return {
      id: String(bundle?._id),
      kind,
      settings: {
        selectionRequired: settings?.selectionRequired === true,
        variantRequired: settings?.variantRequired !== false,
        variantPickerVisible: settings?.variantPickerVisible !== false,
        defaultSelectedProductIds: Array.isArray(settings?.defaultSelectedProductIds)
          ? settings.defaultSelectedProductIds.map((x) => String(x || "").trim()).filter(Boolean)
          : [],
        productOrder: Array.isArray(settings?.productOrder) ? settings.productOrder.map((x) => String(x || "").trim()).filter(Boolean) : []
      },
      triggerProductId: String(triggerProductId || bundle?.triggerProductId || "").trim(),
      title: display.title,
      subtitle: display.subtitle,
      label: display.label,
      labelSub: display.labelSub,
      cta: display.cta,
      bannerColor: display.bannerColor,
      badgeColor: display.badgeColor,
      textColor: display.textColor,
      ctaBgColor: display.ctaBgColor,
      ctaTextColor: display.ctaTextColor,
      labelBgColor: display.labelBgColor,
      labelTextColor: display.labelTextColor,
      showItems: display.showItems,
      showPrice: display.showPrice,
      showTiers: display.showTiers,
      bundleItems: buildBundleItemsFromComponents(components),
      components: (Array.isArray(components) ? components : [])
        .slice()
        .sort((a, b) => Number(Boolean(b?.isBase)) - Number(Boolean(a?.isBase)))
        .map((c) => ({
          variantId: String(c.variantId),
          productId: String(c.productId || "").trim() || null,
          quantity: c.quantity,
          group: String(c?.group || "").trim() || null,
          isBase: Boolean(c.isBase),
          imageUrl: c.imageUrl ? String(c.imageUrl).trim() || null : null,
          price: c?.price != null && Number.isFinite(Number(c.price)) ? Number(c.price) : null,
          name: c?.name != null ? String(c.name).trim() || null : null,
          attributes: c?.attributes && typeof c.attributes === "object" && !Array.isArray(c.attributes) ? c.attributes : null
        })),
      offer,
      pricing
    };
  }

  function ensureValidProxySignature(query) {
    const secret = config?.salla?.clientSecret || config?.salla?.webhookSecret;
    if (!secret) throw new ApiError(500, "Proxy secret is not configured", { code: "PROXY_SECRET_MISSING" });

    const signature = String(query?.signature ?? query?.hmac ?? "").trim();
    if (!signature) throw new ApiError(401, "Missing proxy signature", { code: "PROXY_SIGNATURE_MISSING" });

    const canonicalAmp = buildCanonicalQueryString(query, "&");
    const canonicalPlain = buildCanonicalQueryString(query, "");

    const candidates = [
      hmacSha256(secret, canonicalAmp, "hex"),
      hmacSha256(secret, canonicalPlain, "hex"),
      hmacSha256(secret, canonicalAmp, "base64"),
      hmacSha256(secret, canonicalPlain, "base64")
    ];

    const ok = candidates.some((cand) => timingSafeEqualString(signature, cand));
    if (!ok) throw new ApiError(401, "Invalid proxy signature", { code: "PROXY_SIGNATURE_INVALID" });
  }

  function issueStorefrontToken(merchantId) {
    const secret = config?.salla?.clientSecret || config?.salla?.webhookSecret;
    if (!secret) throw new ApiError(500, "Proxy secret is not configured", { code: "PROXY_SECRET_MISSING" });
    const payload = JSON.stringify({
      merchantId: String(merchantId || "").trim(),
      iat: Date.now(),
      nonce: sha256Hex(`${Date.now()}:${Math.random()}`).slice(0, 12)
    });
    const payloadB64 = base64UrlEncodeUtf8(payload);
    const sig = hmacSha256(secret, payloadB64, "hex");
    return `${payloadB64}.${sig}`;
  }

  function ensureValidStorefrontToken(token, expectedMerchantId) {
    const secret = config?.salla?.clientSecret || config?.salla?.webhookSecret;
    if (!secret) throw new ApiError(500, "Proxy secret is not configured", { code: "PROXY_SECRET_MISSING" });

    const raw = String(token || "").trim();
    const [payloadB64, sig] = raw.split(".");
    if (!payloadB64 || !sig) throw new ApiError(401, "Invalid proxy signature", { code: "PROXY_SIGNATURE_INVALID" });

    const computed = hmacSha256(secret, String(payloadB64), "hex");
    if (!timingSafeEqualString(String(sig), String(computed))) {
      throw new ApiError(401, "Invalid proxy signature", { code: "PROXY_SIGNATURE_INVALID" });
    }

    let payload = null;
    try {
      payload = JSON.parse(base64UrlDecodeUtf8(payloadB64));
    } catch {
      throw new ApiError(401, "Invalid proxy signature", { code: "PROXY_SIGNATURE_INVALID" });
    }

    const merchantId = String(payload?.merchantId || "").trim();
    const iat = Number(payload?.iat || 0);
    if (!merchantId || !Number.isFinite(iat) || iat <= 0) {
      throw new ApiError(401, "Invalid proxy signature", { code: "PROXY_SIGNATURE_INVALID" });
    }

    const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
    if (iat < Date.now() - maxAgeMs) throw new ApiError(401, "Invalid proxy signature", { code: "PROXY_SIGNATURE_INVALID" });

    const expected = String(expectedMerchantId || "").trim();
    if (expected && merchantId !== expected) throw new ApiError(401, "Invalid proxy signature", { code: "PROXY_SIGNATURE_INVALID" });
  }

  function ensureValidProxyAuth(query, expectedMerchantId) {
    const token = String(query?.token || "").trim();
    if (token) return ensureValidStorefrontToken(token, expectedMerchantId);
    return ensureValidProxySignature(query);
  }

  async function ensureMerchantTokenFresh(merchant) {
    const skewMs = Math.max(0, Number(config.security.tokenRefreshSkewSeconds || 0)) * 1000;
    const expiresAtMs = merchant.tokenExpiresAt ? new Date(merchant.tokenExpiresAt).getTime() : 0;
    const shouldRefresh = !expiresAtMs || expiresAtMs <= Date.now() + skewMs;
    if (shouldRefresh) await refreshAccessToken(config.salla, merchant);
  }

  const storefrontSnippetQuerySchema = Joi.object({
    merchantId: Joi.string().trim().min(1).max(80).required()
  }).unknown(true);

  router.get("/storefront/snippet.js", async (req, res, next) => {
    try {
      const { error, value } = storefrontSnippetQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: true });
      if (error) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      const merchantId = String(value.merchantId);
      const merchant = await findMerchantByMerchantId(merchantId);
      if (!merchant) throw new ApiError(404, "Merchant not found", { code: "MERCHANT_NOT_FOUND" });
      if (merchant.appStatus !== "installed") throw new ApiError(403, "Merchant is not active", { code: "MERCHANT_INACTIVE" });

      const token = issueStorefrontToken(merchantId);

      res.type("js");
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");
      const { cssBase, cssPickers, cssTraditional } = readSnippetCss();
      const context = { parts: [], merchantId, token, cssBase, cssPickers, cssTraditional };
      mountBundle(context);
      mountAnnouncementBanner(context);
      const js = context.parts.join("");
      res.setHeader("X-BundleApp-Snippet-Path", "/api/storefront/snippet.js");
      res.setHeader("X-BundleApp-Snippet-Sha256", sha256Hex(js));
      res.setHeader("X-BundleApp-Snippet-Bytes", String(Buffer.byteLength(js, "utf8")));
      return res.send(js);
    } catch (err) {
      return next(err);
    }
  });

  router.use("/oauth/salla", createOAuthRouter(config));
  router.use("/bundles", merchantAuth(config), createBundleRouter(config));
  router.use("/announcement-banners", merchantAuth(config), createAnnouncementBannerRouter(config));

  const proxyAnnouncementBannerQuerySchema = Joi.object({
    merchantId: Joi.string().trim().min(1).max(80).required(),
    page: Joi.string().valid("all", "cart").default("all"),
    token: Joi.string().trim().min(10),
    signature: Joi.string().trim().min(8),
    hmac: Joi.string().trim().min(8)
  })
    .or("signature", "hmac", "token")
    .unknown(true);

  router.get("/proxy/announcement-banner", async (req, res, next) => {
    try {
      const { error, value } = proxyAnnouncementBannerQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: false });
      if (error) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      ensureValidProxyAuth(value, value.merchantId);

      const merchant = await findMerchantByMerchantId(String(value.merchantId));
      if (!merchant) throw new ApiError(404, "Merchant not found", { code: "MERCHANT_NOT_FOUND" });
      if (merchant.appStatus !== "installed") throw new ApiError(403, "Merchant is not active", { code: "MERCHANT_INACTIVE" });

      const banner = await announcementBannerService.getActiveAnnouncementBannerForStore(String(value.merchantId), { page: value.page });
      return res.json({
        ok: true,
        merchantId: String(value.merchantId),
        page: String(value.page || "all"),
        banner: announcementBannerService.serializeAnnouncementBannerForStorefront(banner)
      });
    } catch (err) {
      return next(err);
    }
  });

  const proxyProductBundlesQuerySchema = Joi.object({
    merchantId: Joi.string().trim().min(1).max(80).required(),
    variantId: Joi.string().trim().min(1).max(120).required(),
    token: Joi.string().trim().min(10),
    signature: Joi.string().trim().min(8),
    hmac: Joi.string().trim().min(8)
  })
    .or("signature", "hmac", "token")
    .unknown(true);

  router.get("/proxy/bundles/product", async (req, res, next) => {
    try {
      const { error, value } = proxyProductBundlesQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: false });
      if (error) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      ensureValidProxyAuth(value, value.merchantId);

      const merchant = await findMerchantByMerchantId(String(value.merchantId));
      if (!merchant) throw new ApiError(404, "Merchant not found", { code: "MERCHANT_NOT_FOUND" });
      if (merchant.appStatus !== "installed") throw new ApiError(403, "Merchant is not active", { code: "MERCHANT_INACTIVE" });

      await ensureMerchantTokenFresh(merchant);

      const variantReport = await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, [value.variantId], { concurrency: 2, maxAttempts: 3 });
      const snap = variantReport.snapshots.get(String(value.variantId));
      const productId = String(snap?.productId || "").trim() || null;
      const { bundles, coverReport } = productId
        ? await loadActiveBundlesForTriggerProduct(merchant, merchant.accessToken, productId)
        : { bundles: [], coverReport: { snapshots: new Map(), missing: [] } };

      const componentVariantIds = Array.from(
        new Set(
          bundles
            .flatMap((b) => (Array.isArray(b?.components) ? b.components : []))
            .map((c) => String(c?.variantId || "").trim())
            .filter((v) => Boolean(v))
        )
      );

      const componentReport = componentVariantIds.length
        ? await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, componentVariantIds, { concurrency: 4, maxAttempts: 3 })
        : { snapshots: new Map(), missing: [] };

      const combinedSnapshots = new Map(componentReport.snapshots);
      if (snap) combinedSnapshots.set(String(value.variantId), snap);
      const productRefProductIds = uniqStrings(
        bundles
          .flatMap((b) => (Array.isArray(b?.components) ? b.components : []))
          .map((c) => parseProductRefVariantId(String(c?.variantId || "").trim()))
          .filter(Boolean)
      );
      const singleVariant = productRefProductIds.length
        ? await fetchSingleVariantSnapshotsByProductId(config.salla, merchant.accessToken, productRefProductIds)
        : { snapshotByProductId: new Map(), report: { snapshots: new Map(), missing: [] } };
      for (const s of singleVariant.snapshotByProductId.values()) combinedSnapshots.set(String(s.variantId), s);

      const combinedMissing = [
        ...(variantReport.missing || []),
        ...(componentReport.missing || []),
        ...(coverReport?.missing || []),
        ...(singleVariant?.report?.missing || [])
      ];

      const ctx = { triggerProductId: productId, triggerVariantId: String(value.variantId), singleVariantSnapshotByProductId: singleVariant.snapshotByProductId };
      const safeBundles = bundles.map((b) => serializeBundleForStorefront(b, combinedSnapshots, productId, ctx));

      const inactiveVariantIds = Array.from(combinedSnapshots.values())
        .filter((s) => s?.isActive !== true)
        .map((s) => String(s?.variantId || "").trim())
        .filter(Boolean);

      return res.json({
        ok: true,
        merchantId: String(value.merchantId),
        variantId: String(value.variantId),
        triggerProductId: productId,
        bundles: safeBundles,
        validation: {
          missing: combinedMissing,
          inactive: inactiveVariantIds
        }
      });
    } catch (err) {
      return next(err);
    }
  });

  const proxyProductByProductIdQuerySchema = Joi.object({
    merchantId: Joi.string().trim().min(1).max(80).required(),
    productId: Joi.string().trim().min(1).max(120).required(),
    token: Joi.string().trim().min(10),
    signature: Joi.string().trim().min(8),
    hmac: Joi.string().trim().min(8)
  })
    .or("signature", "hmac", "token")
    .unknown(true);

  router.get("/proxy/bundles/for-product", async (req, res, next) => {
    try {
      const { error, value } = proxyProductByProductIdQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: false });
      if (error) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      ensureValidProxyAuth(value, value.merchantId);

      const merchant = await findMerchantByMerchantId(String(value.merchantId));
      if (!merchant) throw new ApiError(404, "Merchant not found", { code: "MERCHANT_NOT_FOUND" });
      if (merchant.appStatus !== "installed") throw new ApiError(403, "Merchant is not active", { code: "MERCHANT_INACTIVE" });

      await ensureMerchantTokenFresh(merchant);

      const triggerProductId = String(value.productId || "").trim();
      const { bundles, coverReport } = triggerProductId
        ? await loadActiveBundlesForTriggerProduct(merchant, merchant.accessToken, triggerProductId)
        : { bundles: [], coverReport: { snapshots: new Map(), missing: [] } };

      const componentVariantIds = Array.from(
        new Set(
          bundles
            .flatMap((b) => (Array.isArray(b?.components) ? b.components : []))
            .map((c) => String(c?.variantId || "").trim())
            .filter((v) => Boolean(v))
        )
      );

      const componentReport = componentVariantIds.length
        ? await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, componentVariantIds, { concurrency: 4, maxAttempts: 3 })
        : { snapshots: new Map(), missing: [] };

      const productRefProductIds = uniqStrings(
        bundles
          .flatMap((b) => (Array.isArray(b?.components) ? b.components : []))
          .map((c) => parseProductRefVariantId(String(c?.variantId || "").trim()))
          .filter(Boolean)
      );
      const singleVariant = productRefProductIds.length
        ? await fetchSingleVariantSnapshotsByProductId(config.salla, merchant.accessToken, productRefProductIds)
        : { snapshotByProductId: new Map(), report: { snapshots: new Map(), missing: [] } };

      const combinedSnapshots = new Map(componentReport.snapshots);
      for (const s of singleVariant.snapshotByProductId.values()) combinedSnapshots.set(String(s.variantId), s);

      const ctx = { triggerProductId, triggerVariantId: null, singleVariantSnapshotByProductId: singleVariant.snapshotByProductId };
      const safeBundles = bundles.map((b) => serializeBundleForStorefront(b, combinedSnapshots, triggerProductId, ctx));

      const inactiveVariantIds = Array.from(combinedSnapshots.values())
        .filter((s) => s?.isActive !== true)
        .map((s) => String(s?.variantId || "").trim())
        .filter(Boolean);

      return res.json({
        ok: true,
        merchantId: String(value.merchantId),
        productId: triggerProductId,
        triggerProductId,
        bundles: safeBundles,
        validation: {
          missing: [...(componentReport.missing || []), ...(coverReport?.missing || []), ...(singleVariant?.report?.missing || [])],
          inactive: inactiveVariantIds
        }
      });
    } catch (err) {
      return next(err);
    }
  });

  const proxyProductVariantsQuerySchema = Joi.object({
    merchantId: Joi.string().trim().min(1).max(80).required(),
    productId: Joi.string().trim().min(1).max(120).required(),
    token: Joi.string().trim().min(10),
    signature: Joi.string().trim().min(8),
    hmac: Joi.string().trim().min(8)
  })
    .or("signature", "hmac", "token")
    .unknown(true);

  function extractVariantIdsFromProductPayload(data) {
    const roots = [];
    if (data && typeof data === "object") roots.push(data);
    if (data?.data && typeof data.data === "object") roots.push(data.data);

    const candidates = [];
    for (const root of roots) {
      const variantLike = root?.variants ?? root?.product_variants ?? null;
      if (variantLike) {
        if (Array.isArray(variantLike)) candidates.push(...variantLike);
        else if (Array.isArray(variantLike?.data)) candidates.push(...variantLike.data);
        else if (Array.isArray(variantLike?.items)) candidates.push(...variantLike.items);
        else if (Array.isArray(variantLike?.list)) candidates.push(...variantLike.list);
      }

      const skus = root?.skus ?? null;
      if (skus) {
        if (Array.isArray(skus)) candidates.push(...skus);
        else if (Array.isArray(skus?.data)) candidates.push(...skus.data);
        else if (Array.isArray(skus?.items)) candidates.push(...skus.items);
        else if (Array.isArray(skus?.list)) candidates.push(...skus.list);
      }

      const options = root?.options ?? null;
      const optionArr = Array.isArray(options)
        ? options
        : Array.isArray(options?.data)
          ? options.data
          : Array.isArray(options?.items)
            ? options.items
            : Array.isArray(options?.list)
              ? options.list
              : [];

      for (const opt of optionArr) {
        const optSkus = opt?.skus ?? null;
        if (!optSkus) continue;
        const skuArr = Array.isArray(optSkus)
          ? optSkus
          : Array.isArray(optSkus?.data)
            ? optSkus.data
            : Array.isArray(optSkus?.items)
              ? optSkus.items
              : Array.isArray(optSkus?.list)
                ? optSkus.list
                : [];
        candidates.push(...skuArr);
      }
    }

    const ids = [];
    for (const it of candidates) {
      if (it == null) continue;
      const id = it?.id ?? it?.sku_id ?? it?.variant_id ?? it?.variantId ?? it?.variantID ?? null;
      const s = String(id ?? "").trim();
      if (s) ids.push(s);
    }
    const uniq = Array.from(new Set(ids));
    if (uniq.length) return uniq;

    const fallback = [];
    for (const root of roots) {
      const direct =
        root?.default_variant_id ??
        root?.defaultVariantId ??
        root?.variant_id ??
        root?.variantId ??
        root?.default_sku_id ??
        root?.defaultSkuId ??
        root?.sku_id ??
        root?.skuId ??
        (root?.default_sku && typeof root.default_sku === "object" ? root.default_sku.id ?? root.default_sku.sku_id ?? null : null) ??
        (root?.sku && typeof root.sku === "object" ? root.sku.id ?? root.sku.sku_id ?? null : null) ??
        (root?.data && typeof root.data === "object"
          ? root.data.default_variant_id ??
            root.data.defaultVariantId ??
            root.data.variant_id ??
            root.data.variantId ??
            root.data.default_sku_id ??
            root.data.defaultSkuId ??
            root.data.sku_id ??
            root.data.skuId ??
            (root.data.default_sku && typeof root.data.default_sku === "object"
              ? root.data.default_sku.id ?? root.data.default_sku.sku_id ?? null
              : null) ??
            (root.data.sku && typeof root.data.sku === "object" ? root.data.sku.id ?? root.data.sku.sku_id ?? null : null)
          : null);
      const s = String(direct ?? "").trim();
      if (s) fallback.push(s);
    }
    return Array.from(new Set(fallback));
  }

  function normalizeMaybeArray(input) {
    if (Array.isArray(input)) return input;
    if (Array.isArray(input?.data)) return input.data;
    if (Array.isArray(input?.items)) return input.items;
    if (Array.isArray(input?.list)) return input.list;
    return [];
  }

  function extractOptionIdByValueIdFromProductPayload(data) {
    const roots = [];
    if (data && typeof data === "object") roots.push(data);
    if (data?.data && typeof data.data === "object") roots.push(data.data);

    const map = new Map();
    for (const root of roots) {
      const options = normalizeMaybeArray(root?.options ?? null);
      for (const opt of options) {
        const optId = String(opt?.id ?? opt?.option_id ?? opt?.optionId ?? "").trim();
        if (!optId) continue;
        const values = normalizeMaybeArray(opt?.values ?? opt?.option_values ?? opt?.optionValues ?? null);
        for (const val of values) {
          const valId = String(val?.id ?? val?.value_id ?? val?.valueId ?? "").trim();
          if (!valId) continue;
          map.set(valId, optId);
        }
      }
    }
    return map;
  }

  function extractOptionValueLabelByValueIdFromProductPayload(data) {
    const roots = [];
    if (data && typeof data === "object") roots.push(data);
    if (data?.data && typeof data.data === "object") roots.push(data.data);

    const map = new Map();
    for (const root of roots) {
      const options = normalizeMaybeArray(root?.options ?? null);
      for (const opt of options) {
        const optId = String(opt?.id ?? opt?.option_id ?? opt?.optionId ?? "").trim();
        if (!optId) continue;
        const optName = String(opt?.name ?? opt?.title ?? opt?.label ?? "").trim();
        const values = normalizeMaybeArray(opt?.values ?? opt?.option_values ?? opt?.optionValues ?? null);
        for (const val of values) {
          const valId = String(val?.id ?? val?.value_id ?? val?.valueId ?? "").trim();
          if (!valId) continue;
          const valName = String(val?.name ?? val?.value ?? val?.label ?? val?.title ?? "").trim();
          map.set(valId, { optionId: optId, optionName: optName || null, valueName: valName || null });
        }
      }
    }
    return map;
  }

  function extractSkuRecordsFromProductPayload(data) {
    const roots = [];
    if (data && typeof data === "object") roots.push(data);
    if (data?.data && typeof data.data === "object") roots.push(data.data);

    const candidates = [];
    for (const root of roots) {
      candidates.push(...normalizeMaybeArray(root?.skus ?? null));
      const options = normalizeMaybeArray(root?.options ?? null);
      for (const opt of options) {
        candidates.push(...normalizeMaybeArray(opt?.skus ?? null));
      }
    }
    return candidates;
  }

  function extractCartOptionsByVariantIdFromProductPayload(productResp) {
    const optionIdByValueId = extractOptionIdByValueIdFromProductPayload(productResp);
    const candidates = extractSkuRecordsFromProductPayload(productResp);
    const out = new Map();

    for (const sku of candidates) {
      if (sku == null) continue;
      const skuId = sku?.id ?? sku?.sku_id ?? sku?.variant_id ?? sku?.variantId ?? sku?.variantID ?? null;
      const skuIdStr = String(skuId ?? "").trim();
      if (!skuIdStr) continue;

      const relatedRaw =
        sku?.related_option_values ??
        sku?.relatedOptionValues ??
        sku?.option_values ??
        sku?.optionValues ??
        sku?.values ??
        [];
      const related = normalizeMaybeArray(relatedRaw);
      const options = {};
      for (const val of related) {
        const valIdStr = String(val ?? "").trim();
        if (!valIdStr) continue;
        const optId = optionIdByValueId.get(valIdStr);
        if (!optId) continue;
        options[optId] = valIdStr;
      }
      out.set(skuIdStr, Object.keys(options).length ? options : null);
    }
    return out;
  }

  router.get("/proxy/products/variants", async (req, res, next) => {
    try {
      const { error, value } = proxyProductVariantsQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: false });
      if (error) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      ensureValidProxyAuth(value, value.merchantId);

      const merchant = await findMerchantByMerchantId(String(value.merchantId));
      if (!merchant) throw new ApiError(404, "Merchant not found", { code: "MERCHANT_NOT_FOUND" });
      if (merchant.appStatus !== "installed") throw new ApiError(403, "Merchant is not active", { code: "MERCHANT_INACTIVE" });

      await ensureMerchantTokenFresh(merchant);

      const productId = String(value.productId || "").trim();
      const productResp = await getProductById(config.salla, merchant.accessToken, productId, {});
      const cartOptionsByVariantId = extractCartOptionsByVariantIdFromProductPayload(productResp);
      const optionValueLabelByValueId = extractOptionValueLabelByValueIdFromProductPayload(productResp);
      const variantIds = extractVariantIdsFromProductPayload(productResp);
      const report = variantIds.length
        ? await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, variantIds, { concurrency: 6, maxAttempts: 3 })
        : { snapshots: new Map(), missing: [] };

      const variants = Array.from(report.snapshots.values())
        .filter((s) => String(s?.productId || "").trim() === productId)
        .map((s) => {
          const variantId = String(s.variantId);
          const cartOptions = cartOptionsByVariantId.get(String(variantId)) || null;
          const resolvedAttrs = {};
          if (cartOptions && typeof cartOptions === "object") {
            for (const [optId, valId] of Object.entries(cartOptions)) {
              const meta = optionValueLabelByValueId.get(String(valId)) || null;
              const key = String(meta?.optionName || optId).trim();
              const val = String(meta?.valueName || valId).trim();
              if (key && val) resolvedAttrs[key] = val;
            }
          }
          const snapAttrs = s.attributes && typeof s.attributes === "object" ? s.attributes : {};
          const attrs = Object.keys(resolvedAttrs).length ? resolvedAttrs : snapAttrs;
          return {
            variantId,
            productId: String(s.productId),
            name: s.name || null,
            attributes: attrs,
            imageUrl: s.imageUrl || null,
            price: s.price != null ? Number(s.price) : null,
            cartProductId: productId,
            cartOptions,
            isActive: s.isActive === true
          };
        })
        .sort((a, b) => Number(Boolean(b.isActive)) - Number(Boolean(a.isActive)));

      return res.json({
        ok: true,
        merchantId: String(value.merchantId),
        productId,
        variants,
        validation: {
          missing: report.missing || []
        }
      });
    } catch (err) {
      return next(err);
    }
  });

  const storeBundlesParamsSchema = Joi.object({
    storeId: Joi.string().trim().min(1).max(80).required(),
    productId: Joi.string().trim().min(1).max(80).required()
  });

  const storeBundlesQuerySchema = Joi.object({
    token: Joi.string().trim().min(10),
    signature: Joi.string().trim().min(8),
    hmac: Joi.string().trim().min(8)
  })
    .or("signature", "hmac", "token")
    .unknown(true);

  router.get("/stores/:storeId/bundles/for-product/:productId", validate(storeBundlesParamsSchema, "params"), async (req, res, next) => {
    try {
      const { error } = storeBundlesQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: false });
      if (error) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      const merged = { ...(req.query || {}), storeId: req.params.storeId, productId: req.params.productId };
      try {
        ensureValidProxyAuth(merged, req.params.storeId);
      } catch {
        ensureValidProxyAuth(req.query || {}, req.params.storeId);
      }

      const merchant = await findMerchantByMerchantId(String(req.params.storeId));
      if (!merchant) throw new ApiError(404, "Merchant not found", { code: "MERCHANT_NOT_FOUND" });
      if (merchant.appStatus !== "installed") throw new ApiError(403, "Merchant is not active", { code: "MERCHANT_INACTIVE" });

      await ensureMerchantTokenFresh(merchant);

      const triggerProductId = String(req.params.productId || "").trim();
      const { bundles, coverReport } = triggerProductId
        ? await loadActiveBundlesForTriggerProduct(merchant, merchant.accessToken, triggerProductId)
        : { bundles: [], coverReport: { snapshots: new Map(), missing: [] } };
      const componentVariantIds = Array.from(
        new Set(
          bundles
            .flatMap((b) => (Array.isArray(b?.components) ? b.components : []))
            .map((c) => String(c?.variantId || "").trim())
            .filter((v) => Boolean(v))
        )
      );
      const componentReport = componentVariantIds.length
        ? await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, componentVariantIds, { concurrency: 4, maxAttempts: 3 })
        : { snapshots: new Map(), missing: [] };

      const productRefProductIds = uniqStrings(
        bundles
          .flatMap((b) => (Array.isArray(b?.components) ? b.components : []))
          .map((c) => parseProductRefVariantId(String(c?.variantId || "").trim()))
          .filter(Boolean)
      );
      const singleVariant = productRefProductIds.length
        ? await fetchSingleVariantSnapshotsByProductId(config.salla, merchant.accessToken, productRefProductIds)
        : { snapshotByProductId: new Map(), report: { snapshots: new Map(), missing: [] } };

      const combinedSnapshots = new Map(componentReport.snapshots);
      for (const s of singleVariant.snapshotByProductId.values()) combinedSnapshots.set(String(s.variantId), s);

      const ctx = { triggerProductId, triggerVariantId: null, singleVariantSnapshotByProductId: singleVariant.snapshotByProductId };
      const safeBundles = bundles.map((b) => serializeBundleForStorefront(b, combinedSnapshots, triggerProductId, ctx));

      const inactiveVariantIds = Array.from(combinedSnapshots.values())
        .filter((s) => s?.isActive !== true)
        .map((s) => String(s?.variantId || "").trim())
        .filter(Boolean);

      return res.json({
        ok: true,
        storeId: String(req.params.storeId),
        productId: String(req.params.productId),
        triggerProductId,
        bundles: safeBundles,
        validation: {
          missing: [...(componentReport.missing || []), ...(coverReport?.missing || []), ...(singleVariant?.report?.missing || [])],
          inactive: inactiveVariantIds
        }
      });
    } catch (err) {
      return next(err);
    }
  });

  const proxyCartQuerySchema = Joi.object({
    merchantId: Joi.string().trim().min(1).max(80).required(),
    payloadHash: Joi.string().trim().length(64),
    token: Joi.string().trim().min(10),
    signature: Joi.string().trim().min(8),
    hmac: Joi.string().trim().min(8)
  })
    .or("signature", "hmac", "token")
    .unknown(true);

  const proxyCartBodySchema = Joi.object({
    items: Joi.array()
      .items(
        Joi.object({
          variantId: Joi.string().trim().min(1).required(),
          quantity: Joi.number().integer().min(1).required()
        })
      )
      .min(1)
      .required()
  }).required();

  router.post("/proxy/cart/banner", async (req, res, next) => {
    try {
      const { error: qError, value: qValue } = proxyCartQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: false });
      if (qError) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: qError.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      const { error: bError, value: bValue } = proxyCartBodySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
      if (bError) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: bError.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      ensureValidProxyAuth(qValue, qValue.merchantId);

      if (qValue.payloadHash) {
        const computed = sha256Hex(stableStringify(bValue));
        if (computed !== String(qValue.payloadHash)) {
          throw new ApiError(400, "Invalid payload hash", { code: "PAYLOAD_HASH_INVALID" });
        }
      }

      const merchant = await findMerchantByMerchantId(String(qValue.merchantId));
      if (!merchant) throw new ApiError(404, "Merchant not found", { code: "MERCHANT_NOT_FOUND" });
      if (merchant.appStatus !== "installed") throw new ApiError(403, "Merchant is not active", { code: "MERCHANT_INACTIVE" });

      await ensureMerchantTokenFresh(merchant);

      const rawItems = bValue.items;
      const productRefProductIds = uniqStrings(rawItems.map((i) => parseProductRefVariantId(i.variantId)).filter(Boolean));
      const singleVariant = productRefProductIds.length
        ? await fetchSingleVariantSnapshotsByProductId(config.salla, merchant.accessToken, productRefProductIds)
        : { snapshotByProductId: new Map(), report: { snapshots: new Map(), missing: [] } };

      const items = rawItems.map((it) => {
        const pid = parseProductRefVariantId(it.variantId);
        const snap = pid ? singleVariant.snapshotByProductId.get(String(pid)) : null;
        if (!snap) return it;
        return { ...it, variantId: String(snap.variantId) };
      });

      const variantIds = Array.from(
        new Set(items.map((i) => String(i.variantId)).filter((v) => Boolean(v)))
      );
      const report = await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, variantIds, { concurrency: 5, maxAttempts: 3 });
      const combinedSnapshots = new Map(report.snapshots);
      for (const s of singleVariant.snapshotByProductId.values()) combinedSnapshots.set(String(s.variantId), s);
      const inactive = Array.from(report.snapshots.values())
        .filter((s) => s?.isActive !== true)
        .map((s) => s.variantId);

      const evaluation = await bundleService.evaluateBundles(merchant, items, combinedSnapshots);
      const issued = await issueOrReuseCouponForCartVerbose(config, merchant, merchant.accessToken, items, evaluation, { ttlHours: 24 });
      const coupon = issued?.coupon || null;

      const discountAmount = Number.isFinite(evaluation?.applied?.totalDiscount) ? Number(evaluation.applied.totalDiscount) : 0;
      const hasDiscount = Boolean(coupon && discountAmount > 0);
      const couponIssueFailed = Boolean(!coupon && discountAmount > 0);
      const messages = [];
      if (!items.length) messages.push({ level: "info", code: "CART_EMPTY", message: "Cart has no items." });
      if (!hasDiscount && !couponIssueFailed) messages.push({ level: "info", code: "NO_BUNDLE_APPLIED", message: "No bundle discounts apply to this cart." });
      if (couponIssueFailed) messages.push({ level: "warn", code: "COUPON_ISSUE_FAILED", message: "Discount exists but coupon could not be issued." });

      return res.json({
        ok: true,
        merchantId: String(qValue.merchantId),
        hasDiscount,
        discountAmount: hasDiscount ? Number(discountAmount.toFixed(2)) : 0,
        couponCode: hasDiscount ? coupon.code : null,
        couponIssueFailed,
        couponIssueDetails: couponIssueFailed ? issued?.failure || null : null,
        banner: hasDiscount
          ? {
              title: "خصم الباقة اتفعل",
              cta: "تطبيق الخصم",
              bannerColor: "#16a34a",
              badgeColor: "#16a34a",
              couponCode: coupon.code,
              discountAmount: Number(discountAmount.toFixed(2)),
              autoApply: true
            }
          : null,
        applied: evaluation?.applied || null,
        validation: {
          missing: report.missing || [],
          inactive,
          messages
        }
      });
    } catch (err) {
      return next(err);
    }
  });

  const proxyApplyBundleBodySchema = Joi.object({
    bundleId: Joi.string().trim().min(1).max(120).required(),
    items: Joi.array()
      .items(
        Joi.object({
          variantId: Joi.string().trim().min(1).required(),
          quantity: Joi.number().integer().min(1).required()
        })
      )
      .min(1)
      .required()
  }).required();

  router.post("/proxy/bundles/apply", async (req, res, next) => {
    try {
      const { error: qError, value: qValue } = proxyCartQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: false });
      if (qError) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: qError.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      const { error: bError, value: bValue } = proxyApplyBundleBodySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
      if (bError) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: bError.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      ensureValidProxyAuth(qValue, qValue.merchantId);

      const merchant = await findMerchantByMerchantId(String(qValue.merchantId));
      if (!merchant) throw new ApiError(404, "Merchant not found", { code: "MERCHANT_NOT_FOUND" });
      if (merchant.appStatus !== "installed") throw new ApiError(403, "Merchant is not active", { code: "MERCHANT_INACTIVE" });

      await ensureMerchantTokenFresh(merchant);

      const storeId = String(merchant.merchantId || "").trim();
      const bundle = await bundleService.getBundleById(storeId, String(bValue.bundleId));
      if (String(bundle?.status || "") !== "active") throw new ApiError(404, "Bundle not found", { code: "BUNDLE_NOT_FOUND" });

      const rawItems = bValue.items;
      const productRefProductIds = uniqStrings(rawItems.map((i) => parseProductRefVariantId(i.variantId)).filter(Boolean));
      const singleVariant = productRefProductIds.length
        ? await fetchSingleVariantSnapshotsByProductId(config.salla, merchant.accessToken, productRefProductIds)
        : { snapshotByProductId: new Map(), report: { snapshots: new Map(), missing: [] } };

      const items = rawItems.map((it) => {
        const pid = parseProductRefVariantId(it.variantId);
        const snap = pid ? singleVariant.snapshotByProductId.get(String(pid)) : null;
        if (!snap) return it;
        return { ...it, variantId: String(snap.variantId) };
      });

      const variantIds = Array.from(
        new Set(items.map((i) => String(i.variantId)).filter((v) => Boolean(v)))
      );
      const report = await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, variantIds, { concurrency: 5, maxAttempts: 3 });
      const combinedSnapshots = new Map(report.snapshots);
      for (const s of singleVariant.snapshotByProductId.values()) combinedSnapshots.set(String(s.variantId), s);

      const rawKind = String(bundle?.kind || "").trim();
      const kind =
        rawKind === "quantity_discount" || rawKind === "products_discount" || rawKind === "products_no_discount" || rawKind === "post_add_upsell"
          ? rawKind
          : Array.isArray(bundle?.rules?.tiers) && bundle.rules.tiers.length
            ? "quantity_discount"
            : Number(bundle?.rules?.value ?? 0) <= 0
              ? "products_no_discount"
              : "products_discount";

      const evaluation = await bundleService.evaluateBundles(merchant, items, combinedSnapshots);
      const discountAmount = Number.isFinite(evaluation?.applied?.totalDiscount) ? Number(evaluation.applied.totalDiscount) : 0;

      const shouldIssueCoupon = discountAmount > 0;
      const issued = shouldIssueCoupon
        ? await issueOrReuseCouponForCartVerbose(config, merchant, merchant.accessToken, items, evaluation, { ttlHours: 24 })
        : { coupon: null, failure: { reason: "NO_DISCOUNT" } };
      const coupon = issued?.coupon || null;
      const hasDiscount = Boolean(coupon && discountAmount > 0);
      const couponIssueFailed = Boolean(shouldIssueCoupon && !coupon);

      return res.json({
        ok: true,
        merchantId: String(qValue.merchantId),
        bundleId: String(bValue.bundleId),
        kind,
        hasDiscount,
        discountAmount: hasDiscount ? Number(discountAmount.toFixed(2)) : 0,
        couponCode: hasDiscount ? coupon.code : null,
        couponIssueFailed,
        couponIssueDetails: couponIssueFailed ? issued?.failure || null : null,
        applied: evaluation?.applied || null
      });
    } catch (err) {
      return next(err);
    }
  });

  const sallaProductsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    per_page: Joi.number().integer().min(1).max(200),
    perPage: Joi.number().integer().min(1).max(200),
    format: Joi.string().trim().min(1).max(50),
    search: Joi.string().allow("").max(200),
    keyword: Joi.string().allow("").max(200),
    status: Joi.string().trim().min(1).max(50),
    category: Joi.number().integer().min(1)
  });

  router.get("/products", merchantAuth(config), validate(sallaProductsQuerySchema, "query"), async (req, res, next) => {
    const page = req.query.page;
    const perPage = req.query.per_page ?? req.query.perPage;
    const format = req.query.format;
    const search = String(req.query.keyword ?? req.query.search ?? "").trim() || undefined;
    const status = req.query.status;
    const category = req.query.category;

    try {
      const response = await listProducts(config.salla, req.merchantAccessToken, { page, perPage, format, search, status, category });
      return res.json(response);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401 && req.merchant) {
        try {
          await refreshAccessToken(config.salla, req.merchant);
          req.merchantAccessToken = req.merchant.accessToken;
          const response = await listProducts(config.salla, req.merchantAccessToken, { page, perPage, format, search, status, category });
          return res.json(response);
        } catch {
          return next(err);
        }
      }
      return next(err);
    }
  });

  const sallaProductParamsSchema = Joi.object({
    productId: Joi.string().trim().min(1).max(80).required()
  });

  const sallaProductDetailsQuerySchema = Joi.object({
    format: Joi.string().trim().min(1).max(50)
  });

  router.get(
    "/products/:productId",
    merchantAuth(config),
    validate(sallaProductParamsSchema, "params"),
    validate(sallaProductDetailsQuerySchema, "query"),
    async (req, res, next) => {
      const productId = req.params.productId;
      const format = req.query.format;
      try {
        const response = await getProductById(config.salla, req.merchantAccessToken, productId, { format });
        return res.json(response);
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 401 && req.merchant) {
          try {
            await refreshAccessToken(config.salla, req.merchant);
            req.merchantAccessToken = req.merchant.accessToken;
            const response = await getProductById(config.salla, req.merchantAccessToken, productId, { format });
            return res.json(response);
          } catch {
            return next(err);
          }
        }
        return next(err);
      }
    }
  );

  const sallaVariantParamsSchema = Joi.object({
    variantId: Joi.string().trim().min(1).max(120).required()
  });

  router.get(
    "/variants/:variantId",
    merchantAuth(config),
    validate(sallaVariantParamsSchema, "params"),
    async (req, res, next) => {
      const variantId = req.params.variantId;
      try {
        const response = await getProductVariant(config.salla, req.merchantAccessToken, variantId);
        return res.json(response);
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 401 && req.merchant) {
          try {
            await refreshAccessToken(config.salla, req.merchant);
            req.merchantAccessToken = req.merchant.accessToken;
            const response = await getProductVariant(config.salla, req.merchantAccessToken, variantId);
            return res.json(response);
          } catch {
            return next(err);
          }
        }
        return next(err);
      }
    }
  );

  const variantsSnapshotSchema = Joi.object({
    variantIds: Joi.array().items(Joi.string().trim().min(1).max(120)).min(1).max(200).required()
  });

  router.post(
    "/variants/snapshots",
    merchantAuth(config),
    validate(variantsSnapshotSchema, "body"),
    async (req, res, next) => {
      const variantIds = req.body.variantIds || [];
      try {
        const report = await fetchVariantsSnapshotReport(config.salla, req.merchantAccessToken, variantIds, { concurrency: 5, maxAttempts: 3 });
        return res.json({ variants: Array.from(report.snapshots.values()), missing: report.missing || [] });
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 401 && req.merchant) {
          try {
            await refreshAccessToken(config.salla, req.merchant);
            req.merchantAccessToken = req.merchant.accessToken;
            const report = await fetchVariantsSnapshotReport(config.salla, req.merchantAccessToken, variantIds, { concurrency: 5, maxAttempts: 3 });
            return res.json({ variants: Array.from(report.snapshots.values()), missing: report.missing || [] });
          } catch {
            return next(err);
          }
        }
        return next(err);
      }
    }
  );

  return router;
}

module.exports = {
  createApiRouter
};
