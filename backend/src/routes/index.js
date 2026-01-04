const express = require("express");
const Joi = require("joi");
const { createBundleRouter } = require("./bundle.routes");
const { merchantAuth } = require("../middlewares/merchantAuth.middleware");
const { createOAuthRouter } = require("./oauth.routes");
const { validate } = require("../middlewares/validate.middleware");
const { listProducts, getProductById, getProductVariant, getStoreInfo } = require("../services/sallaApi.service");
const { refreshAccessToken } = require("../services/sallaOAuth.service");
const { ApiError } = require("../utils/apiError");
const { fetchVariantsSnapshotReport } = require("../services/sallaCatalog.service");
const { findMerchantByMerchantId } = require("../services/merchant.service");
const bundleService = require("../services/bundle.service");
const { issueOrReuseSpecialOfferForCartVerbose } = require("../services/cartCoupon.service");
const { hmacSha256, sha256Hex } = require("../utils/hash");
const { Buffer } = require("buffer");
const crypto = require("crypto");
const axios = require("axios");
const { readSnippetCss } = require("../storefront/snippet/styles");
const mountBundle = require("../storefront/snippet/features/bundle/bundle.mount");
const mountAnnouncementBanner = require("../storefront/snippet/features/announcementBanner/banner.mount");
const mountMediaPlatform = require("../storefront/snippet/features/mediaPlatform/media.mount");
const { createAnnouncementBannerRouter } = require("./announcementBanner.routes");
const announcementBannerService = require("../services/announcementBanner.service");
const MediaAsset = require("../models/MediaAsset");

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

  function parseBasicAuth(req) {
    const header = String(req.headers.authorization || "");
    if (!header.toLowerCase().startsWith("basic ")) return null;
    const encoded = header.slice(6).trim();
    let decoded = "";
    try {
      decoded = Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      return null;
    }
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  }

  function adminAuth(req, res, next) {
    const expectedUser = String(process.env.ADMIN_DASH_USER || "");
    const expectedPass = String(process.env.ADMIN_DASH_PASS || "");
    if (!expectedUser || !expectedPass) {
      res.status(403);
      return res.send("Forbidden");
    }
    const creds = parseBasicAuth(req);
    const ok =
      creds &&
      timingSafeEqualString(String(creds.user || ""), expectedUser) &&
      timingSafeEqualString(String(creds.pass || ""), expectedPass);
    if (!ok) {
      res.setHeader("WWW-Authenticate", 'Basic realm="BundleApp Admin", charset="UTF-8"');
      res.status(401);
      return res.send("Unauthorized");
    }
    return next();
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
      rawKind === "quantity_discount" ||
      rawKind === "products_discount" ||
      rawKind === "products_no_discount" ||
      rawKind === "post_add_upsell" ||
      rawKind === "popup" ||
      rawKind === "also_bought"
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
    const popupTriggers = Array.isArray(bundle?.popupTriggers) ? bundle.popupTriggers.map((x) => String(x || "").trim()).filter(Boolean) : [];
    const popupSettings = bundle?.popupSettings && typeof bundle.popupSettings === "object" ? bundle.popupSettings : null;
    const alsoBoughtPlacements = Array.isArray(bundle?.alsoBoughtPlacements)
      ? bundle.alsoBoughtPlacements.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
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
      pricing,
      popupTriggers,
      popupSettings,
      alsoBoughtPlacements
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
      mountMediaPlatform(context);
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

  function requireCloudinaryConfig() {
    const cloudName = String(config?.cloudinary?.cloudName || "").trim();
    const apiKey = String(config?.cloudinary?.apiKey || "").trim();
    const apiSecret = String(config?.cloudinary?.apiSecret || "").trim();
    const folderPrefix = String(config?.cloudinary?.folderPrefix || "bundle_app").trim() || "bundle_app";
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ApiError(500, "Cloudinary is not configured", { code: "CLOUDINARY_NOT_CONFIGURED" });
    }
    return { cloudName, apiKey, apiSecret, folderPrefix };
  }

  function cloudinarySign(params, apiSecret) {
    const entries = Object.entries(params || {})
      .filter(([, v]) => v != null && String(v) !== "")
      .map(([k, v]) => [String(k), Array.isArray(v) ? v.map((x) => String(x)).join(",") : String(v)])
      .sort(([a], [b]) => a.localeCompare(b));
    const base = entries.map(([k, v]) => `${k}=${v}`).join("&");
    return crypto.createHash("sha1").update(`${base}${apiSecret}`, "utf8").digest("hex");
  }

  function mediaFolderForMerchant(folderPrefix, merchantId) {
    const m = String(merchantId || "").trim();
    const p = String(folderPrefix || "").trim();
    const cleanP = p.replace(/\/+$/g, "");
    return `${cleanP}/${m}`;
  }

  function serializeMediaAsset(doc) {
    if (!doc) return null;
    return {
      id: String(doc._id),
      merchantId: String(doc.merchantId),
      storeId: String(doc.storeId),
      storeSallaId: doc.storeSallaId != null ? String(doc.storeSallaId) : null,
      storeName: doc.storeName != null ? String(doc.storeName) : null,
      storeDomain: doc.storeDomain != null ? String(doc.storeDomain) : null,
      storeUrl: doc.storeUrl != null ? String(doc.storeUrl) : null,
      resourceType: doc.resourceType,
      publicId: doc.publicId,
      assetId: doc.assetId || null,
      folder: doc.folder || null,
      originalFilename: doc.originalFilename || null,
      format: doc.format || null,
      bytes: doc.bytes != null ? Number(doc.bytes) : null,
      width: doc.width != null ? Number(doc.width) : null,
      height: doc.height != null ? Number(doc.height) : null,
      duration: doc.duration != null ? Number(doc.duration) : null,
      url: doc.url || null,
      secureUrl: doc.secureUrl || null,
      thumbnailUrl: doc.thumbnailUrl || null,
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      context: doc.context || null,
      cloudinaryCreatedAt: doc.cloudinaryCreatedAt ? new Date(doc.cloudinaryCreatedAt).toISOString() : null,
      createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null
    };
  }

  function normalizeSallaStoreInfo(raw) {
    if (!raw || typeof raw !== "object") return null;
    const data = raw && typeof raw === "object" ? (raw.data && typeof raw.data === "object" ? raw.data : raw) : null;
    const store = data && typeof data === "object"
      ? (data.store && typeof data.store === "object" ? data.store : data.merchant && typeof data.merchant === "object" ? data.merchant : data)
      : null;
    if (!store || typeof store !== "object") return null;

    const id = store.id != null ? String(store.id) : null;
    const name =
      store.name != null ? String(store.name) : store.store_name != null ? String(store.store_name) : store.storeName != null ? String(store.storeName) : null;
    const domain =
      store.domain != null
        ? String(store.domain)
        : Array.isArray(store.domains) && store.domains.length
          ? String(store.domains[0])
          : null;
    const url = store.url != null ? String(store.url) : store.website != null ? String(store.website) : null;

    return { id, name, domain, url };
  }

  const adminMediaAssetsQuerySchema = Joi.object({
    storeId: Joi.string().trim().min(1).max(80),
    resourceType: Joi.string().trim().valid("image", "video", "raw"),
    q: Joi.string().trim().max(120),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(50)
  }).unknown(true);

  router.get("/admin/media", adminAuth, (_req, res) => {
    res.type("html");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>BundleApp • Admin Media</title>
  <style>
    :root{color-scheme:light}
    body{margin:0;background:#0b1220;color:#0b1220;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
    .wrap{max-width:1200px;margin:0 auto;padding:28px 18px}
    .card{background:#fff;border:1px solid rgba(15,23,42,.10);border-radius:18px;box-shadow:0 18px 50px rgba(2,6,23,.10)}
    .head{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;padding:18px 18px 12px;border-bottom:1px solid rgba(15,23,42,.08)}
    h1{margin:0;font-size:16px;font-weight:950;letter-spacing:.2px}
    .sub{margin-top:6px;color:rgba(15,23,42,.70);font-size:12px;font-weight:800}
    .tools{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-start}
    .row{display:grid;grid-template-columns:1.1fr 1fr .8fr .7fr;gap:10px;padding:14px 18px}
    label{display:block;font-size:12px;font-weight:900;color:rgba(15,23,42,.75);margin-bottom:6px}
    input,select{width:100%;border:1px solid rgba(15,23,42,.12);border-radius:14px;padding:12px 12px;font-size:13px;font-weight:800;outline:none}
    input:focus,select:focus{box-shadow:0 0 0 4px rgba(15,23,42,.10)}
    button{border:0;border-radius:14px;padding:12px 14px;font-size:13px;font-weight:950;background:#0f172a;color:#fff;cursor:pointer}
    button:disabled{opacity:.6;cursor:not-allowed}
    .status{padding:0 18px 14px;color:rgba(15,23,42,.75);font-size:12px;font-weight:900}
    table{width:100%;border-collapse:separate;border-spacing:0}
    thead th{position:sticky;top:0;background:#fff;z-index:1;text-align:right;font-size:12px;font-weight:950;color:rgba(15,23,42,.75);padding:12px 14px;border-bottom:1px solid rgba(15,23,42,.08)}
    tbody td{font-size:12px;font-weight:850;color:#0b1220;padding:12px 14px;border-bottom:1px solid rgba(15,23,42,.06);vertical-align:top}
    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
    a{color:#0369a1;text-decoration:underline}
    .pill{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid rgba(15,23,42,.12);border-radius:999px;background:rgba(15,23,42,.02);font-weight:950}
    .footer{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:14px 18px}
    .pager{display:flex;gap:8px;flex-wrap:wrap}
  </style>
  <script>
    function qs(name){return new URLSearchParams(location.search).get(name) || '';}
    function setQs(values){
      const u = new URL(location.href);
      for (const [k,v] of Object.entries(values)) {
        if (v == null || String(v).trim() === '') u.searchParams.delete(k);
        else u.searchParams.set(k, String(v));
      }
      history.replaceState(null, '', u.toString());
    }
    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g, (ch)=>ch==='&'?'&amp;':ch==='<'?'&lt;':ch==='>'?'&gt;':ch==='"'?'&quot;':'&#39;');}
    function fmtBytes(n){
      const b = Number(n);
      if (!Number.isFinite(b) || b < 0) return '—';
      if (b < 1024) return b+' B';
      const kb=b/1024; if (kb < 1024) return kb.toFixed(1)+' KB';
      const mb=kb/1024; if (mb < 1024) return mb.toFixed(1)+' MB';
      const gb=mb/1024; return gb.toFixed(2)+' GB';
    }
    function fmtDate(v){
      if (!v) return '—';
      const d=new Date(v); if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString();
    }
    async function load(){
      const storeId = qs('storeId');
      const resourceType = qs('resourceType');
      const q = qs('q');
      const page = Number(qs('page') || 1);
      const limit = Number(qs('limit') || 50);
      document.getElementById('storeId').value = storeId;
      document.getElementById('resourceType').value = resourceType;
      document.getElementById('q').value = q;
      document.getElementById('limit').value = String(limit);
      const st = document.getElementById('status');
      st.textContent = 'Loading…';
      const url = '/api/admin/media/assets?' + new URLSearchParams({ ...(storeId?{storeId}:{}), ...(resourceType?{resourceType}:{}), ...(q?{q}:{}), page: String(page), limit: String(limit) }).toString();
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) {
        const t = await res.text().catch(()=> '');
        st.textContent = 'Failed: ' + res.status;
        throw new Error(t || ('HTTP ' + res.status));
      }
      const data = await res.json();
      const total = Number(data.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      st.textContent = 'Total: ' + total + ' • Page: ' + page + '/' + totalPages;
      document.getElementById('prev').disabled = page <= 1;
      document.getElementById('next').disabled = page >= totalPages;
      document.getElementById('prev').onclick = () => { setQs({ page: String(Math.max(1, page - 1)) }); load(); };
      document.getElementById('next').onclick = () => { setQs({ page: String(Math.min(totalPages, page + 1)) }); load(); };
      const tbody = document.getElementById('rows');
      tbody.innerHTML = '';
      const items = Array.isArray(data.items) ? data.items : [];
      for (const it of items) {
        const storeName = it.storeName || it.merchant?.storeName || '';
        const store = storeName ? (storeName + ' (' + (it.storeId||'') + ')') : (it.storeId||'');
        const link = it.secureUrl || it.url || '';
        const type = it.resourceType || '—';
        const filename = it.originalFilename || it.publicId || '—';
        const uploadedAt = fmtDate(it.cloudinaryCreatedAt || it.createdAt);
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td><div class="pill">' + esc(store || '—') + '</div><div class="sub mono" style="margin-top:8px;">' + esc(it.storeDomain || it.storeUrl || '') + '</div></td>' +
          '<td><div style="font-weight:950;">' + esc(filename) + '</div><div class="sub mono" style="margin-top:8px;">' + esc(it.publicId || '—') + '</div></td>' +
          '<td><div class="mono">' + esc(type) + '</div><div class="sub" style="margin-top:8px;">' + esc(fmtBytes(it.bytes)) + '</div></td>' +
          '<td><div>' + esc(uploadedAt) + '</div>' + (link ? ('<div class="sub" style="margin-top:8px;"><a target="_blank" rel="noopener noreferrer" href="' + esc(link) + '">فتح</a></div>') : '') + '</td>';
        tbody.appendChild(tr);
      }
    }
    function onApply(ev){
      ev.preventDefault();
      const storeId = document.getElementById('storeId').value.trim();
      const resourceType = document.getElementById('resourceType').value.trim();
      const q = document.getElementById('q').value.trim();
      const limit = document.getElementById('limit').value.trim();
      setQs({ storeId, resourceType, q, limit, page: '1' });
      load();
    }
    window.addEventListener('DOMContentLoaded', () => {
      document.getElementById('filters').addEventListener('submit', onApply);
      load().catch(()=>undefined);
    });
  </script>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="head">
        <div>
          <h1>لوحة الأدمن • الميديا (كل العملاء)</h1>
          <div class="sub">يعرض كل ملفات Cloudinary المسجلة في قاعدة البيانات حسب المتجر</div>
        </div>
      </div>
      <form id="filters" class="row">
        <div>
          <label>Store ID (Merchant ID)</label>
          <input id="storeId" placeholder="مثال: 123456" />
        </div>
        <div>
          <label>بحث (Public ID / Filename)</label>
          <input id="q" placeholder="مثال: bundle_app/123456/…" />
        </div>
        <div>
          <label>النوع</label>
          <select id="resourceType">
            <option value="">الكل</option>
            <option value="image">صور</option>
            <option value="video">فيديو</option>
            <option value="raw">ملفات</option>
          </select>
        </div>
        <div>
          <label>Page size</label>
          <div class="tools">
            <select id="limit">
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
            <button type="submit">تطبيق</button>
          </div>
        </div>
      </form>
      <div id="status" class="status"></div>
      <div style="overflow:auto;max-height:70vh;">
        <table>
          <thead>
            <tr>
              <th style="min-width:320px;">المتجر</th>
              <th style="min-width:420px;">الملف</th>
              <th style="min-width:140px;">النوع</th>
              <th style="min-width:220px;">التاريخ</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <div class="footer">
        <div class="pager">
          <button id="prev" type="button">Prev</button>
          <button id="next" type="button">Next</button>
        </div>
        <div class="sub">/api/admin/media</div>
      </div>
    </div>
  </div>
</body>
</html>`;
    return res.send(html);
  });

  router.get("/admin/media/assets", adminAuth, async (req, res, next) => {
    try {
      const { error, value } = adminMediaAssetsQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: true });
      if (error) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      const filter = { deletedAt: null };
      if (value.storeId) filter.storeId = String(value.storeId);
      if (value.resourceType) filter.resourceType = String(value.resourceType);
      if (value.q) {
        const q = String(value.q);
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [{ publicId: rx }, { originalFilename: rx }, { storeId: rx }, { storeName: rx }];
      }

      const page = Number(value.page);
      const limit = Number(value.limit);
      const skip = (page - 1) * limit;

      const [total, docs] = await Promise.all([
        MediaAsset.countDocuments(filter),
        MediaAsset.find(filter).sort({ cloudinaryCreatedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean()
      ]);

      const storeIds = Array.from(new Set(docs.map((d) => String(d.storeId || "")).filter(Boolean)));
      const merchants = storeIds.length
        ? await require("../models/Merchant").find({ merchantId: { $in: storeIds } }).select("merchantId appStatus createdAt updatedAt").lean()
        : [];
      const merchantById = new Map(merchants.map((m) => [String(m.merchantId), m]));

      const items = docs.map((d) => {
        const base = serializeMediaAsset(d);
        const mid = base && base.storeId ? String(base.storeId) : "";
        const m = mid ? merchantById.get(mid) : null;
        return {
          ...base,
          merchant: m
            ? {
              merchantId: String(m.merchantId),
              appStatus: String(m.appStatus || ""),
              createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
              updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : null
            }
            : null
        };
      });

      return res.json({ ok: true, page, limit, total, items });
    } catch (err) {
      return next(err);
    }
  });

  const mediaSignatureBodySchema = Joi.object({
    resourceType: Joi.string().valid("image", "video", "raw").default("image"),
    tags: Joi.array().items(Joi.string().trim().min(1).max(50)).max(20).default([]),
    context: Joi.object().unknown(true).default({})
  }).required();

  router.post("/media/signature", merchantAuth(config), async (req, res, next) => {
    try {
      const { error, value } = mediaSignatureBodySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
      if (error) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      const { cloudName, apiKey, apiSecret, folderPrefix } = requireCloudinaryConfig();
      const merchantId = String(req.merchant?.merchantId || "").trim();
      const folder = mediaFolderForMerchant(folderPrefix, merchantId);
      const timestamp = Math.floor(Date.now() / 1000);

      const context = value.context && typeof value.context === "object" ? value.context : {};
      const contextParts = [];
      for (const [k, v] of Object.entries(context)) {
        const key = String(k || "").trim();
        if (!key) continue;
        const val = String(v == null ? "" : v).trim();
        if (!val) continue;
        contextParts.push(`${key}=${val}`);
      }
      const contextStr = contextParts.length ? contextParts.join("|") : null;

      const tags = Array.isArray(value.tags) ? value.tags.map((t) => String(t).trim()).filter(Boolean) : [];
      const tagsStr = tags.length ? tags.join(",") : null;

      const paramsToSign = { folder, timestamp, ...(contextStr ? { context: contextStr } : {}), ...(tagsStr ? { tags: tagsStr } : {}) };
      const signature = cloudinarySign(paramsToSign, apiSecret);

      return res.json({
        ok: true,
        cloudinary: {
          cloudName,
          apiKey,
          resourceType: value.resourceType,
          uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${value.resourceType}/upload`,
          folder,
          timestamp,
          signature,
          ...(contextStr ? { context: contextStr } : {}),
          ...(tagsStr ? { tags: tagsStr } : {})
        }
      });
    } catch (err) {
      return next(err);
    }
  });

  const mediaRecordBodySchema = Joi.object({
    cloudinary: Joi.object({
      public_id: Joi.string().trim().min(1).required(),
      asset_id: Joi.string().trim().min(1).allow(null),
      resource_type: Joi.string().trim().valid("image", "video", "raw").required(),
      secure_url: Joi.string().uri().allow(null),
      url: Joi.string().uri().allow(null),
      bytes: Joi.number().integer().min(0).allow(null),
      format: Joi.string().trim().allow(null),
      width: Joi.number().integer().min(0).allow(null),
      height: Joi.number().integer().min(0).allow(null),
      duration: Joi.number().min(0).allow(null),
      original_filename: Joi.string().trim().allow(null),
      folder: Joi.string().trim().allow(null),
      tags: Joi.array().items(Joi.string()).default([]),
      context: Joi.object().unknown(true).allow(null),
      created_at: Joi.string().trim().allow(null)
    })
      .unknown(true)
      .required()
  }).required();

  router.post("/media/assets", merchantAuth(config), async (req, res, next) => {
    try {
      const { error, value } = mediaRecordBodySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
      if (error) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      const merchantId = String(req.merchant?.merchantId || "").trim();
      const storeId = merchantId;
      const c = value.cloudinary || {};

      const createdAt = c.created_at ? new Date(String(c.created_at)) : null;
      const cloudinaryCreatedAt = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null;

      const contextObj = c.context && typeof c.context === "object" ? c.context : null;
      const ctx = contextObj && typeof contextObj.custom === "object" ? contextObj.custom : contextObj;

      let storeInfo = null;
      try {
        const raw = await getStoreInfo(config.salla, req.merchantAccessToken);
        storeInfo = normalizeSallaStoreInfo(raw);
      } catch (err) {
        void err;
      }

      const doc = await MediaAsset.findOneAndUpdate(
        { storeId, publicId: String(c.public_id), deletedAt: null },
        {
          $set: {
            merchantId,
            storeId,
            storeSallaId: storeInfo?.id || null,
            storeName: storeInfo?.name || null,
            storeDomain: storeInfo?.domain || null,
            storeUrl: storeInfo?.url || null,
            resourceType: String(c.resource_type),
            publicId: String(c.public_id),
            assetId: c.asset_id ? String(c.asset_id) : null,
            folder: c.folder ? String(c.folder) : null,
            originalFilename: c.original_filename ? String(c.original_filename) : null,
            format: c.format ? String(c.format) : null,
            bytes: c.bytes != null ? Number(c.bytes) : null,
            width: c.width != null ? Number(c.width) : null,
            height: c.height != null ? Number(c.height) : null,
            duration: c.duration != null ? Number(c.duration) : null,
            url: c.url ? String(c.url) : null,
            secureUrl: c.secure_url ? String(c.secure_url) : null,
            thumbnailUrl: c.secure_url ? String(c.secure_url) : null,
            tags: Array.isArray(c.tags) ? c.tags.map((t) => String(t)).filter(Boolean) : [],
            context: ctx || null,
            cloudinaryCreatedAt,
            cloudinary: c
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return res.json({ ok: true, asset: serializeMediaAsset(doc) });
    } catch (err) {
      return next(err);
    }
  });

  const mediaListQuerySchema = Joi.object({
    storeId: Joi.string().trim().min(1).max(80),
    resourceType: Joi.string().trim().valid("image", "video", "raw"),
    q: Joi.string().trim().max(120),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(24)
  }).unknown(true);

  router.get("/media/assets", merchantAuth(config), async (req, res, next) => {
    try {
      const { error, value } = mediaListQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: true });
      if (error) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      const merchantId = String(req.merchant?.merchantId || "").trim();
      const storeId = String(value.storeId || "").trim() || merchantId;
      if (storeId !== merchantId) {
        throw new ApiError(403, "Forbidden", { code: "FORBIDDEN" });
      }

      const filter = { storeId, deletedAt: null };
      if (value.resourceType) filter.resourceType = String(value.resourceType);
      if (value.q) {
        const q = String(value.q);
        filter.$or = [{ publicId: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }];
      }

      const page = Number(value.page);
      const limit = Number(value.limit);
      const skip = (page - 1) * limit;

      const [total, docs] = await Promise.all([
        MediaAsset.countDocuments(filter),
        MediaAsset.find(filter).sort({ cloudinaryCreatedAt: -1, createdAt: -1 }).skip(skip).limit(limit)
      ]);

      let storeInfo = null;
      try {
        const raw = await getStoreInfo(config.salla, req.merchantAccessToken);
        storeInfo = normalizeSallaStoreInfo(raw);
      } catch (err) {
        void err;
      }

      return res.json({
        ok: true,
        merchant: {
          merchantId,
          appStatus: String(req.merchant?.appStatus || ""),
          createdAt: req.merchant?.createdAt ? new Date(req.merchant.createdAt).toISOString() : null,
          updatedAt: req.merchant?.updatedAt ? new Date(req.merchant.updatedAt).toISOString() : null
        },
        store: {
          storeId,
          info: storeInfo
        },
        storeId,
        page,
        limit,
        total,
        items: docs.map(serializeMediaAsset)
      });
    } catch (err) {
      return next(err);
    }
  });

  const mediaSyncBodySchema = Joi.object({
    resourceType: Joi.string().trim().valid("image", "video", "raw", "all").default("all"),
    maxResults: Joi.number().integer().min(1).max(500).default(100)
  }).required();

  router.post("/media/sync", merchantAuth(config), async (req, res, next) => {
    try {
      const { error, value } = mediaSyncBodySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
      if (error) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: error.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      const { cloudName, apiKey, apiSecret, folderPrefix } = requireCloudinaryConfig();
      const merchantId = String(req.merchant?.merchantId || "").trim();
      const storeId = merchantId;
      const folder = mediaFolderForMerchant(folderPrefix, merchantId);

      let storeInfo = null;
      try {
        const raw = await getStoreInfo(config.salla, req.merchantAccessToken);
        storeInfo = normalizeSallaStoreInfo(raw);
      } catch (err) {
        void err;
      }

      const types = value.resourceType === "all" ? ["image", "video"] : [String(value.resourceType)];
      const maxResults = Number(value.maxResults);

      const upserted = [];
      const errors = [];

      for (const resourceType of types) {
        let remaining = maxResults - upserted.length;
        if (remaining <= 0) break;

        let nextCursor = null;
        while (remaining > 0) {
          const payload = {
            expression: `folder:${folder} AND resource_type:${resourceType}`,
            max_results: Math.min(100, remaining)
          };
          if (nextCursor) payload.next_cursor = nextCursor;

          let resp = null;
          try {
            resp = await axios.post(`https://api.cloudinary.com/v1_1/${cloudName}/resources/search`, payload, {
              auth: { username: apiKey, password: apiSecret },
              timeout: 15000
            });
          } catch (e) {
            errors.push({ resourceType, message: String(e?.response?.data?.error?.message || e?.message || e) });
            break;
          }

          const resources = Array.isArray(resp?.data?.resources) ? resp.data.resources : [];
          for (const r of resources) {
            const createdAt = r.created_at ? new Date(String(r.created_at)) : null;
            const cloudinaryCreatedAt = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null;

            const contextObj = r.context && typeof r.context === "object" ? r.context : null;
            const ctx = contextObj && typeof contextObj.custom === "object" ? contextObj.custom : contextObj;

            const doc = await MediaAsset.findOneAndUpdate(
              { storeId, publicId: String(r.public_id), deletedAt: null },
              {
                $set: {
                  merchantId,
                  storeId,
                  storeSallaId: storeInfo?.id || null,
                  storeName: storeInfo?.name || null,
                  storeDomain: storeInfo?.domain || null,
                  storeUrl: storeInfo?.url || null,
                  resourceType: String(r.resource_type),
                  publicId: String(r.public_id),
                  assetId: r.asset_id ? String(r.asset_id) : null,
                  folder: r.folder ? String(r.folder) : null,
                  originalFilename: r.original_filename ? String(r.original_filename) : null,
                  format: r.format ? String(r.format) : null,
                  bytes: r.bytes != null ? Number(r.bytes) : null,
                  width: r.width != null ? Number(r.width) : null,
                  height: r.height != null ? Number(r.height) : null,
                  duration: r.duration != null ? Number(r.duration) : null,
                  url: r.url ? String(r.url) : null,
                  secureUrl: r.secure_url ? String(r.secure_url) : null,
                  thumbnailUrl: r.secure_url ? String(r.secure_url) : null,
                  tags: Array.isArray(r.tags) ? r.tags.map((t) => String(t)).filter(Boolean) : [],
                  context: ctx || null,
                  cloudinaryCreatedAt,
                  cloudinary: r
                }
              },
              { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            upserted.push(doc);
            remaining -= 1;
            if (remaining <= 0) break;
          }

          nextCursor = String(resp?.data?.next_cursor || "").trim() || null;
          if (!nextCursor || !resources.length || remaining <= 0) break;
        }
      }

      return res.json({
        ok: true,
        storeId,
        folder,
        requested: maxResults,
        synced: upserted.length,
        errors
      });
    } catch (err) {
      return next(err);
    }
  });

  const mediaDeleteParamsSchema = Joi.object({
    id: Joi.string().trim().min(10).required()
  });

  router.delete("/media/assets/:id", merchantAuth(config), validate(mediaDeleteParamsSchema, "params"), async (req, res, next) => {
    try {
      const { cloudName, apiKey, apiSecret } = requireCloudinaryConfig();
      const merchantId = String(req.merchant?.merchantId || "").trim();
      const storeId = merchantId;
      const id = String(req.params.id);

      const asset = await MediaAsset.findOne({ _id: id, storeId, deletedAt: null });
      if (!asset) throw new ApiError(404, "Not found", { code: "NOT_FOUND" });

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = cloudinarySign({ public_id: String(asset.publicId), timestamp }, apiSecret);

      const url = `https://api.cloudinary.com/v1_1/${cloudName}/${String(asset.resourceType)}/destroy`;
      const body = new URLSearchParams();
      body.set("public_id", String(asset.publicId));
      body.set("api_key", apiKey);
      body.set("timestamp", String(timestamp));
      body.set("signature", signature);

      await axios.post(url, body.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 15000
      });

      asset.deletedAt = new Date();
      await asset.save();

      return res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });

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

  const proxyMediaAssetsQuerySchema = Joi.object({
    merchantId: Joi.string().trim().min(1).max(80).required(),
    resourceType: Joi.string().trim().valid("image", "video", "raw"),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(60).default(24),
    token: Joi.string().trim().min(10),
    signature: Joi.string().trim().min(8),
    hmac: Joi.string().trim().min(8)
  })
    .or("signature", "hmac", "token")
    .unknown(true);

  router.get("/proxy/media/assets", async (req, res, next) => {
    try {
      const { error, value } = proxyMediaAssetsQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: false });
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

      const storeId = String(value.merchantId);
      const filter = { storeId, deletedAt: null };
      if (value.resourceType) filter.resourceType = String(value.resourceType);

      const page = Number(value.page);
      const limit = Number(value.limit);
      const skip = (page - 1) * limit;

      const [total, docs] = await Promise.all([
        MediaAsset.countDocuments(filter),
        MediaAsset.find(filter).sort({ cloudinaryCreatedAt: -1, createdAt: -1 }).skip(skip).limit(limit)
      ]);

      return res.json({
        ok: true,
        merchantId: storeId,
        page,
        limit,
        total,
        items: docs.map(serializeMediaAsset)
      });
    } catch (err) {
      return next(err);
    }
  });

  const proxyMediaSignatureQuerySchema = Joi.object({
    merchantId: Joi.string().trim().min(1).max(80).required(),
    token: Joi.string().trim().min(10),
    signature: Joi.string().trim().min(8),
    hmac: Joi.string().trim().min(8)
  })
    .or("signature", "hmac", "token")
    .unknown(true);

  router.post("/proxy/media/signature", async (req, res, next) => {
    try {
      const { error: qErr, value: qValue } = proxyMediaSignatureQuerySchema.validate(req.query, {
        abortEarly: false,
        stripUnknown: false
      });
      if (qErr) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: qErr.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      const { error: bErr, value: bValue } = mediaSignatureBodySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
      if (bErr) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: bErr.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      ensureValidProxyAuth(qValue, qValue.merchantId);

      const merchant = await findMerchantByMerchantId(String(qValue.merchantId));
      if (!merchant) throw new ApiError(404, "Merchant not found", { code: "MERCHANT_NOT_FOUND" });
      if (merchant.appStatus !== "installed") throw new ApiError(403, "Merchant is not active", { code: "MERCHANT_INACTIVE" });

      const { cloudName, apiKey, apiSecret, folderPrefix } = requireCloudinaryConfig();
      const merchantId = String(qValue.merchantId);
      const folder = mediaFolderForMerchant(folderPrefix, merchantId);
      const timestamp = Math.floor(Date.now() / 1000);

      const context = bValue.context && typeof bValue.context === "object" ? bValue.context : {};
      const contextParts = [];
      for (const [k, v] of Object.entries(context)) {
        const key = String(k || "").trim();
        if (!key) continue;
        const val = String(v == null ? "" : v).trim();
        if (!val) continue;
        contextParts.push(`${key}=${val}`);
      }
      const contextStr = contextParts.length ? contextParts.join("|") : null;

      const tags = Array.isArray(bValue.tags) ? bValue.tags.map((t) => String(t).trim()).filter(Boolean) : [];
      const tagsStr = tags.length ? tags.join(",") : null;

      const paramsToSign = { folder, timestamp, ...(contextStr ? { context: contextStr } : {}), ...(tagsStr ? { tags: tagsStr } : {}) };
      const signature = cloudinarySign(paramsToSign, apiSecret);

      return res.json({
        ok: true,
        cloudinary: {
          cloudName,
          apiKey,
          resourceType: bValue.resourceType,
          uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${bValue.resourceType}/upload`,
          folder,
          timestamp,
          signature,
          ...(contextStr ? { context: contextStr } : {}),
          ...(tagsStr ? { tags: tagsStr } : {})
        }
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post("/proxy/media/assets", async (req, res, next) => {
    try {
      const { error: qErr, value: qValue } = proxyMediaSignatureQuerySchema.validate(req.query, {
        abortEarly: false,
        stripUnknown: false
      });
      if (qErr) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: qErr.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      const { error: bErr, value: bValue } = mediaRecordBodySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
      if (bErr) {
        throw new ApiError(400, "Validation error", {
          code: "VALIDATION_ERROR",
          details: bErr.details.map((d) => ({ message: d.message, path: d.path }))
        });
      }

      ensureValidProxyAuth(qValue, qValue.merchantId);

      const merchant = await findMerchantByMerchantId(String(qValue.merchantId));
      if (!merchant) throw new ApiError(404, "Merchant not found", { code: "MERCHANT_NOT_FOUND" });
      if (merchant.appStatus !== "installed") throw new ApiError(403, "Merchant is not active", { code: "MERCHANT_INACTIVE" });

      const merchantId = String(qValue.merchantId);
      const storeId = merchantId;
      const c = bValue.cloudinary || {};

      const createdAt = c.created_at ? new Date(String(c.created_at)) : null;
      const cloudinaryCreatedAt = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null;

      const contextObj = c.context && typeof c.context === "object" ? c.context : null;
      const ctx = contextObj && typeof contextObj.custom === "object" ? contextObj.custom : contextObj;

      let storeInfo = null;
      try {
        await ensureMerchantTokenFresh(merchant);
        const raw = await getStoreInfo(config.salla, merchant.accessToken);
        storeInfo = normalizeSallaStoreInfo(raw);
      } catch (err) {
        void err;
      }

      const doc = await MediaAsset.findOneAndUpdate(
        { storeId, publicId: String(c.public_id), deletedAt: null },
        {
          $set: {
            merchantId,
            storeId,
            storeSallaId: storeInfo?.id || null,
            storeName: storeInfo?.name || null,
            storeDomain: storeInfo?.domain || null,
            storeUrl: storeInfo?.url || null,
            resourceType: String(c.resource_type),
            publicId: String(c.public_id),
            assetId: c.asset_id ? String(c.asset_id) : null,
            folder: c.folder ? String(c.folder) : null,
            originalFilename: c.original_filename ? String(c.original_filename) : null,
            format: c.format ? String(c.format) : null,
            bytes: c.bytes != null ? Number(c.bytes) : null,
            width: c.width != null ? Number(c.width) : null,
            height: c.height != null ? Number(c.height) : null,
            duration: c.duration != null ? Number(c.duration) : null,
            url: c.url ? String(c.url) : null,
            secureUrl: c.secure_url ? String(c.secure_url) : null,
            thumbnailUrl: c.secure_url ? String(c.secure_url) : null,
            tags: Array.isArray(c.tags) ? c.tags.map((t) => String(t)).filter(Boolean) : [],
            context: ctx || null,
            cloudinaryCreatedAt,
            cloudinary: c
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return res.json({ ok: true, asset: serializeMediaAsset(doc) });
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

  const proxyPopupBundlesQuerySchema = Joi.object({
    merchantId: Joi.string().trim().min(1).max(80).required(),
    trigger: Joi.string().valid("all", "home_load", "product_view", "product_exit", "cart_add", "cart_remove", "cart_view").required(),
    token: Joi.string().trim().min(10),
    signature: Joi.string().trim().min(8),
    hmac: Joi.string().trim().min(8)
  })
    .or("signature", "hmac", "token")
    .unknown(true);

  router.get("/proxy/bundles/popup", async (req, res, next) => {
    try {
      const { error, value } = proxyPopupBundlesQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: false });
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

      const trigger = String(value.trigger || "").trim();
      const triggers = trigger === "all" ? ["all"] : [trigger, "all"];

      const bundles = await bundleService.listBundles(String(value.merchantId), { status: "active", kind: "popup", popupTriggers: triggers });

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

      const ctx = { triggerProductId: null, triggerVariantId: null, singleVariantSnapshotByProductId: singleVariant.snapshotByProductId };
      const safeBundles = bundles.map((b) => serializeBundleForStorefront(b, combinedSnapshots, "", ctx));

      const inactiveVariantIds = Array.from(combinedSnapshots.values())
        .filter((s) => s?.isActive !== true)
        .map((s) => String(s?.variantId || "").trim())
        .filter(Boolean);

      return res.json({
        ok: true,
        merchantId: String(value.merchantId),
        trigger,
        bundles: safeBundles,
        validation: {
          missing: [...(componentReport.missing || []), ...(singleVariant?.report?.missing || [])],
          inactive: inactiveVariantIds
        }
      });
    } catch (err) {
      return next(err);
    }
  });

  const proxyAlsoBoughtBundlesQuerySchema = Joi.object({
    merchantId: Joi.string().trim().min(1).max(80).required(),
    placement: Joi.string().valid("all", "home", "product", "cart", "checkout").required(),
    token: Joi.string().trim().min(10),
    signature: Joi.string().trim().min(8),
    hmac: Joi.string().trim().min(8)
  })
    .or("signature", "hmac", "token")
    .unknown(true);

  router.get("/proxy/bundles/also-bought", async (req, res, next) => {
    try {
      const { error, value } = proxyAlsoBoughtBundlesQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: false });
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

      const placement = String(value.placement || "").trim();
      const placements = placement === "all" ? ["all"] : [placement, "all"];

      const bundles = await bundleService.listBundles(String(value.merchantId), {
        status: "active",
        kind: "also_bought",
        alsoBoughtPlacements: placements
      });

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

      const ctx = { triggerProductId: null, triggerVariantId: null, singleVariantSnapshotByProductId: singleVariant.snapshotByProductId };
      const safeBundles = bundles.map((b) => serializeBundleForStorefront(b, combinedSnapshots, "", ctx));

      const inactiveVariantIds = Array.from(combinedSnapshots.values())
        .filter((s) => s?.isActive !== true)
        .map((s) => String(s?.variantId || "").trim())
        .filter(Boolean);

      return res.json({
        ok: true,
        merchantId: String(value.merchantId),
        placement,
        bundles: safeBundles,
        validation: {
          missing: [...(componentReport.missing || []), ...(singleVariant?.report?.missing || [])],
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
      .min(0)
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
      const cartKey = String(qValue.cartKey || "").trim() || undefined;
      if (!rawItems.length) {
        const issued = await issueOrReuseSpecialOfferForCartVerbose(
          config,
          merchant,
          merchant.accessToken,
          [],
          { applied: { totalDiscount: 0 } },
          { ttlHours: 24, cartKey, mode: "authoritative" }
        );
        const offer = issued?.offer || null;
        const offerAction = issued?.action || "clear";
        const hasDiscount = Boolean(offer && Number.isFinite(Number(offer?.discountAmount)) && Number(offer?.discountAmount) > 0);
        const discountAmount = hasDiscount ? Number(Number(offer.discountAmount).toFixed(2)) : 0;

        return res.json({
          ok: true,
          merchantId: String(qValue.merchantId),
          cartKey: cartKey || null,
          offerAction,
          hasDiscount,
          discountAmount,
          offerId: hasDiscount ? String(offer?.offerId || "") || null : null,
          offerIssueFailed: false,
          offerIssueDetails: null,
          banner: hasDiscount
            ? {
                title: "خصم الباقة اتفعل",
                cta: "تم تفعيل الخصم",
                bannerColor: "#16a34a",
                badgeColor: "#16a34a",
                offerId: String(offer?.offerId || "") || null,
                discountAmount,
                autoApply: true
              }
            : null,
          applied: { totalDiscount: 0, matchedProductIds: [], bundles: [] },
          validation: {
            missing: [],
            inactive: [],
            messages: [{ level: "info", code: "CART_EMPTY", message: "Cart has no items." }]
          }
        });
      }
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
      const issued = await issueOrReuseSpecialOfferForCartVerbose(config, merchant, merchant.accessToken, items, evaluation, {
        ttlHours: 24,
        cartKey,
        mode: "authoritative"
      });
      const offer = issued?.offer || null;
      const offerAction = issued?.action || null;

      const discountAmount = Number.isFinite(evaluation?.applied?.totalDiscount) ? Number(evaluation.applied.totalDiscount) : 0;
      const hasDiscount = Boolean(offer && discountAmount > 0);
      const offerIssueFailed = Boolean(offerAction !== "clear" && !offer && discountAmount > 0);
      const messages = [];
      if (!items.length) messages.push({ level: "info", code: "CART_EMPTY", message: "Cart has no items." });
      if (!hasDiscount && !offerIssueFailed) messages.push({ level: "info", code: "NO_BUNDLE_APPLIED", message: "No bundle discounts apply to this cart." });
      if (offerIssueFailed) messages.push({ level: "warn", code: "OFFER_ISSUE_FAILED", message: "Discount exists but offer could not be issued." });

      return res.json({
        ok: true,
        merchantId: String(qValue.merchantId),
        cartKey: cartKey || null,
        offerAction,
        hasDiscount,
        discountAmount: hasDiscount ? Number(discountAmount.toFixed(2)) : 0,
        offerId: hasDiscount ? String(offer.offerId || "") || null : null,
        offerIssueFailed,
        offerIssueDetails: offerIssueFailed ? issued?.failure || null : null,
        banner: hasDiscount
          ? {
            title: "خصم الباقة اتفعل",
            cta: "تم تفعيل الخصم",
            bannerColor: "#16a34a",
            badgeColor: "#16a34a",
            offerId: String(offer.offerId || "") || null,
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

      const allowedProductIds = new Set(
        (Array.isArray(bundle?.components) ? bundle.components : [])
          .map((c) => String(c?.variantId || "").trim())
          .map((vid) => {
            const pid = parseProductRefVariantId(vid);
            if (pid) return pid;
            const snap = combinedSnapshots.get(vid);
            return String(snap?.productId || "").trim() || null;
          })
          .filter(Boolean)
      );

      for (const it of items) {
        const snap = combinedSnapshots.get(String(it.variantId));
        const pid = String(snap?.productId || "").trim() || null;
        if (!pid || !allowedProductIds.has(pid)) {
          throw new ApiError(400, "Invalid item for bundle", { code: "BUNDLE_ITEM_INVALID" });
        }
      }

      const evaluation = { applied: { totalDiscount: 0, matchedProductIds: [], rule: null } };
      let discountAmount = 0;

      if (kind === "quantity_discount") {
        const draft = bundleService.evaluateBundleDraft(bundle, items, combinedSnapshots);
        const appliedRule = (() => {
          const keys = new Set();
          const rules = [];
          for (const app of Array.isArray(draft?.applications) ? draft.applications : []) {
            const r = app?.appliedRule;
            if (!r) continue;
            const type = String(r.type || "").trim();
            const value = Number(r.value);
            if (!type || !Number.isFinite(value) || value < 0) continue;
            const key = `${type}:${value}`;
            if (keys.has(key)) continue;
            keys.add(key);
            rules.push({ type, value });
          }
          return rules.length === 1 ? rules[0] : null;
        })();

        evaluation.applied = {
          totalDiscount: draft?.applied ? Number(draft.discountAmount || 0) : 0,
          matchedProductIds: Array.isArray(draft?.matchedProductIds) ? draft.matchedProductIds : [],
          rule: appliedRule,
          bundles: [
            {
              bundleId: String(bValue.bundleId),
              discountAmount: draft?.applied ? Number(draft.discountAmount || 0) : 0
            }
          ]
        };
        discountAmount = Number.isFinite(evaluation?.applied?.totalDiscount) ? Number(evaluation.applied.totalDiscount) : 0;
      } else {
        const subtotal = items.reduce((acc, it) => {
          const snap = combinedSnapshots.get(String(it.variantId));
          const unit = snap?.price == null ? null : Number(snap.price);
          const qty = Math.max(1, Math.floor(Number(it.quantity || 1)));
          if (unit == null || !Number.isFinite(unit) || unit < 0) return acc;
          return acc + unit * qty;
        }, 0);
        const offer = bundle?.rules || {};
        const computedDiscount = kind === "products_no_discount" ? 0 : calcDiscountAmount(offer, subtotal);
        discountAmount = Number.isFinite(computedDiscount) && computedDiscount > 0 ? Number(computedDiscount) : 0;
        const matchedProductIds = Array.from(
          new Set(
            items
              .map((it) => {
                const snap = combinedSnapshots.get(String(it.variantId));
                return String(snap?.productId || "").trim() || null;
              })
              .filter(Boolean)
          )
        );
        const type = String(offer?.type || "").trim() || null;
        const value = Number(offer?.value ?? 0);
        evaluation.applied = {
          totalDiscount: Number(discountAmount.toFixed(2)),
          matchedProductIds,
          rule: type && Number.isFinite(value) && value >= 0 ? { type, value } : null,
          bundles: [
            {
              bundleId: String(bValue.bundleId),
              discountAmount: Number(discountAmount.toFixed(2))
            }
          ]
        };
      }

      const shouldIssueOffer = kind !== "products_no_discount" && discountAmount > 0;
      const cartKey = String(qValue.cartKey || "").trim() || undefined;
      // Use 'authoritative' mode to replace any existing offer with the current bundle's discount
      // (not 'incremental' which would merge/accumulate with old discounts)
      const issued = shouldIssueOffer
        ? await issueOrReuseSpecialOfferForCartVerbose(config, merchant, merchant.accessToken, items, evaluation, { ttlHours: 24, cartKey, mode: "authoritative" })
        : { offer: null, failure: { reason: "OFFER_DISABLED" } };

      const offer = issued?.offer || null;
      const offerAction = issued?.action || null;
      const hasDiscount = Boolean(offer && discountAmount > 0);
      const offerIssueFailed = Boolean(shouldIssueOffer && offerAction !== "clear" && !offer && discountAmount > 0);

      return res.json({
        ok: true,
        merchantId: String(qValue.merchantId),
        cartKey: cartKey || null,
        offerAction,
        bundleId: String(bValue.bundleId),
        kind,
        hasDiscount,
        discountAmount: hasDiscount ? Number(discountAmount.toFixed(2)) : 0,
        offerId: hasDiscount ? String(offer.offerId || "") || null : null,
        offerIssueFailed,
        offerIssueDetails: offerIssueFailed ? issued?.failure || null : null,
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
