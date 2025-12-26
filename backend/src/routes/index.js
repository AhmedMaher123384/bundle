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
const { issueOrReuseCouponForCart } = require("../services/cartCoupon.service");
const { hmacSha256, sha256Hex } = require("../utils/hash");
const { Buffer } = require("buffer");

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

        let outVariantId = variantId;
        let snap = variantSnapshots?.get ? variantSnapshots.get(variantId) : null;
        if (isProductRef) {
          const triggerProductId = String(ctx?.triggerProductId || "").trim();
          const triggerVariantId = String(ctx?.triggerVariantId || "").trim();
          if (isBase && triggerVariantId && refProductId && triggerProductId && refProductId === triggerProductId) {
            const s = variantSnapshots?.get ? variantSnapshots.get(triggerVariantId) : null;
            if (s && String(s?.productId || "").trim() === triggerProductId) {
              outVariantId = triggerVariantId;
              snap = s;
            }
          } else if (refProductId) {
            const resolved = ctx?.singleVariantSnapshotByProductId?.get ? ctx.singleVariantSnapshotByProductId.get(refProductId) : null;
            if (resolved) {
              outVariantId = String(resolved.variantId);
              snap = resolved;
            }
          }
        }

        const productId = String(snap?.productId || "").trim() || (isProductRef ? (refProductId || null) : null);
        const imageUrl = snap?.imageUrl ? String(snap.imageUrl).trim() || null : null;
        const price = snap?.price != null ? Number(snap.price) : null;
        return {
          variantId: outVariantId,
          productId,
          quantity,
          group: String(c?.group || "").trim() || null,
          isBase,
          imageUrl,
          price: Number.isFinite(price) ? price : null
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
    const badge =
      bestTier && bestTier.type === "percentage"
        ? `${bestTier.value}%`
        : bestTier && bestTier.type === "fixed"
          ? `${bestTier.value}`
          : type === "percentage"
            ? `${value}%`
            : type === "fixed"
              ? `${value}`
              : null;

    const bannerColor = type === "percentage" ? "#16a34a" : type === "bundle_price" ? "#7c3aed" : "#0ea5e9";
    const badgeColor = bannerColor;
    const title = badge ? `${name} - وفر ${badge}` : name;
    const cta = "أضف الباقة";
    return { title, cta, bannerColor, badgeColor };
  }

  function serializeBundleForStorefront(bundle, variantSnapshots, triggerProductId, ctx) {
    const components = normalizeComponentsForStorefront(bundle, variantSnapshots, ctx);
    const rules = bundle?.rules || {};
    const offer = {
      type: String(rules?.type || "").trim() || null,
      value: Number(rules?.value ?? 0),
      tiers: Array.isArray(rules?.tiers) ? rules.tiers : [],
      eligibility: rules?.eligibility || null,
      limits: rules?.limits || null
    };
    const pricing = computePricing(bundle, components);
    const display = computeDisplay(bundle, offer, pricing);
    return {
      id: String(bundle?._id),
      triggerProductId: String(triggerProductId || bundle?.triggerProductId || "").trim(),
      title: display.title,
      cta: display.cta,
      bannerColor: display.bannerColor,
      badgeColor: display.badgeColor,
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
          imageUrl: c.imageUrl ? String(c.imageUrl).trim() || null : null
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

  function buildStorefrontSnippetJs(merchantId, token) {
    return `(function(){try{var merchantId=${JSON.stringify(merchantId)};var token=${JSON.stringify(
      token
    )};var scriptSrc=(document.currentScript&&document.currentScript.src)||"";var debug=false;try{debug=new URL(scriptSrc).searchParams.get("debug")==="1"}catch(e){}function log(){if(!debug)return;try{console.log.apply(console,arguments)}catch(e){}}function warn(){if(!debug)return;try{console.warn.apply(console,arguments)}catch(e){}}function getBackendOrigin(){try{return new URL(scriptSrc).origin}catch(e){return""}}function findVariantId(){try{var url=new URL(window.location.href);var fromUrl=url.searchParams.get("variant_id")||url.searchParams.get("variantId")||url.searchParams.get("variant")||"";if(fromUrl)return String(fromUrl).trim();var el=document.querySelector('[name="variant_id"],[name="variantId"],[data-variant-id],input[name="variant_id"],select[name="variant_id"]');if(el){var v=el.getAttribute("data-variant-id")||el.value||"";v=String(v).trim();if(v)return v}var any=document.querySelector("[data-variant-id]");if(any){var a=String(any.getAttribute("data-variant-id")||"").trim();if(a)return a}return""}catch(e){return""}}function findProductId(){try{var path=String(window.location.pathname||"");var m=path.match(/\\/p(\\d+)(?:[/?#]|$)/);if(m&&m[1])return String(m[1]);var el=document.querySelector("[data-product-id],input[name=\\"product_id\\"],input[name=\\"productId\\"]");if(el){var v=el.getAttribute("data-product-id")||el.value||"";v=String(v).trim();if(v)return v}return""}catch(e){return""}}async function fetchJson(url,opts){var r=await fetch(url,opts);var t=await r.text();var j=null;try{j=t?JSON.parse(t):null}catch(e){throw new Error("Invalid JSON response")}if(!r.ok){var msg=(j&&j.message)||("HTTP "+r.status);var err=new Error(msg);err.status=r.status;err.details=j;throw err}return j}function buildUrl(path,params){var origin=getBackendOrigin();if(!origin)return null;var u=new URL(origin+path);for(var k in (params||{})){if(!Object.prototype.hasOwnProperty.call(params,k))continue;var v=params[k];if(v==null||v==="")continue;u.searchParams.set(k,String(v))}u.searchParams.set("merchantId",merchantId);u.searchParams.set("token",token);return u}async function getProductBundlesByVariantId(variantId){var v=String(variantId||"").trim();if(!v)return null;var u=buildUrl("/api/proxy/bundles/product",{variantId:v});if(!u)return null;return fetchJson(u.toString())}async function getProductBundlesByProductId(productId){var p=String(productId||"").trim();if(!p)return null;var u=buildUrl("/api/proxy/bundles/for-product",{productId:p});if(!u)return null;return fetchJson(u.toString())}async function getCartBanner(items){var payload={items:Array.isArray(items)?items:[]};if(!payload.items.length)return null;var u=buildUrl("/api/proxy/cart/banner",{});if(!u)return null;return fetchJson(u.toString(),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})}function ensureStyles(){if(document.getElementById("bundle-app-style"))return;var s=document.createElement("style");s.id="bundle-app-style";s.textContent='.bundle-app-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;border-radius:14px;padding:12px 14px;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,.18)}.bundle-app-row{display:flex;gap:10px;align-items:center;justify-content:space-between}.bundle-app-title{font-size:14px;font-weight:700;line-height:1.2}.bundle-app-sub{font-size:12px;opacity:.9;margin-top:2px}.bundle-app-btn{border:0;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.18);color:#fff}.bundle-app-btn:disabled{opacity:.6;cursor:not-allowed}';document.head.appendChild(s)}function renderProductBanner(bundle){ensureStyles();var id="bundle-app-banner";var root=document.getElementById(id);if(!root){root=document.createElement("div");root.id=id;document.body.appendChild(root)}root.className="bundle-app-banner";root.style.background=String(bundle&&bundle.bannerColor||"#0ea5e9");var title=String(bundle&&bundle.title||"");var cta=String(bundle&&bundle.cta||"أضف الباقة");var html='<div class="bundle-app-row"><div><div class="bundle-app-title"></div><div class="bundle-app-sub"></div></div><button class="bundle-app-btn" type="button"></button></div>';root.innerHTML=html;root.querySelector(".bundle-app-title").textContent=title;root.querySelector(".bundle-app-sub").textContent="";var btn=root.querySelector(".bundle-app-btn");btn.textContent=cta;btn.onclick=async function(){try{btn.disabled=true;var items=(bundle&&bundle.bundleItems)||[];for(var i=0;i<items.length;i++){var it=items[i]||{};var pid=Number(it.productId);var qty=Math.max(1,Math.floor(Number(it.quantity||1)));if(!Number.isFinite(pid)||pid<=0)continue;if(window.salla&&window.salla.cart&&typeof window.salla.cart.addItem==="function"){await window.salla.cart.addItem({id:pid,quantity:qty})}}btn.disabled=false}catch(e){btn.disabled=false;warn("bundle-app: add-to-cart failed",e&&((e.details)||e.message||e))}}}function clearProductBanner(){var root=document.getElementById("bundle-app-banner");if(root)root.remove()}async function refreshProduct(){try{var variantId=findVariantId();var productId=findProductId();log("bundle-app: ids",{"variantId":variantId,"productId":productId});var res=null;if(variantId){res=await getProductBundlesByVariantId(variantId)}else if(productId){res=await getProductBundlesByProductId(productId)}else{clearProductBanner();return}var bundles=(res&&res.bundles)||[];if(!bundles.length){clearProductBanner();return}renderProductBanner(bundles[0])}catch(e){warn("bundle-app: refresh failed",e&&((e.details)||e.message||e));clearProductBanner()}}function initAuto(){var inited=false;function start(){if(inited)return;inited=true;refreshProduct();setInterval(refreshProduct,30000)}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",start)}else{start()}}window.BundleApp=window.BundleApp||{};window.BundleApp.getProductBundlesByVariantId=getProductBundlesByVariantId;window.BundleApp.getProductBundlesByProductId=getProductBundlesByProductId;window.BundleApp.getCartBanner=getCartBanner;window.BundleApp.refreshProduct=refreshProduct;initAuto()}catch(e){}})();`;
  }

  void buildStorefrontSnippetJs;
  void buildStorefrontSnippetJsV2;

  function buildStorefrontSnippetJsV2(merchantId, token) {
    const parts = [];
    parts.push("(function(){");
    parts.push("var g=null;try{g=globalThis}catch(e){g=window}if(!g)g=window;");
    parts.push("g.BundleApp=g.BundleApp||{};");
    parts.push(`var merchantId=${JSON.stringify(merchantId)};`);
    parts.push(`var token=${JSON.stringify(token)};`);
    parts.push('var scriptSrc=(document.currentScript&&document.currentScript.src)||"";');
    parts.push(
      "if(!scriptSrc){try{var ss=document.getElementsByTagName(\"script\");for(var i=0;i<ss.length;i++){var s=ss[i];var src=(s&&s.src)||\"\";if(!src)continue;if(src.indexOf(\"/api/storefront/snippet.js\")!==-1&&src.indexOf(\"merchantId=\"+encodeURIComponent(merchantId))!==-1){scriptSrc=src;break}}}catch(e){}}"
    );
    parts.push("var debug=false;try{debug=new URL(scriptSrc).searchParams.get(\"debug\")===\"1\"}catch(e){}");
    parts.push("function log(){if(!debug)return;try{console.log.apply(console,arguments)}catch(e){}}");
    parts.push("function warn(){if(!debug)return;try{console.warn.apply(console,arguments)}catch(e){}}");
    parts.push("function getBackendOrigin(){try{return new URL(scriptSrc).origin}catch(e){return\"\"}}");
    parts.push(
      "function findVariantId(){try{var url=new URL(window.location.href);var fromUrl=url.searchParams.get(\"variant_id\")||url.searchParams.get(\"variantId\")||url.searchParams.get(\"variant\")||\"\";if(fromUrl)return String(fromUrl).trim();var el=document.querySelector('[name=\"variant_id\"],[name=\"variantId\"],[data-variant-id],input[name=\"variant_id\"],select[name=\"variant_id\"]');if(el){var v=el.getAttribute(\"data-variant-id\")||el.value||\"\";v=String(v).trim();if(v)return v}var any=document.querySelector(\"[data-variant-id]\");if(any){var a=String(any.getAttribute(\"data-variant-id\")||\"\").trim();if(a)return a}return\"\"}catch(e){return\"\"}}"
    );
    parts.push(
      "function findProductId(){try{var path=String(window.location.pathname||\"\");var m=path.match(/\\/p(\\d+)(?:[/?#]|$)/);if(m&&m[1])return String(m[1]);var el=document.querySelector(\"[data-product-id],input[name=\\\"product_id\\\"],input[name=\\\"productId\\\"]\");if(el){var v=el.getAttribute(\"data-product-id\")||el.value||\"\";v=String(v).trim();if(v)return v}return\"\"}catch(e){return\"\"}}"
    );
    parts.push(
      "async function fetchJson(url,opts){var r=await fetch(url,opts);var t=await r.text();var j=null;try{j=t?JSON.parse(t):null}catch(e){throw new Error(\"Invalid JSON response\")}if(!r.ok){var msg=(j&&j.message)||(\"HTTP \"+r.status);var err=new Error(msg);err.status=r.status;err.details=j;throw err}return j}"
    );
    parts.push(
      "function buildUrl(path,params){var origin=getBackendOrigin();if(!origin)return null;var u=new URL(origin+path);for(var k in (params||{})){if(!Object.prototype.hasOwnProperty.call(params,k))continue;var v=params[k];if(v==null||v===\"\")continue;u.searchParams.set(k,String(v))}u.searchParams.set(\"merchantId\",merchantId);u.searchParams.set(\"token\",token);return u.toString()}"
    );
    parts.push(
      "async function getProductBundlesByVariantId(variantId){var v=String(variantId||\"\").trim();if(!v)return null;var u=buildUrl(\"/api/proxy/bundles/product\",{variantId:v});if(!u)return null;return fetchJson(u)}"
    );
    parts.push(
      "async function getProductBundlesByProductId(productId){var p=String(productId||\"\").trim();if(!p)return null;var u=buildUrl(\"/api/proxy/bundles/for-product\",{productId:p});if(!u)return null;return fetchJson(u)}"
    );
    parts.push(
      "async function getCartBanner(items){var payload={items:Array.isArray(items)?items:[]};if(!payload.items.length)return null;var body=JSON.stringify(payload);var u=buildUrl(\"/api/proxy/cart/banner\",{});if(!u)return null;return fetchJson(u,{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:body})}"
    );
    parts.push("var selectedTierByBundle={};var messageByBundle={};");
    parts.push(
      "function ensureStyles(){if(document.getElementById(\"bundle-app-style\"))return;var s=document.createElement(\"style\");s.id=\"bundle-app-style\";s.textContent='.bundle-app-container{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}.bundle-app-banner--inline{position:relative;display:block;width:100%;margin:12px 0;z-index:10}.bundle-app-banner--fixed{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999}.bundle-app-card{border-radius:14px;padding:12px 14px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.18)}.bundle-app-card+.bundle-app-card{margin-top:10px}.bundle-app-row{display:flex;gap:10px;align-items:center;justify-content:space-between}.bundle-app-title{font-size:14px;font-weight:800;line-height:1.2}.bundle-app-sub{font-size:12px;opacity:.95;margin-top:6px;line-height:1.3}.bundle-app-muted{opacity:.9}.bundle-app-btn{border:0;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:800;cursor:pointer;background:rgba(255,255,255,.18);color:#fff}.bundle-app-btn:disabled{opacity:.6;cursor:not-allowed}.bundle-app-tiers{margin-top:10px;display:flex;flex-direction:column;gap:6px}.bundle-app-tier{display:flex;justify-content:space-between;gap:10px;background:rgba(255,255,255,.12);border-radius:12px;padding:8px 10px;font-size:12px;line-height:1.2;cursor:pointer;user-select:none;transition:background .12s ease,transform .12s ease}.bundle-app-tier:hover{background:rgba(255,255,255,.18)}.bundle-app-tier--selected{background:rgba(255,255,255,.22);outline:2px solid rgba(255,255,255,.65)}.bundle-app-tier:active{transform:scale(.99)}.bundle-app-tier strong{font-weight:800}.bundle-app-items{margin-top:8px;font-size:12px;opacity:.95;line-height:1.35}.bundle-app-msg{margin-top:8px;font-size:12px;opacity:.95;line-height:1.35}';document.head.appendChild(s)}"
    );
    parts.push(
      "function findBannerMount(){try{var priceSelectors=['[data-testid=\"product-price\"]','[data-testid=\"product-price-value\"]','[class*=\"product-price\"]','[class*=\"price\"]','[data-price]','.price','.product-price','.salla-product-price'];for(var i=0;i<priceSelectors.length;i++){var el=document.querySelector(priceSelectors[i]);if(el)return{el:el,where:\"after\"}}var btnSelectors=['[data-testid=\"add-to-cart\"]','button[name=\"add-to-cart\"]','button[type=\"submit\"]','.salla-add-to-cart-button','.add-to-cart'];for(var j=0;j<btnSelectors.length;j++){var b=document.querySelector(btnSelectors[j]);if(b)return{el:b,where:\"before\"}}return null}catch(e){return null}}"
    );
    parts.push(
      "function mountBanner(root){try{var m=findBannerMount();if(m&&m.el&&m.el.parentNode){root.className=\"bundle-app-container bundle-app-banner--inline\";if(m.where===\"before\"){m.el.parentNode.insertBefore(root,m.el)}else{m.el.parentNode.insertBefore(root,m.el.nextSibling)}return true}}catch(e){}root.className=\"bundle-app-container bundle-app-banner--fixed\";if(!root.parentNode||root.parentNode!==document.body)document.body.appendChild(root);return false}"
    );
    parts.push(
      "function escHtml(input){var s=String(input==null?\"\":input);return s.replace(/[&<>\"']/g,function(ch){return ch===\"&\"?\"&amp;\":ch===\"<\"?\"&lt;\":ch===\">\"?\"&gt;\":ch==='\"'?\"&quot;\":\"&#39;\"})}"
    );
    parts.push(
      "function fmtNum(n){var x=Number(n);if(!Number.isFinite(x))return\"—\";try{return x.toLocaleString(\"ar-SA\")}catch(e){return String(x)}}"
    );
    parts.push(
      "function fmtMoney(n){var x=Number(n);if(!Number.isFinite(x))return\"—\";var v=Math.round(x*100)/100;var s;try{s=v.toLocaleString(\"ar-SA\",{minimumFractionDigits:v%1?2:0,maximumFractionDigits:2})}catch(e){s=String(v)}return s+\" ر.س\"}"
    );
    parts.push(
      "function pctFrom(orig,final){var o=Number(orig),f=Number(final);if(!Number.isFinite(o)||!Number.isFinite(f)||o<=0)return null;var p=(1-(f/o))*100;return Math.max(0,Math.round(p))}"
    );
    parts.push(
      "function normalizeTitle(raw){var title=String(raw||\"\");if(!title||title===\"Bundle\")title=\"باقة\";try{title=title.replace(/^Bundle\\s*-\\s*/i,\"باقة - \")}catch(e){}return title}"
    );
    parts.push(
      "function buildItemsText(bundle,baseQty){var comps=(bundle&&bundle.components)||[];if(!Array.isArray(comps)||!comps.length){comps=(bundle&&bundle.bundleItems)||[]}if(!Array.isArray(comps)||!comps.length)return\"\";var products=0;var totalQty=0;for(var i=0;i<comps.length;i++){var c=comps[i]||{};var pid=String(c.productId||\"\").trim();if(!pid)continue;products++;var isBase=Boolean(c.isBase);var q=isBase?Math.max(1,Math.floor(Number(baseQty||1))):Math.max(1,Math.floor(Number(c.quantity||1)));totalQty+=q}return \"عدد المنتجات: \"+fmtNum(products)+\" • إجمالي القطع: \"+fmtNum(totalQty)}"
    );
    parts.push("function getDefaultMinQty(bundle){return 1}");
    parts.push(
      "function pickMinQty(bundle,idx){var v=Number(selectedTierByBundle[idx]);if(Number.isFinite(v)&&v>=1)return Math.floor(v);return getDefaultMinQty(bundle)}"
    );
    parts.push(
      "function buildTierRows(bundle,bundleIndex,selectedQty){var p=bundle&&bundle.pricing;var rows=[];var tiers=p&&p.tiers;if(Array.isArray(tiers)&&tiers.length){for(var i=0;i<tiers.length;i++){var t=tiers[i]||{};rows.push({minQty:t.minQty,originalTotal:t.originalTotal,finalTotal:t.finalTotal,discountAmount:t.discountAmount})}}else if(p&&p.base){rows.push({minQty:1,originalTotal:p.base.originalTotal,finalTotal:p.base.finalTotal,discountAmount:p.base.discountAmount})}rows=rows.filter(function(r){return r&&Number(r.minQty)>=1});rows.sort(function(a,b){return a.minQty-b.minQty});var out='';for(var j=0;j<rows.length;j++){var r=rows[j];var pct=pctFrom(r.originalTotal,r.finalTotal);var left='عند '+fmtNum(r.minQty)+' قطع';var right='قبل '+fmtMoney(r.originalTotal)+' • بعد '+fmtMoney(r.finalTotal);var save=Number(r.discountAmount);if(Number.isFinite(save)&&save>0){right+=' • وفّرت '+fmtMoney(save);if(pct!=null)right+=' ('+fmtNum(pct)+'%)'}var cls='bundle-app-tier'+(Number(selectedQty)===Number(r.minQty)?' bundle-app-tier--selected':'');out+='<div class=\"'+cls+'\" data-bundle-index=\"'+bundleIndex+'\" data-tier-minqty=\"'+escHtml(r.minQty)+'\"><div><strong>'+escHtml(left)+'</strong></div><div class=\"bundle-app-muted\">'+escHtml(right)+'</div></div>'}return out}"
    );
    parts.push(
      "function buildCartItems(bundle,baseQty){var comps=(bundle&&bundle.components)||[];if(!Array.isArray(comps)||!comps.length){comps=(bundle&&bundle.bundleItems)||[]}var out=[];for(var i=0;i<comps.length;i++){var c=comps[i]||{};var v=String(c.variantId||\"\").trim();var pid=String(c.productId||\"\").trim();var isBase=Boolean(c.isBase);var q=isBase?Math.max(1,Math.floor(Number(baseQty||1))):Math.max(1,Math.floor(Number(c.quantity||1)));if(v)out.push({variantId:v,productId:pid||null,quantity:q,isBase:isBase})}return out}"
    );
    parts.push(
      "async function tryApplyCoupon(code){var c=String(code||\"\").trim();if(!c)return false;function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}for(var attempt=0;attempt<6;attempt++){try{var cart=window.salla&&window.salla.cart;var applied=false;if(cart&&typeof cart.applyCoupon===\"function\"){await cart.applyCoupon(c);applied=true}else if(cart&&cart.coupon&&typeof cart.coupon.apply===\"function\"){await cart.coupon.apply(c);applied=true}else if(cart&&cart.coupon&&typeof cart.coupon.set===\"function\"){await cart.coupon.set(c);applied=true}else if(cart&&typeof cart.setCoupon===\"function\"){await cart.setCoupon(c);applied=true}else if(cart&&typeof cart.addCoupon===\"function\"){await cart.addCoupon(c);applied=true}else if(window.salla&&typeof window.salla.applyCoupon===\"function\"){await window.salla.applyCoupon(c);applied=true}else if(window.salla&&window.salla.coupon&&typeof window.salla.coupon.apply===\"function\"){await window.salla.coupon.apply(c);applied=true}if(applied)return true}catch(e){warn(\"bundle-app: coupon apply failed\",e&&((e.details)||e.message||e))}await sleep(400+attempt*250)}return false}"
    );
    parts.push(
      "function pendingCouponKey(){return \"bundle_app_pending_coupon:\"+String(merchantId||\"\")}"
    );
    parts.push(
      "function savePendingCoupon(code){try{var c=String(code||\"\").trim();if(!c)return;localStorage.setItem(pendingCouponKey(),c)}catch(e){}}"
    );
    parts.push(
      "async function applyPendingCoupon(){try{var k=pendingCouponKey();var c=localStorage.getItem(k)||localStorage.getItem(\"bundle_app_pending_coupon\");if(!c)return;var ok=await tryApplyCoupon(c);if(ok){localStorage.removeItem(k);try{localStorage.removeItem(\"bundle_app_pending_coupon\")}catch(e){}}}catch(e){}}"
    );
    parts.push(
      "async function addItemsToCart(items){var cart=window.salla&&window.salla.cart;if(!cart||typeof cart.addItem!==\"function\")throw new Error(\"Salla cart API not available\");for(var i=0;i<items.length;i++){var it=items[i]||{};var qty=Math.max(1,Math.floor(Number(it.quantity||1)));var vid=String(it.variantId||\"\").trim();if(!vid)throw new Error(\"Missing variant selection\");var skuNum=Number(vid);var skuId=(Number.isFinite(skuNum)&&skuNum>0)?skuNum:vid;try{await cart.addItem({id:skuId,quantity:qty});continue}catch(e){var pidStr=String(it.cartProductId||it.productId||\"\").trim();var pidNum=Number(pidStr);var opts=it&&it.cartOptions&&typeof it.cartOptions===\"object\"?it.cartOptions:null;if((!opts||!Object.keys(opts).length)&&typeof getCachedVariants===\"function\"&&pidStr){try{var c=await getCachedVariants(pidStr);for(var ci=0;ci<c.length;ci++){var cv=c[ci]||{};if(String(cv.variantId||\"\").trim()===vid){opts=cv.cartOptions||null;break}}}catch(e0){}}try{if(Number.isFinite(pidNum)&&pidNum>0){if(opts&&Object.keys(opts).length){await cart.addItem({id:pidNum,quantity:qty,options:opts});continue}await cart.addItem({id:pidNum,quantity:qty});continue}}catch(e2){if(typeof cart.quickAdd===\"function\"&&Number.isFinite(pidNum)&&pidNum>0){try{await cart.quickAdd(pidNum);continue}catch(e3){}}throw e2}}}}"
    );
    parts.push(
      "async function applyDiscountForCartItems(items){var payload=[];for(var i=0;i<items.length;i++){var it=items[i]||{};var v=String(it.variantId||\"\").trim();var q=Math.max(1,Math.floor(Number(it.quantity||1)));if(!v)continue;payload.push({variantId:v,quantity:q})}if(!payload.length)return null;return getCartBanner(payload)}"
    );
    parts.push(
      "function renderProductBanners(bundles){ensureStyles();var id=\"bundle-app-banner\";var root=document.getElementById(id);if(!root){root=document.createElement(\"div\");root.id=id}mountBanner(root);var arr=Array.isArray(bundles)?bundles:[];if(!arr.length){clearProductBanner();return}var html='';for(var i=0;i<arr.length;i++){var b=arr[i]||{};var color=String(b.bannerColor||\"#0ea5e9\");var title=normalizeTitle(b.title);if(title.indexOf('وفر ')!==-1&&title.indexOf('وفر حتى ')===-1){try{title=title.replace('وفر ','وفر حتى ')}catch(e){}}var selectedQty=pickMinQty(b,i);var itemsText=buildItemsText(b,selectedQty);var tiersHtml=buildTierRows(b,i,selectedQty);var msg=String(messageByBundle[i]||\"\");var cta=String(b.cta||\"أضف الباقة\");var btnLabel=cta;var hasTiers=Boolean(b&&b.pricing&&Array.isArray(b.pricing.tiers)&&b.pricing.tiers.length);if(hasTiers){btnLabel=cta+' ('+fmtNum(selectedQty)+' قطع)'}html+='<div class=\"bundle-app-card\" style=\"background:'+escHtml(color)+'\"><div class=\"bundle-app-row\"><div><div class=\"bundle-app-title\">'+escHtml(title)+'</div>'+(itemsText?('<div class=\"bundle-app-items\">'+escHtml(itemsText)+'</div>'):'')+(msg?('<div class=\"bundle-app-msg\">'+escHtml(msg)+'</div>'):'')+'</div><button class=\"bundle-app-btn\" type=\"button\" data-bundle-index=\"'+i+'\">'+escHtml(btnLabel)+'</button></div>'+(tiersHtml?('<div class=\"bundle-app-tiers\">'+tiersHtml+'</div>'):'')+'</div>'}root.innerHTML=html;var tierEls=root.querySelectorAll('.bundle-app-tier[data-tier-minqty][data-bundle-index]');for(var t=0;t<tierEls.length;t++){(function(el){el.onclick=function(){var bi=Number(el.getAttribute('data-bundle-index'));var mq=Number(el.getAttribute('data-tier-minqty'));if(Number.isFinite(bi)&&Number.isFinite(mq)&&mq>=1){selectedTierByBundle[bi]=Math.floor(mq);messageByBundle[bi]='';renderProductBanners(arr)}}})(tierEls[t])}var btns=root.querySelectorAll('button.bundle-app-btn[data-bundle-index]');for(var k=0;k<btns.length;k++){(function(btn){var idx=Number(btn.getAttribute('data-bundle-index'));btn.onclick=async function(){try{var bundle=arr[idx]||{};var selectedQty=pickMinQty(bundle,idx);var cartItems=buildCartItems(bundle,selectedQty);messageByBundle[idx]='جاري تجهيز الخصم...';renderProductBanners(arr);btn.disabled=true;var banner=await applyDiscountForCartItems(cartItems);var code=banner&&banner.couponCode;var has=Boolean(banner&&banner.hasDiscount&&code);messageByBundle[idx]='جاري إضافة الباقة...';renderProductBanners(arr);await addItemsToCart(cartItems);if(has){messageByBundle[idx]='جاري تطبيق الخصم...';renderProductBanners(arr);var applied=await tryApplyCoupon(code);if(applied){messageByBundle[idx]='تم تطبيق خصم الباقة ✓ (الكوبون: '+code+')'}else{savePendingCoupon(code);messageByBundle[idx]='تم إنشاء كوبون الخصم. افتح السلة لتطبيقه تلقائيًا: '+code}}else{messageByBundle[idx]='تمت إضافة الباقة. لم ينطبق خصم على هذه الباقة في السلة.'}btn.disabled=false;renderProductBanners(arr)}catch(e){btn.disabled=false;var em=\"\";try{em=String((e&&((e.details&&e.details.message)||e.message))||\"\").trim()}catch(x){}if(em&&em.length>140)em=em.slice(0,140);messageByBundle[idx]='حصل خطأ أثناء الإضافة أو تطبيق الخصم'+(em?(' ('+em+')'):'');warn(\"bundle-app: add/apply failed\",e&&((e.details)||e.message||e));renderProductBanners(arr)}}})(btns[k])}}"
    );
    parts.push("function clearProductBanner(){var root=document.getElementById(\"bundle-app-banner\");if(root)root.remove()}");
    parts.push(
      "async function refreshProduct(){try{var variantId=findVariantId();var productId=findProductId();log(\"bundle-app: ids\",{variantId:variantId,productId:productId});var res=null;if(variantId){res=await getProductBundlesByVariantId(variantId)}else if(productId){res=await getProductBundlesByProductId(productId)}else{clearProductBanner();return}var bundles=(res&&res.bundles)||[];if(!bundles.length){clearProductBanner();return}renderProductBanners(bundles)}catch(e){warn(\"bundle-app: refresh failed\",e&&((e.details)||e.message||e));clearProductBanner()}}"
    );
    parts.push(
      "function initOnce(){var inited=false;function start(){if(inited)return;inited=true;applyPendingCoupon();refreshProduct()}if(document.readyState===\"loading\"){document.addEventListener(\"DOMContentLoaded\",start)}else{start()}}"
    );
    parts.push("g.BundleApp.getProductBundlesByVariantId=getProductBundlesByVariantId;");
    parts.push("g.BundleApp.getProductBundlesByProductId=getProductBundlesByProductId;");
    parts.push("g.BundleApp.getProductBundles=getProductBundlesByVariantId;");
    parts.push("g.BundleApp.getCartBanner=getCartBanner;");
    parts.push("g.BundleApp.refreshProduct=refreshProduct;");
    parts.push(
      "g.BundleApp.debugIds=function(){return{scriptSrc:scriptSrc,origin:getBackendOrigin(),variantId:findVariantId(),productId:findProductId()}};"
    );
    parts.push(
      "g.BundleApp.renderTest=function(){renderProductBanners([{bannerColor:\"#16a34a\",title:\"باقة - اختبار (وفر 50%)\",cta:\"أضف الباقة\",components:[{variantId:\"111\",productId:\"154200631\",quantity:1,isBase:true}],offer:{type:\"percentage\",value:10,tiers:[{minQty:2,type:\"percentage\",value:10},{minQty:4,type:\"percentage\",value:30},{minQty:6,type:\"percentage\",value:50}]},pricing:{base:{originalTotal:3000,discountAmount:300,finalTotal:2700},tiers:[{minQty:2,originalTotal:6000,discountAmount:600,finalTotal:5400},{minQty:4,originalTotal:12000,discountAmount:3600,finalTotal:8400},{minQty:6,originalTotal:18000,discountAmount:9000,finalTotal:9000}]}}])};"
    );
    parts.push("initOnce();");
    parts.push("})();");
    return parts.join("");
  }

  function buildStorefrontSnippetJsManualBundles(merchantId, token) {
    const parts = [];
    parts.push("(function(){");
    parts.push("var g=null;try{g=globalThis}catch(e){g=window}if(!g)g=window;");
    parts.push("g.BundleApp=g.BundleApp||{};");
    parts.push(`var merchantId=${JSON.stringify(merchantId)};`);
    parts.push(`var token=${JSON.stringify(token)};`);
    parts.push('var scriptSrc=(document.currentScript&&document.currentScript.src)||"";');
    parts.push(
      "if(!scriptSrc){try{var ss=document.getElementsByTagName(\"script\");for(var i=0;i<ss.length;i++){var s=ss[i];var src=(s&&s.src)||\"\";if(!src)continue;if(src.indexOf(\"/api/storefront/snippet.js\")!==-1&&src.indexOf(\"merchantId=\"+encodeURIComponent(merchantId))!==-1){scriptSrc=src;break}}}catch(e){}}"
    );
    parts.push("var debug=false;try{debug=new URL(scriptSrc).searchParams.get(\"debug\")===\"1\"}catch(e){}");
    parts.push("function log(){if(!debug)return;try{console.log.apply(console,arguments)}catch(e){}}");
    parts.push("function warn(){if(!debug)return;try{console.warn.apply(console,arguments)}catch(e){}}");
    parts.push("function getBackendOrigin(){try{return new URL(scriptSrc).origin}catch(e){return\"\"}}");
    parts.push(
      "function findVariantId(){try{var url=new URL(window.location.href);var fromUrl=url.searchParams.get(\"variant_id\")||url.searchParams.get(\"variantId\")||url.searchParams.get(\"variant\")||\"\";if(fromUrl)return String(fromUrl).trim();var el=document.querySelector('[name=\"variant_id\"],[name=\"variantId\"],[data-variant-id],input[name=\"variant_id\"],select[name=\"variant_id\"]');if(el){var v=el.getAttribute(\"data-variant-id\")||el.value||\"\";v=String(v).trim();if(v)return v}var any=document.querySelector(\"[data-variant-id]\");if(any){var a=String(any.getAttribute(\"data-variant-id\")||\"\").trim();if(a)return a}return\"\"}catch(e){return\"\"}}"
    );
    parts.push(
      "function findProductId(){try{var path=String(window.location.pathname||\"\");var m=path.match(/\\/p(\\d+)(?:[/?#]|$)/);if(m&&m[1])return String(m[1]);var el=document.querySelector(\"[data-product-id],input[name=\\\"product_id\\\"],input[name=\\\"productId\\\"]\");if(el){var v=el.getAttribute(\"data-product-id\")||el.value||\"\";v=String(v).trim();if(v)return v}return\"\"}catch(e){return\"\"}}"
    );
    parts.push(
      "async function fetchJson(url,opts){var r=await fetch(url,opts);var t=await r.text();var j=null;try{j=t?JSON.parse(t):null}catch(e){throw new Error(\"Invalid JSON response\")}if(!r.ok){var msg=(j&&j.message)||(\"HTTP \"+r.status);var err=new Error(msg);err.status=r.status;err.details=j;throw err}return j}"
    );
    parts.push(
      "function buildUrl(path,params){var origin=getBackendOrigin();if(!origin)return null;var u=new URL(origin+path);for(var k in (params||{})){if(!Object.prototype.hasOwnProperty.call(params,k))continue;var v=params[k];if(v==null||v===\"\")continue;u.searchParams.set(k,String(v))}u.searchParams.set(\"merchantId\",merchantId);u.searchParams.set(\"token\",token);return u.toString()}"
    );
    parts.push(
      "async function getProductBundlesByVariantId(variantId){var v=String(variantId||\"\").trim();if(!v)return null;var u=buildUrl(\"/api/proxy/bundles/product\",{variantId:v});if(!u)return null;return fetchJson(u)}"
    );
    parts.push(
      "async function getProductBundlesByProductId(productId){var p=String(productId||\"\").trim();if(!p)return null;var u=buildUrl(\"/api/proxy/bundles/for-product\",{productId:p});if(!u)return null;return fetchJson(u)}"
    );
    parts.push(
      "async function requestApplyBundle(bundleId,items){var payload={bundleId:String(bundleId||\"\"),items:Array.isArray(items)?items:[]};var u=buildUrl(\"/api/proxy/bundles/apply\",{});if(!u)return null;return fetchJson(u,{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify(payload)})}"
    );
    parts.push(
      "async function getProductVariantsByProductId(productId){var p=String(productId||\"\").trim();if(!p)return null;var u=buildUrl(\"/api/proxy/products/variants\",{productId:p});if(!u)return null;return fetchJson(u)}"
    );
    parts.push("function isProductRef(variantId){return String(variantId||\"\").trim().indexOf(\"product:\")===0}");
    parts.push("var variantsCacheByProductId={};");
    parts.push(
      "async function getCachedVariants(productId){var pid=String(productId||\"\").trim();if(!pid)return[];if(Object.prototype.hasOwnProperty.call(variantsCacheByProductId,pid))return variantsCacheByProductId[pid]||[];var res=await getProductVariantsByProductId(pid);var vars=(res&&res.variants)||[];variantsCacheByProductId[pid]=Array.isArray(vars)?vars:[];return variantsCacheByProductId[pid]}"
    );
    parts.push(
      "function stringifyAttrs(attrs){try{if(!attrs||typeof attrs!==\"object\")return\"\";var parts=[];for(var k in attrs){if(!Object.prototype.hasOwnProperty.call(attrs,k))continue;var v=attrs[k];if(v==null)continue;var vs=String(v||\"\").trim();if(!vs)continue;parts.push(vs)}return parts.join(\" • \")}catch(e){return\"\"}}"
    );
    parts.push(
      "function variantLabel(v){var name=String(v&&v.name||\"\").trim();var attrs=stringifyAttrs(v&&v.attributes);var price=v&&v.price!=null?Number(v.price):null;var priceText=(Number.isFinite(price)&&price>=0)?(\" • \"+fmtMoney(price)):\"\";if(attrs&&name)return name+\" • \"+attrs+priceText;if(attrs)return attrs+priceText;if(name)return name+priceText;return \"فاريانت\"+priceText}"
    );
    parts.push(
      "function normHex(s){try{var x=String(s||\"\").trim();if(!x)return\"\";var m=x.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);if(!m)return\"\";return x.charAt(0)==='#'?x:('#'+x)}catch(e){return\"\"}}"
    );
    parts.push(
      "function escCssUrl(u){try{var s=String(u||\"\").trim();if(!s)return\"\";s=s.replace(/[\\n\\r\\t\\f\\\\\"'()<>]/g,\"\");return s}catch(e){return\"\"}}"
    );
    parts.push(
      "function pickVariantSwatch(v){try{var img=String(v&&v.imageUrl||\"\").trim();if(img)return{t:\"img\",v:img};var attrs=v&&v.attributes&&typeof v.attributes===\"object\"?v.attributes:null;if(attrs){for(var k in attrs){if(!Object.prototype.hasOwnProperty.call(attrs,k))continue;var hex=normHex(attrs[k]);if(hex)return{t:\"hex\",v:hex}}}var hex2=normHex(v&&v.name);if(hex2)return{t:\"hex\",v:hex2};return null}catch(e){return null}}"
    );
    parts.push(
      "function variantOptionInnerHtml(v){var sw=pickVariantSwatch(v);var out='';if(sw&&sw.t==='img'){var u=escCssUrl(sw.v);if(u){out+='<span class=\"bundle-app-variant-swatch is-image\" style=\"background-image:url(\\''+escHtml(u)+'\\')\"></span>'}}else if(sw&&sw.t==='hex'&&sw.v){out+='<span class=\"bundle-app-variant-swatch\" style=\"background:'+escHtml(sw.v)+'\"></span>'}out+='<span class=\"bundle-app-variant-text\">'+escHtml(variantLabel(v))+'</span>';return out}"
    );
    parts.push(
      "function openPickerModal(titleHtml,bodyHtml){var resolver=null;var wait=new Promise(function(r){resolver=r});var overlay=document.createElement(\"div\");overlay.id=\"bundle-app-modal\";overlay.style.position=\"fixed\";overlay.style.inset=\"0\";overlay.style.background=\"rgba(0,0,0,.45)\";overlay.style.zIndex=\"100000\";overlay.style.display=\"flex\";overlay.style.alignItems=\"center\";overlay.style.justifyContent=\"center\";overlay.style.padding=\"16px\";var card=document.createElement(\"div\");card.style.width=\"min(520px,100%)\";card.style.maxHeight=\"80vh\";card.style.overflow=\"auto\";card.style.background=\"#fff\";card.style.borderRadius=\"14px\";card.style.boxShadow=\"0 12px 40px rgba(0,0,0,.25)\";card.style.padding=\"12px\";card.innerHTML='<div style=\"display:flex;align-items:center;justify-content:space-between;gap:10px\"><div style=\"font-weight:900;font-size:14px\">'+titleHtml+'</div><button type=\"button\" data-action=\"close\" style=\"border:0;background:transparent;font-size:18px;line-height:1;cursor:pointer\">×</button></div><div style=\"margin-top:10px\">'+bodyHtml+'</div>';overlay.appendChild(card);function close(val){try{overlay.remove()}catch(e){}if(resolver){var r=resolver;resolver=null;r(val)}}overlay.addEventListener(\"click\",function(e){if(e.target===overlay)close(null)});var closeBtn=card.querySelector('button[data-action=\"close\"]');if(closeBtn)closeBtn.onclick=function(){close(null)};document.body.appendChild(overlay);return {overlay:overlay,card:card,close:close,wait:wait}}"
    );
    parts.push(
      "async function resolveProductRefItems(items,bundleId){var bid=String(bundleId||\"\").trim();var pre=(bid&&variantSelectionsByBundleId[bid]&&typeof variantSelectionsByBundleId[bid]===\"object\")?variantSelectionsByBundleId[bid]:null;var arr=Array.isArray(items)?items:[];var needs=[];var fixed=[];for(var i=0;i<arr.length;i++){var it=arr[i]||{};var v=String(it.variantId||\"\").trim();var qty=Math.max(1,Math.floor(Number(it.quantity||1)));var pid=String(it.productId||\"\").trim();if(isProductRef(v)){if(!pid)return null;needs.push({productId:pid,quantity:qty})}else{if(!v)continue;fixed.push({variantId:v,productId:pid||null,quantity:qty})}}if(!needs.length)return fixed;var units=[];var uniqPid={};for(var j=0;j<needs.length;j++){var n=needs[j];var pid2=String(n.productId);uniqPid[pid2]=true;for(var u=0;u<Number(n.quantity||0);u++){units.push({productId:pid2,key:pid2+\":\"+u})}}var pidList=Object.keys(uniqPid);var varsByPid={};for(var p=0;p<pidList.length;p++){var pid3=pidList[p];var vars=await getCachedVariants(pid3);varsByPid[pid3]=Array.isArray(vars)?vars:[];if(!varsByPid[pid3].length){varsByPid[pid3]=[{variantId:('product:'+pid3),productId:pid3,cartProductId:pid3,cartOptions:null,isActive:true,name:null,attributes:{},imageUrl:null,price:null}]}}var selectedByKey={};var pending=[];for(var k=0;k<units.length;k++){var unit=units[k];var vlist=(varsByPid[unit.productId]||[]).filter(function(x){return x&&x.isActive===true&&String(x.variantId||\"\").trim()});var preVal=pre?String(pre[unit.key]||\"\").trim():\"\";if(preVal){var ok=false;for(var z=0;z<vlist.length;z++){if(String(vlist[z]&&vlist[z].variantId||\"\").trim()===preVal){ok=true;break}}if(ok){selectedByKey[unit.key]=preVal;continue}}if(vlist.length===1){selectedByKey[unit.key]=String(vlist[0].variantId||\"\").trim()}else{pending.push(unit)}}if(pending.length){var body='';for(var x=0;x<pending.length;x++){var un=pending[x];var opts=(varsByPid[un.productId]||[]).filter(function(y){return y&&y.isActive===true&&String(y.variantId||\"\").trim()});var preVal2=pre?String(pre[un.key]||\"\").trim():\"\";if(preVal2)selectedByKey[un.key]=preVal2;body+='<div style=\"margin-bottom:10px;padding:10px;border:1px solid #e5e7eb;border-radius:12px\"><div style=\"font-weight:800;font-size:12px;margin-bottom:6px\">اختر الفاريانت (قطعة '+fmtNum(x+1)+')</div><select data-key=\"'+escHtml(un.key)+'\" style=\"width:100%;padding:10px;border-radius:10px;border:1px solid #d1d5db\">';body+='<option value=\"\">— اختر —</option>';for(var o=0;o<opts.length;o++){var vv=opts[o]||{};var vid=String(vv.variantId||\"\").trim();if(!vid)continue;body+='<option value=\"'+escHtml(vid)+'\"'+(preVal2&&preVal2===vid?' selected':'')+'>'+escHtml(variantLabel(vv))+'</option>'}body+='</select></div>'}body+='<div style=\"display:flex;gap:10px;justify-content:flex-end\"><button type=\"button\" data-action=\"cancel\" style=\"padding:10px 12px;border-radius:12px;border:1px solid #d1d5db;background:#fff;cursor:pointer\">إلغاء</button><button type=\"button\" data-action=\"confirm\" disabled style=\"padding:10px 12px;border-radius:12px;border:0;background:#111827;color:#fff;cursor:pointer;opacity:.6\">تأكيد</button></div>';var modal=openPickerModal('اختيار الفاريانت',body);if(!modal)return null;var card=modal.card;var confirm=card.querySelector('button[data-action=\"confirm\"]');var cancel=card.querySelector('button[data-action=\"cancel\"]');function recompute(){var selects=card.querySelectorAll('select[data-key]');var ok=true;for(var i2=0;i2<selects.length;i2++){var s=selects[i2];var val=String(s.value||\"\").trim();if(!val){ok=false;break}}if(confirm){confirm.disabled=!ok;confirm.style.opacity=ok?'1':'.6'}}card.addEventListener('change',function(e){var t=e&&e.target;if(!t||t.tagName!=='SELECT')return;var key=String(t.getAttribute('data-key')||\"\");if(!key)return;selectedByKey[key]=String(t.value||\"\").trim();recompute()});recompute();if(cancel)cancel.onclick=function(){modal.close(null)};if(confirm)confirm.onclick=function(){modal.close(true)};var done=await modal.wait;if(!done)return null}if(bid){var store=getBundleVariantSelectionMap(bid);if(store){for(var sk in selectedByKey){if(!Object.prototype.hasOwnProperty.call(selectedByKey,sk))continue;var sv=String(selectedByKey[sk]||\"\").trim();if(!sv)continue;store[sk]=sv}}}var metaByVid={};for(var m0=0;m0<pidList.length;m0++){var mp=pidList[m0];var ml=varsByPid[mp]||[];for(var m1=0;m1<ml.length;m1++){var mv=ml[m1]||{};var mid=String(mv.variantId||\"\").trim();if(!mid)continue;if(!metaByVid[mid])metaByVid[mid]=mv}}var count={};for(var kk in selectedByKey){if(!Object.prototype.hasOwnProperty.call(selectedByKey,kk))continue;var vid2=String(selectedByKey[kk]||\"\").trim();if(!vid2)continue;count[vid2]=(count[vid2]||0)+1}var out=fixed.slice();for(var vidKey in count){if(!Object.prototype.hasOwnProperty.call(count,vidKey))continue;var m=metaByVid[vidKey]||null;out.push({variantId:String(vidKey),productId:m&&m.productId?String(m.productId):null,cartProductId:m&&m.cartProductId?String(m.cartProductId):null,cartOptions:(m&&m.cartOptions)?m.cartOptions:null,quantity:Math.max(1,Math.floor(Number(count[vidKey]||1)))})}out.sort(function(a,b){return String(a.variantId).localeCompare(String(b.variantId))});return out}"
    );
    parts.push("var selectedBundleId=null;");
    parts.push("var lastTriggerProductId=null;");
    parts.push("var messageByBundleId={};");
    parts.push("var selectedTierByBundleId={};");
    parts.push("var applying=false;");
    parts.push("var variantSelectionsByBundleId={};");
    parts.push("var variantPickerCacheByBundleId={};");
    parts.push("var variantPickerPendingByBundleId={};");
    parts.push(
      "function getBundleVariantSelectionMap(bundleId){var bid=String(bundleId||\"\").trim();if(!bid)return null;var m=variantSelectionsByBundleId[bid];if(!m||typeof m!==\"object\")m={};variantSelectionsByBundleId[bid]=m;return m}"
    );
    parts.push(
      "function ensurePickerStyles(){if(document.getElementById(\"bundle-app-pickers-style\"))return;var s=document.createElement(\"style\");s.id=\"bundle-app-pickers-style\";s.textContent='.bundle-app-pickers{margin-top:10px;display:none;background:rgba(255,255,255,.14);border-radius:12px;padding:10px}.bundle-app-card--selected .bundle-app-pickers{display:block}.bundle-app-pickers-title{font-weight:900;font-size:12px;margin-bottom:8px}.bundle-app-picker-row{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}.bundle-app-picker-label{font-weight:900;font-size:12px}.bundle-app-picker-hint{font-size:12px;opacity:.95}.bundle-app-picker-status{font-size:12px;opacity:.95;margin-top:6px}.bundle-app-variant-options{display:flex;flex-wrap:wrap;gap:8px}.bundle-app-variant-btn{appearance:none;border:1px solid rgba(255,255,255,.6);background:rgba(255,255,255,.14);color:#fff;border-radius:999px;padding:8px 10px;font-size:12px;font-weight:900;cursor:pointer;line-height:1;display:inline-flex;align-items:center;gap:8px}.bundle-app-variant-btn.is-selected{background:rgba(255,255,255,.95);color:#111827;border-color:rgba(255,255,255,.95)}.bundle-app-variant-btn:disabled{opacity:.75;cursor:not-allowed}.bundle-app-variant-swatch{width:14px;height:14px;border-radius:999px;flex:0 0 14px;border:1px solid rgba(255,255,255,.75);background:rgba(255,255,255,.25);background-size:cover;background-position:center}.bundle-app-variant-text{line-height:1.15}';document.head.appendChild(s)}"
    );
    parts.push(
      "function bundleVariantSig(bundle){try{var items=normalizeItems(bundle);var parts=[];for(var i=0;i<items.length;i++){var it=items[i]||{};var v=String(it.variantId||\"\").trim();if(!isProductRef(v))continue;var pid=String(it.productId||\"\").trim();if(!pid)continue;var qty=Math.max(1,Math.floor(Number(it.quantity||1)));parts.push(pid+\"x\"+qty)}parts.sort();return parts.join(\"|\")}catch(e){return\"\"}}"
    );
    parts.push(
      "function bundleVariantUnits(bundle){var items=normalizeItems(bundle);var units=[];for(var i=0;i<items.length;i++){var it=items[i]||{};var v=String(it.variantId||\"\").trim();if(!isProductRef(v))continue;var pid=String(it.productId||\"\").trim();if(!pid)continue;var qty=Math.max(1,Math.floor(Number(it.quantity||1)));for(var u=0;u<qty;u++){units.push({productId:pid,key:pid+\":\"+u})}}return units}"
    );
    parts.push(
      "function pruneBundleSelections(sel,units){try{if(!sel||typeof sel!==\"object\")return;var keep={};for(var i=0;i<units.length;i++){keep[String(units[i]&&units[i].key||\"\")]=true}for(var k in sel){if(!Object.prototype.hasOwnProperty.call(sel,k))continue;if(!keep[k]){try{delete sel[k]}catch(e){sel[k]=null}}}}catch(e){}}"
    );
    parts.push(
      "function applySelectionsToContainer(container,bundleId){try{if(!container)return;var bid=String(bundleId||\"\").trim();if(!bid)return;var sel=getBundleVariantSelectionMap(bid)||{};var rows=container.querySelectorAll('[data-unit-key-row]');for(var i=0;i<rows.length;i++){var row=rows[i];var key=String(row.getAttribute('data-unit-key-row')||\"\").trim();if(!key)continue;var val=String(sel[key]||\"\").trim();var btns=row.querySelectorAll('button[data-action=\"pick-variant\"][data-variant-id]');for(var j=0;j<btns.length;j++){var b=btns[j];var vid=String(b.getAttribute('data-variant-id')||\"\").trim();var on=Boolean(val&&vid&&val===vid);if(on){b.classList.add('is-selected');b.setAttribute('aria-pressed','true')}else{b.classList.remove('is-selected');b.setAttribute('aria-pressed','false')}}}}catch(e){}}"
    );
    parts.push(
      "function updatePickerStatus(container,bundleId){try{if(!container)return;var bid=String(bundleId||\"\").trim();if(!bid)return;var sel=getBundleVariantSelectionMap(bid)||{};var rows=container.querySelectorAll('[data-unit-key-row]');var total=rows.length;var chosen=0;for(var i=0;i<rows.length;i++){var key=String(rows[i].getAttribute('data-unit-key-row')||\"\").trim();if(!key)continue;var v=String(sel[key]||\"\").trim();if(v)chosen++}var el=container.querySelector('[data-role=\"picker-status\"]');if(el)el.textContent=total?('تم اختيار '+fmtNum(chosen)+' من '+fmtNum(total)):''}catch(e){}}"
    );
    parts.push(
      "function bindPickerContainer(container,bundleId){try{if(!container)return;var bid=String(bundleId||\"\").trim();if(!bid)return;container.onclick=function(e){var t=e&&e.target;while(t&&t!==container){if(t&&t.getAttribute&&t.getAttribute('data-action')==='pick-variant')break;t=t.parentNode}if(!t||t===container)return;var key=String(t.getAttribute('data-unit-key')||\"\").trim();var val=String(t.getAttribute('data-variant-id')||\"\").trim();if(!key||!val)return;var sel=getBundleVariantSelectionMap(bid);if(!sel)return;sel[key]=val;applySelectionsToContainer(container,bid);updatePickerStatus(container,bid)};applySelectionsToContainer(container,bid);updatePickerStatus(container,bid)}catch(e){}}"
    );
    parts.push(
      "async function ensureVariantPickersForCard(card,bundle){try{if(!card||!bundle)return;ensurePickerStyles();var bid=String(card.getAttribute('data-bundle-id')||\"\").trim();if(!bid)return;var container=card.querySelector('.bundle-app-pickers[data-bundle-id]');if(!container)return;var sig=bundleVariantSig(bundle);var cached=variantPickerCacheByBundleId[bid];if(cached&&cached.sig===sig&&cached.html!=null){container.innerHTML=cached.html;bindPickerContainer(container,bid);return}var pending=variantPickerPendingByBundleId[bid];if(pending&&pending.sig===sig&&pending.promise)return;container.innerHTML='<div class=\"bundle-app-picker-hint\">جاري تحميل الفاريانت...</div>';var promise=(async function(){var units=bundleVariantUnits(bundle);var sel=getBundleVariantSelectionMap(bid);if(!units.length){variantPickerCacheByBundleId[bid]={sig:sig,html:\"\"};container.innerHTML='';return}pruneBundleSelections(sel,units);var varsByPid={};var uniq={};for(var i=0;i<units.length;i++){uniq[String(units[i].productId)]=true}var pids=Object.keys(uniq);for(var j=0;j<pids.length;j++){var pid=pids[j];var vr=await getCachedVariants(pid);var list=Array.isArray(vr)?vr:[];list=list.filter(function(x){return x&&x.isActive===true&&String(x.variantId||\"\").trim()});if(!list.length){list=[{variantId:('product:'+pid),productId:pid,cartProductId:pid,cartOptions:null,isActive:true,name:null,attributes:{},imageUrl:null,price:null}]}varsByPid[pid]=list}var need=[];for(var k=0;k<units.length;k++){var unit=units[k];var list2=varsByPid[unit.productId]||[];if(list2.length===1){var only=list2[0]||{};var vid=String(only.variantId||\"\").trim();if(vid)sel[unit.key]=vid}else if(list2.length>1){need.push(unit)}}if(!need.length){variantPickerCacheByBundleId[bid]={sig:sig,html:\"\"};container.innerHTML='';return}var html='<div class=\"bundle-app-pickers-title\">اختيار الفاريانت للكميات</div><div class=\"bundle-app-picker-status\" data-role=\"picker-status\"></div>';for(var n=0;n<need.length;n++){var unit2=need[n];var list3=varsByPid[unit2.productId]||[];var current=String(sel[unit2.key]||\"\").trim();var pos=String(unit2.key||\"\").indexOf(\":\");var idx=(pos>=0)?(Number(String(unit2.key).slice(pos+1))+1):(n+1);if(!Number.isFinite(idx)||idx<1)idx=n+1;html+='<div class=\"bundle-app-picker-row\" data-unit-key-row=\"'+escHtml(unit2.key)+'\"><div class=\"bundle-app-picker-label\">قطعة '+fmtNum(idx)+'</div><div class=\"bundle-app-variant-options\">';for(var o=0;o<list3.length;o++){var vv=list3[o]||{};var ov=String(vv.variantId||\"\").trim();if(!ov)continue;var on=(current&&current===ov);html+='<button type=\"button\" class=\"bundle-app-variant-btn'+(on?' is-selected':'')+'\" data-action=\"pick-variant\" data-unit-key=\"'+escHtml(unit2.key)+'\" data-variant-id=\"'+escHtml(ov)+'\" aria-pressed=\"'+(on?'true':'false')+'\">'+variantOptionInnerHtml(vv)+'</button>'}html+='</div></div>'}variantPickerCacheByBundleId[bid]={sig:sig,html:html};container.innerHTML=html;bindPickerContainer(container,bid)})();variantPickerPendingByBundleId[bid]={sig:sig,promise:promise};await promise;variantPickerPendingByBundleId[bid]=null}catch(e){}}"
    );
    parts.push(
      "function ensureStyles(){if(document.getElementById(\"bundle-app-style\"))return;var s=document.createElement(\"style\");s.id=\"bundle-app-style\";s.textContent='.bundle-app-container{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}.bundle-app-banner--inline{position:relative;display:block;width:100%;margin:12px 0;z-index:10}.bundle-app-banner--fixed{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999}.bundle-app-card{border-radius:14px;padding:12px 14px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.18)}.bundle-app-card+.bundle-app-card{margin-top:10px}.bundle-app-row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}.bundle-app-title{font-size:14px;font-weight:800;line-height:1.2}.bundle-app-sub{font-size:12px;opacity:.95;margin-top:6px;line-height:1.3}.bundle-app-muted{opacity:.9}.bundle-app-choice{display:flex;gap:10px;align-items:flex-start}.bundle-app-radio{margin-top:3px}.bundle-app-btn{border:0;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:800;cursor:pointer;background:rgba(255,255,255,.18);color:#fff}.bundle-app-btn:disabled{opacity:.6;cursor:not-allowed}.bundle-app-items{margin-top:8px;font-size:12px;opacity:.95;line-height:1.35}.bundle-app-price{margin-top:8px;font-size:12px;opacity:.95;line-height:1.35}.bundle-app-msg{margin-top:8px;font-size:12px;opacity:.95;line-height:1.35}';document.head.appendChild(s)}"
    );
    parts.push(
      "function findBannerMount(){try{var priceSelectors=['[data-testid=\"product-price\"]','[data-testid=\"product-price-value\"]','[class*=\"product-price\"]','[class*=\"price\"]','[data-price]','.price','.product-price','.salla-product-price'];for(var i=0;i<priceSelectors.length;i++){var el=document.querySelector(priceSelectors[i]);if(el)return{el:el,where:\"after\"}}var btnSelectors=['[data-testid=\"add-to-cart\"]','button[name=\"add-to-cart\"]','button[type=\"submit\"]','.salla-add-to-cart-button','.add-to-cart'];for(var j=0;j<btnSelectors.length;j++){var b=document.querySelector(btnSelectors[j]);if(b)return{el:b,where:\"before\"}}return null}catch(e){return null}}"
    );
    parts.push(
      "function mountBanner(root){try{var m=findBannerMount();if(m&&m.el&&m.el.parentNode){root.className=\"bundle-app-container bundle-app-banner--inline\";if(m.where===\"before\"){m.el.parentNode.insertBefore(root,m.el)}else{m.el.parentNode.insertBefore(root,m.el.nextSibling)}return true}}catch(e){}root.className=\"bundle-app-container bundle-app-banner--fixed\";if(!root.parentNode||root.parentNode!==document.body)document.body.appendChild(root);return false}"
    );
    parts.push(
      "function escHtml(input){var s=String(input==null?\"\":input);return s.replace(/[&<>\"']/g,function(ch){return ch===\"&\"?\"&amp;\":ch===\"<\"?\"&lt;\":ch===\">\"?\"&gt;\":ch==='\"'?\"&quot;\":\"&#39;\"})}"
    );
    parts.push(
      "function fmtNum(n){var x=Number(n);if(!Number.isFinite(x))return\"—\";try{return x.toLocaleString(\"ar-SA\")}catch(e){return String(x)}}"
    );
    parts.push(
      "function fmtMoney(n){var x=Number(n);if(!Number.isFinite(x))return\"—\";var v=Math.round(x*100)/100;var s;try{s=v.toLocaleString(\"ar-SA\",{minimumFractionDigits:v%1?2:0,maximumFractionDigits:2})}catch(e){s=String(v)}return s+\" ر.س\"}"
    );
    parts.push(
      "function normalizeTitle(raw){var title=String(raw||\"\");if(!title||title===\"Bundle\")title=\"باقة\";try{title=title.replace(/^Bundle\\s*-\\s*/i,\"باقة - \")}catch(e){}return title}"
    );
    parts.push(
      "function getPageQty(){try{var selectors=['input[name=\"quantity\"][type=\"number\"]','input[name=\"qty\"][type=\"number\"]','input.qty[type=\"number\"]','select[name=\"quantity\"]','select[name=\"qty\"]'];for(var i=0;i<selectors.length;i++){var el=document.querySelector(selectors[i]);if(!el)continue;var raw=el.value;var n=Math.floor(Number(raw));if(Number.isFinite(n)&&n>0)return n}return 1}catch(e){return 1}}"
    );
    parts.push(
      "function minRequiredBaseQty(bundle){return 1}"
    );
    parts.push(
      "function normalizeItems(bundle){var comps=(bundle&&bundle.components)||[];if(!Array.isArray(comps)||!comps.length){comps=(bundle&&bundle.bundleItems)||[]}var out=[];var baseMin=minRequiredBaseQty(bundle);for(var i=0;i<comps.length;i++){var c=comps[i]||{};var v=String(c.variantId||\"\").trim();var pid=String(c.productId||\"\").trim();var isBase=Boolean(c.isBase);var q=isBase?Math.max(getPageQty(),baseMin):Math.max(1,Math.floor(Number(c.quantity||1)));if(!v)continue;out.push({variantId:v,productId:pid||null,quantity:q,isBase:isBase})}out.sort(function(a,b){return String(a.variantId).localeCompare(String(b.variantId))});return out}"
    );
    parts.push(
      "function buildItemsText(items){var products=0;var totalQty=0;for(var i=0;i<items.length;i++){var it=items[i]||{};if(!it.variantId)continue;products++;totalQty+=Math.max(1,Math.floor(Number(it.quantity||1)))}return \"عدد المنتجات: \"+fmtNum(products)+\" • إجمالي القطع: \"+fmtNum(totalQty)}"
    );
    parts.push(
      "function buildPriceText(bundle){var p=bundle&&bundle.pricing&&bundle.pricing.base;if(!p)return\"\";var o=Number(p.originalTotal),f=Number(p.finalTotal),d=Number(p.discountAmount);if(!Number.isFinite(o)||!Number.isFinite(f))return\"\";var s='قبل '+fmtMoney(o)+' • بعد '+fmtMoney(f);if(Number.isFinite(d)&&d>0)s+=' • وفّرت '+fmtMoney(d);return s}"
    );
    parts.push(
      "function selectionKey(triggerProductId){return \"bundle_app_selected_bundle:\"+String(merchantId||\"\")+\":\"+String(triggerProductId||\"\")}"
    );
    parts.push(
      "function pendingKey(triggerProductId){return \"bundle_app_pending_coupon:\"+String(merchantId||\"\")+\":\"+String(triggerProductId||\"\")}"
    );
    parts.push(
      "function loadSelection(triggerProductId){try{var raw=localStorage.getItem(selectionKey(triggerProductId));if(!raw)return null;var j=JSON.parse(raw);return j&&typeof j==='object'?j:null}catch(e){return null}}"
    );
    parts.push(
      "function saveSelection(triggerProductId,data){try{localStorage.setItem(selectionKey(triggerProductId),JSON.stringify(data||{}))}catch(e){}}"
    );
    parts.push(
      "function clearSelection(triggerProductId){try{localStorage.removeItem(selectionKey(triggerProductId))}catch(e){}}"
    );
    parts.push(
      "function savePendingCoupon(triggerProductId,data){try{localStorage.setItem(pendingKey(triggerProductId),JSON.stringify(data||{}))}catch(e){}}"
    );
    parts.push(
      "function loadPendingCoupon(triggerProductId){try{var raw=localStorage.getItem(pendingKey(triggerProductId));if(!raw)return null;var j=JSON.parse(raw);return j&&typeof j==='object'?j:null}catch(e){return null}}"
    );
    parts.push(
      "function clearPendingCoupon(triggerProductId){try{localStorage.removeItem(pendingKey(triggerProductId))}catch(e){}}"
    );
    parts.push(
      "function isCartLikePage(){try{var p=String(window.location.pathname||\"\").toLowerCase();return p.indexOf('cart')!==-1||p.indexOf('checkout')!==-1}catch(e){return false}}"
    );
    parts.push(
      "async function tryApplyCoupon(code){var c=String(code||\"\").trim();if(!c)return false;function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}for(var attempt=0;attempt<8;attempt++){try{var cart=window.salla&&window.salla.cart;var applied=false;if(cart&&typeof cart.applyCoupon===\"function\"){await cart.applyCoupon(c);applied=true}else if(cart&&cart.coupon&&typeof cart.coupon.apply===\"function\"){await cart.coupon.apply(c);applied=true}else if(cart&&cart.coupon&&typeof cart.coupon.set===\"function\"){await cart.coupon.set(c);applied=true}else if(cart&&typeof cart.setCoupon===\"function\"){await cart.setCoupon(c);applied=true}else if(cart&&typeof cart.addCoupon===\"function\"){await cart.addCoupon(c);applied=true}else if(window.salla&&typeof window.salla.applyCoupon===\"function\"){await window.salla.applyCoupon(c);applied=true}else if(window.salla&&window.salla.coupon&&typeof window.salla.coupon.apply===\"function\"){await window.salla.coupon.apply(c);applied=true}if(applied)return true}catch(e){warn(\"bundle-app: coupon apply failed\",e&&((e.details)||e.message||e))}await sleep(450+attempt*250)}return false}"
    );
    parts.push(
      "async function tryClearCoupon(){try{var cart=window.salla&&window.salla.cart;if(cart&&cart.coupon&&typeof cart.coupon.remove===\"function\"){await cart.coupon.remove();return true}if(cart&&typeof cart.removeCoupon===\"function\"){await cart.removeCoupon();return true}if(cart&&typeof cart.clearCoupon===\"function\"){await cart.clearCoupon();return true}if(cart&&cart.coupon&&typeof cart.coupon.set===\"function\"){await cart.coupon.set(\"\");return true}if(cart&&typeof cart.applyCoupon===\"function\"){try{await cart.applyCoupon(\"\");return true}catch(e){}}}catch(e){warn(\"bundle-app: clear coupon failed\",e&&((e.details)||e.message||e))}return false}"
    );
    parts.push(
      "function extractHttpStatus(e){try{var s=(e&&((e.statusCode!=null&&e.statusCode)||(e.status!=null&&e.status)||(e.response&&e.response.status)||(e.request&&e.request.status)))||null;var n=Number(s);return Number.isFinite(n)?n:null}catch(x){return null}}"
    );
    parts.push(
      "function extractHttpMessage(e){try{var m='';if(e&&e.details&&typeof e.details==='object'){m=String(e.details.message||e.details.error||'').trim()}if(!m&&e&&e.response&&e.response.data){var d=e.response.data;m=String((d&&d.message)|| (d&&d.error)||'').trim()}if(!m&&e){m=String(e.message||'').trim()}return m}catch(x){return''}}"
    );
    parts.push(
      "function humanizeCartError(e){var st=extractHttpStatus(e);var msg=extractHttpMessage(e);if(st===410)return 'المتجر مغلق حالياً';if(st===401||st===403)return 'لا يمكن إضافة للسلّة (صلاحيات/جلسة غير صالحة)';if(st===404)return 'لا يمكن إضافة للسلّة (المنتج غير موجود)';if(msg)return msg;if(st!=null)return 'HTTP '+fmtNum(st);return 'حصل خطأ أثناء الإضافة للسلّة'}"
    );
    parts.push(
      "async function addItemsToCart(items){var cart=window.salla&&window.salla.cart;if(!cart||typeof cart.addItem!==\"function\")throw new Error(\"Salla cart API not available\");for(var i=0;i<items.length;i++){var it=items[i]||{};var qty=Math.max(1,Math.floor(Number(it.quantity||1)));var vid=String(it.variantId||\"\").trim();if(!vid)throw new Error(\"Missing variant selection\");var skuNum=Number(vid);var skuId=(Number.isFinite(skuNum)&&skuNum>0)?skuNum:vid;try{await cart.addItem({id:skuId,quantity:qty});continue}catch(e){var pidStr=String(it.cartProductId||it.productId||\"\").trim();if((!pidStr||pidStr===\"\")&&vid&&vid.indexOf('product:')===0){pidStr=String(vid).slice('product:'.length).trim()}var pidNum=Number(pidStr);var opts=it&&it.cartOptions&&typeof it.cartOptions===\"object\"?it.cartOptions:null;if((!opts||!Object.keys(opts).length)&&typeof getCachedVariants===\"function\"&&pidStr){try{var c=await getCachedVariants(pidStr);for(var ci=0;ci<c.length;ci++){var cv=c[ci]||{};if(String(cv.variantId||\"\").trim()===vid){opts=cv.cartOptions||null;break}}}catch(e0){}}try{if(Number.isFinite(pidNum)&&pidNum>0){if(opts&&Object.keys(opts).length){await cart.addItem({id:pidNum,quantity:qty,options:opts});continue}await cart.addItem({id:pidNum,quantity:qty});continue}}catch(e2){if(typeof cart.quickAdd===\"function\"&&Number.isFinite(pidNum)&&pidNum>0){try{await cart.quickAdd(pidNum);continue}catch(e3){}}throw e2}}}}"
    );
    parts.push(
      "async function removeItemsFromCart(items){var cart=window.salla&&window.salla.cart;if(!cart)throw new Error(\"Salla cart API not available\");for(var i=0;i<items.length;i++){var it=items[i]||{};var v=String(it.variantId||\"\").trim();var pid=String(it.productId||\"\").trim();if(v&&v.indexOf('product:')===0){if(!pid)pid=String(v).slice('product:'.length).trim();v='' }var pidNum=Number(pid);try{if(cart&&typeof cart.removeItem===\"function\"){if(v){await cart.removeItem(v)}else if(pid&&Number.isFinite(pidNum)&&pidNum>0){await cart.removeItem(pidNum)}continue}if(cart&&typeof cart.deleteItem===\"function\"){if(v){await cart.deleteItem(v)}else if(pid&&Number.isFinite(pidNum)&&pidNum>0){await cart.deleteItem(pidNum)}continue}if(cart&&typeof cart.updateItem===\"function\"){if(v){await cart.updateItem({id:v,quantity:0})}else if(pid&&Number.isFinite(pidNum)&&pidNum>0){await cart.updateItem({id:pidNum,quantity:0})}continue}if(cart&&typeof cart.setItemQuantity===\"function\"){if(v){await cart.setItemQuantity(v,0)}else if(pid&&Number.isFinite(pidNum)&&pidNum>0){await cart.setItemQuantity(pidNum,0)}continue}}catch(e){warn(\"bundle-app: remove item failed\",e&&((e.details)||e.message||e))}}}"
    );
    parts.push(
      "async function applyPendingCouponForCart(){if(!isCartLikePage())return;try{var trigger=String(lastTriggerProductId||\"\");if(!trigger)return;var pending=loadPendingCoupon(trigger);if(!pending||!pending.code)return;var ts=Number(pending.ts||0);if(!Number.isFinite(ts)||ts<=0||Date.now()-ts>10*60*1000){clearPendingCoupon(trigger);return}var ok=await tryApplyCoupon(pending.code);if(ok){clearPendingCoupon(trigger)}}catch(e){}}"
    );
    parts.push(
      "function renderProductBanners(bundles){ensureStyles();var id=\"bundle-app-banner\";var root=document.getElementById(id);if(!root){root=document.createElement(\"div\");root.id=id}mountBanner(root);var arr=Array.isArray(bundles)?bundles:[];if(!arr.length){clearProductBanner();return}var trigger=String(arr[0]&&arr[0].triggerProductId||\"\");lastTriggerProductId=trigger||lastTriggerProductId;var html='';for(var i=0;i<arr.length;i++){var b=arr[i]||{};var bid=String(b.id||\"\");var color=String(b.bannerColor||\"#0ea5e9\");var title=normalizeTitle(b.title);var items=normalizeItems(b);var itemsText=items.length?buildItemsText(items):'';var priceText=buildPriceText(b);var msg=String(messageByBundleId[bid]||\"\");var checked=bid===String(selectedBundleId||\"\");var cls='bundle-app-card'+(checked?' bundle-app-card--selected':'');html+='<div class=\"'+cls+'\" style=\"background:'+escHtml(color)+'\" data-bundle-id=\"'+escHtml(bid)+'\"><div class=\"bundle-app-row\"><label class=\"bundle-app-choice\"><input class=\"bundle-app-radio\" type=\"radio\" name=\"bundle_app_choice\" value=\"'+escHtml(bid)+'\" '+(checked?'checked':'')+' /><div><div class=\"bundle-app-title\">'+escHtml(title)+'</div>'+(itemsText?('<div class=\"bundle-app-items\">'+escHtml(itemsText)+'</div>'):'')+(priceText?('<div class=\"bundle-app-price\">'+escHtml(priceText)+'</div>'):'')+(msg?('<div class=\"bundle-app-msg\">'+escHtml(msg)+'</div>'):'')+'</div></label><button class=\"bundle-app-btn\" type=\"button\" data-action=\"apply-one\" data-bundle-id=\"'+escHtml(bid)+'\" '+(applying?'disabled':'')+'>أضف الباقة</button></div></div>'}root.innerHTML=html;var radios=root.querySelectorAll('input.bundle-app-radio[name=\"bundle_app_choice\"]');for(var r=0;r<radios.length;r++){(function(el){el.onchange=function(){selectedBundleId=String(el.value||\"\");renderProductBanners(arr)}})(radios[r])}var btns=root.querySelectorAll('button.bundle-app-btn[data-action=\"apply-one\"][data-bundle-id]');for(var k=0;k<btns.length;k++){(function(btn){btn.onclick=function(){if(applying)return;var bid=String(btn.getAttribute('data-bundle-id')||\"\");if(!bid)return;selectedBundleId=bid;var chosen=null;for(var j=0;j<arr.length;j++){if(String(arr[j]&&arr[j].id||\"\")===bid){chosen=arr[j];break}}if(!chosen)return;applyBundleSelection(chosen)}})(btns[k])}}"
    );
    parts.push(
      "function ensureStyles(){if(document.getElementById(\"bundle-app-style\"))return;var s=document.createElement(\"style\");s.id=\"bundle-app-style\";s.textContent='.bundle-app-container{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}.bundle-app-banner--inline{position:relative;display:block;width:100%;margin:12px 0;z-index:10}.bundle-app-banner--fixed{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999}.bundle-app-card{border-radius:14px;padding:12px 14px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.18)}.bundle-app-card--selected{outline:2px solid rgba(255,255,255,.7)}.bundle-app-card+.bundle-app-card{margin-top:10px}.bundle-app-row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}.bundle-app-title{font-size:14px;font-weight:800;line-height:1.2}.bundle-app-sub{font-size:12px;opacity:.95;margin-top:6px;line-height:1.3}.bundle-app-muted{opacity:.9}.bundle-app-choice{display:flex;gap:10px;align-items:flex-start}.bundle-app-radio{margin-top:3px}.bundle-app-btn{border:0;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:800;cursor:pointer;background:rgba(255,255,255,.18);color:#fff}.bundle-app-btn:disabled{opacity:.6;cursor:not-allowed}.bundle-app-items{margin-top:8px;font-size:12px;opacity:.95;line-height:1.35}.bundle-app-price{margin-top:8px;font-size:12px;opacity:.95;line-height:1.35}.bundle-app-msg{margin-top:8px;font-size:12px;opacity:.95;line-height:1.35}.bundle-app-tiers{margin-top:10px;display:flex;flex-direction:column;gap:6px}.bundle-app-tier{display:flex;justify-content:space-between;gap:10px;background:rgba(255,255,255,.12);border-radius:12px;padding:8px 10px;font-size:12px;line-height:1.2;cursor:pointer;user-select:none;transition:background .12s ease,transform .12s ease}.bundle-app-tier:hover{background:rgba(255,255,255,.18)}.bundle-app-tier--selected{background:rgba(255,255,255,.22);outline:2px solid rgba(255,255,255,.65)}.bundle-app-tier:active{transform:scale(.99)}.bundle-app-tier strong{font-weight:800}';document.head.appendChild(s)}"
    );
    parts.push(
      "function pctFrom(orig,final){var o=Number(orig),f=Number(final);if(!Number.isFinite(o)||!Number.isFinite(f)||o<=0)return null;var p=(1-(f/o))*100;return Math.max(0,Math.round(p))}"
    );
    parts.push("function getDefaultMinQty(bundle){return 1}");
    parts.push(
      "function pickMinQty(bundle){try{var bid=String(bundle&&bundle.id||\"\").trim();var v=Number(selectedTierByBundleId[bid]);if(Number.isFinite(v)&&v>=1)return Math.floor(v);return 1}catch(e){return 1}}"
    );
    parts.push(
      "function pickPricingForQty(bundle,qty){try{var base=(bundle&&bundle.pricing&&bundle.pricing.base)||null;var tiers=(bundle&&bundle.pricing&&bundle.pricing.tiers)||[];var q=Math.max(1,Math.floor(Number(qty||1)));if(Array.isArray(tiers)&&tiers.length){var best=null;for(var i=0;i<tiers.length;i++){var t=tiers[i]||{};var mq=Math.max(1,Math.floor(Number(t.minQty||1)));if(mq===q)return t;if(mq<=q&&(best==null||mq>best.minQty))best=t}if(best)return best}return base}catch(e){return (bundle&&bundle.pricing&&bundle.pricing.base)||null}}"
    );
    parts.push(
      "function buildTierRows(bundle,bundleId,selectedMinQty){try{var tiers=(bundle&&bundle.offer&&bundle.offer.tiers)||[];var pricingTiers=(bundle&&bundle.pricing&&bundle.pricing.tiers)||[];if(!Array.isArray(tiers)||!tiers.length)return\"\";var rows=[];for(var i=0;i<tiers.length;i++){var mq=Math.max(1,Math.floor(Number(tiers[i]&&tiers[i].minQty||1)));var pr=null;for(var j=0;j<pricingTiers.length;j++){var pt=pricingTiers[j]||{};if(Math.floor(Number(pt.minQty||0))===mq){pr=pt;break}}rows.push({minQty:mq,pricing:pr})}rows.sort(function(a,b){return a.minQty-b.minQty});var out='';for(var k=0;k<rows.length;k++){var r=rows[k];var prc=r.pricing||{};var o=Number(prc.originalTotal),f=Number(prc.finalTotal),d=Number(prc.discountAmount);var left='عند '+fmtNum(r.minQty)+' قطع';var right='';if(Number.isFinite(o)&&Number.isFinite(f)){right='قبل '+fmtMoney(o)+' • بعد '+fmtMoney(f);if(Number.isFinite(d)&&d>0){right+=' • وفّرت '+fmtMoney(d);var pct=pctFrom(o,f);if(pct!=null)right+=' ('+fmtNum(pct)+'%)'}}var cls='bundle-app-tier'+(Number(selectedMinQty)===Number(r.minQty)?' bundle-app-tier--selected':'');out+='<div class=\"'+cls+'\" data-bundle-id=\"'+escHtml(bundleId)+'\" data-tier-minqty=\"'+escHtml(r.minQty)+'\"><div><strong>'+escHtml(left)+'</strong></div>'+(right?('<div class=\"bundle-app-muted\">'+escHtml(right)+'</div>'):'')+'</div>'}return out}catch(e){return\"\"}}"
    );
    parts.push(
      "function normalizeItems(bundle){var comps=(bundle&&bundle.components)||[];if(!Array.isArray(comps)||!comps.length){comps=(bundle&&bundle.bundleItems)||[]}var out=[];var selected=pickMinQty(bundle);var baseQty=Math.max(1,Math.floor(Number(getPageQty()||1)));if(Number.isFinite(selected)&&selected>baseQty)baseQty=selected;for(var i=0;i<comps.length;i++){var c=comps[i]||{};var v=String(c.variantId||\"\").trim();var pid=String(c.productId||\"\").trim();var isBase=Boolean(c.isBase);var q=isBase?baseQty:Math.max(1,Math.floor(Number(c.quantity||1)));if(!v)continue;out.push({variantId:v,productId:pid||null,quantity:q,isBase:isBase})}out.sort(function(a,b){return String(a.variantId).localeCompare(String(b.variantId))});return out}"
    );
    parts.push(
      "function buildPriceText(bundle){try{var selected=pickMinQty(bundle);var baseQty=Math.max(1,Math.floor(Number(getPageQty()||1)));if(Number.isFinite(selected)&&selected>baseQty)baseQty=selected;var p=pickPricingForQty(bundle,baseQty);if(!p)return\"\";var o=Number(p.originalTotal),f=Number(p.finalTotal),d=Number(p.discountAmount);if(!Number.isFinite(o)||!Number.isFinite(f))return\"\";var s='قبل '+fmtMoney(o)+' • بعد '+fmtMoney(f);if(Number.isFinite(d)&&d>0)s+=' • وفّرت '+fmtMoney(d);return s}catch(e){return\"\"}}"
    );
    parts.push(
      "function renderProductBanners(bundles){ensureStyles();var id=\"bundle-app-banner\";var root=document.getElementById(id);if(!root){root=document.createElement(\"div\");root.id=id}mountBanner(root);var arr=Array.isArray(bundles)?bundles:[];if(!arr.length){clearProductBanner();return}var trigger=String(arr[0]&&arr[0].triggerProductId||\"\");lastTriggerProductId=trigger||lastTriggerProductId;var html='';for(var i=0;i<arr.length;i++){var b=arr[i]||{};var bid=String(b.id||\"\");var color=String(b.bannerColor||\"#0ea5e9\");var title=normalizeTitle(b.title);var selectedMinQty=pickMinQty(b);var items=normalizeItems(b);var itemsText=items.length?buildItemsText(items):'';var priceText=buildPriceText(b);var tiersHtml=buildTierRows(b,bid,selectedMinQty);var msg=String(messageByBundleId[bid]||\"\");var checked=bid===String(selectedBundleId||\"\");var cls='bundle-app-card'+(checked?' bundle-app-card--selected':'');var btnLabel='أضف الباقة';if(tiersHtml){btnLabel=btnLabel+' ('+fmtNum(Math.max(getPageQty(),Math.max(minRequiredBaseQty(b),selectedMinQty)))+' قطع)'}html+='<div class=\"'+cls+'\" style=\"background:'+escHtml(color)+'\" data-bundle-id=\"'+escHtml(bid)+'\"><div class=\"bundle-app-row\"><label class=\"bundle-app-choice\"><input class=\"bundle-app-radio\" type=\"radio\" name=\"bundle_app_choice\" value=\"'+escHtml(bid)+'\" '+(checked?'checked':'')+' /><div><div class=\"bundle-app-title\">'+escHtml(title)+'</div>'+(itemsText?('<div class=\"bundle-app-items\">'+escHtml(itemsText)+'</div>'):'')+(priceText?('<div class=\"bundle-app-price\">'+escHtml(priceText)+'</div>'):'')+(msg?('<div class=\"bundle-app-msg\">'+escHtml(msg)+'</div>'):'')+'</div></label><button class=\"bundle-app-btn\" type=\"button\" data-action=\"apply-one\" data-bundle-id=\"'+escHtml(bid)+'\" '+(applying?'disabled':'')+'>'+escHtml(btnLabel)+'</button></div>'+(tiersHtml?('<div class=\"bundle-app-tiers\">'+tiersHtml+'</div>'):'')+'<div class=\"bundle-app-pickers\" data-bundle-id=\"'+escHtml(bid)+'\"></div></div>'}root.innerHTML=html;var radios=root.querySelectorAll('input.bundle-app-radio[name=\"bundle_app_choice\"]');for(var r=0;r<radios.length;r++){(function(el){el.onchange=function(){selectedBundleId=String(el.value||\"\");renderProductBanners(arr)}})(radios[r])}var tierEls=root.querySelectorAll('.bundle-app-tier[data-tier-minqty][data-bundle-id]');for(var t=0;t<tierEls.length;t++){(function(el){el.onclick=function(){var bid=String(el.getAttribute('data-bundle-id')||\"\");var mq=Number(el.getAttribute('data-tier-minqty'));if(bid&&Number.isFinite(mq)&&mq>=1){selectedTierByBundleId[bid]=Math.floor(mq);messageByBundleId[bid]='';renderProductBanners(arr)}}})(tierEls[t])}var btns=root.querySelectorAll('button.bundle-app-btn[data-action=\"apply-one\"][data-bundle-id]');for(var k=0;k<btns.length;k++){(function(btn){btn.onclick=function(){if(applying)return;var bid=String(btn.getAttribute('data-bundle-id')||\"\");if(!bid)return;selectedBundleId=bid;var chosen=null;for(var j=0;j<arr.length;j++){if(String(arr[j]&&arr[j].id||\"\")===bid){chosen=arr[j];break}}if(!chosen)return;applyBundleSelection(chosen)}})(btns[k])}var cards=root.querySelectorAll('.bundle-app-card[data-bundle-id]');for(var c=0;c<cards.length;c++){(function(card){card.onmouseenter=function(){var bid=String(card.getAttribute('data-bundle-id')||\"\");if(!bid)return;var chosen=null;for(var j=0;j<arr.length;j++){if(String(arr[j]&&arr[j].id||\"\")===bid){chosen=arr[j];break}}if(chosen)ensureVariantPickersForCard(card,chosen)}})(cards[c])}try{for(var c2=0;c2<cards.length;c2++){var card2=cards[c2];var bid2=String(card2.getAttribute('data-bundle-id')||\"\");if(bid2&&bid2===String(selectedBundleId||\"\")){var chosen2=null;for(var j2=0;j2<arr.length;j2++){if(String(arr[j2]&&arr[j2].id||\"\")===bid2){chosen2=arr[j2];break}}if(chosen2)ensureVariantPickersForCard(card2,chosen2)}}}catch(e){}}"
    );
    parts.push(
      "async function applyBundleSelection(bundle){var bid=String(bundle&&bundle.id||\"\");var trigger=String(bundle&&bundle.triggerProductId||\"\");if(!bid||!trigger)return;selectedBundleId=bid;applying=true;try{messageByBundleId[bid]='جاري إضافة الباقة...';renderProductBanners(lastBundles||[])}catch(e){}try{var rawItems=normalizeItems(bundle);var items=await resolveProductRefItems(rawItems,bid);if(!items||!items.length){messageByBundleId[bid]='لازم تختار الفاريانت قبل إضافة الباقة';applying=false;try{renderProductBanners(lastBundles||[])}catch(e0){}return}var prev=loadSelection(trigger);await tryClearCoupon();if(prev&&prev.bundleId&&String(prev.bundleId)!==bid&&Array.isArray(prev.items)&&prev.items.length){await removeItemsFromCart(prev.items)}try{await addItemsToCart(items)}catch(addErr){var hm=humanizeCartError(addErr);messageByBundleId[bid]=hm?('لم يتم إضافة الباقة ('+hm+')'):'لم يتم إضافة الباقة';applying=false;try{renderProductBanners(lastBundles||[])}catch(e9){}return}messageByBundleId[bid]='جاري تجهيز الخصم...';try{renderProductBanners(lastBundles||[])}catch(e2){}var res=await requestApplyBundle(bid,items.map(function(it){return{variantId:it.variantId,quantity:it.quantity}}));var hasDiscount=Boolean(res&&res.hasDiscount&&res.couponCode);if(hasDiscount){saveSelection(trigger,{bundleId:bid,triggerProductId:trigger,items:items,ts:Date.now()});savePendingCoupon(trigger,{code:String(res.couponCode),ts:Date.now()});var ok=await tryApplyCoupon(String(res.couponCode));if(ok){clearPendingCoupon(trigger);messageByBundleId[bid]='تم تطبيق الخصم على السلة'}else{messageByBundleId[bid]='تم تجهيز الكوبون، افتح السلة وسيتم تطبيقه تلقائيًا'}}else{messageByBundleId[bid]='تمت إضافة الباقة. لا يوجد خصم لهذه الباقة.';clearPendingCoupon(trigger)}selectedBundleId=bid}catch(e){warn(\"bundle-app: apply bundle failed\",e&&((e.details)||e.message||e));var em=String((e&&e.message)||\"\").trim();if(em&&em.length>160)em=em.slice(0,160);messageByBundleId[bid]='حصل خطأ أثناء إضافة الباقة أو تطبيق الخصم'+(em?(' ('+em+')'):'')}applying=false;try{renderProductBanners(lastBundles||[])}catch(e){} }"
    );
    parts.push("var lastBundles=null;");
    parts.push("function clearProductBanner(){var root=document.getElementById(\"bundle-app-banner\");if(root)root.remove()}");
    parts.push(
      "async function refreshProduct(){var state=null;try{state=(g.BundleApp&&g.BundleApp.__refreshState)?g.BundleApp.__refreshState:(g.BundleApp.__refreshState={busy:false,queued:false,lastKey:\"\",lastSig:\"\"});if(state.busy){state.queued=true;return}state.busy=true;var variantId=findVariantId();var productId=findProductId();var key=variantId?('v:'+String(variantId)):productId?('p:'+String(productId)):\"\";log(\"bundle-app: ids\",{variantId:variantId,productId:productId});var res=null;if(variantId){res=await getProductBundlesByVariantId(variantId)}else if(productId){res=await getProductBundlesByProductId(productId)}else{clearProductBanner();state.lastKey=\"\";state.lastSig=\"\";return}var bundles=(res&&res.bundles)||[];if(!bundles.length){clearProductBanner();state.lastKey=key;state.lastSig=\"\";return}var sig='';for(var i=0;i<bundles.length;i++){var b=bundles[i]||{};sig+=String(b.id||i)+'|'+bundleVariantSig(b)+'|'+String(((b.pricing&&b.pricing.base&&b.pricing.base.finalTotal)!=null)?(b.pricing.base.finalTotal):'')+';'}if(!applying&&key===state.lastKey&&sig===state.lastSig)return;state.lastKey=key;state.lastSig=sig;lastBundles=bundles;renderProductBanners(bundles)}catch(e){warn(\"bundle-app: refresh failed\",e&&((e.details)||e.message||e));clearProductBanner()}finally{if(state){state.busy=false;if(state.queued){state.queued=false;setTimeout(function(){refreshProduct()},0)}}}}"
    );
    parts.push(
      "function initOnce(){var inited=false;function start(){if(inited)return;inited=true;applyPendingCouponForCart();refreshProduct()}if(document.readyState===\"loading\"){document.addEventListener(\"DOMContentLoaded\",start)}else{start()}}"
    );
    parts.push("g.BundleApp.getProductBundlesByVariantId=getProductBundlesByVariantId;");
    parts.push("g.BundleApp.getProductBundlesByProductId=getProductBundlesByProductId;");
    parts.push("g.BundleApp.refreshProduct=refreshProduct;");
    parts.push("g.BundleApp.applyBundleSelection=applyBundleSelection;");
    parts.push("initOnce();");
    parts.push("})();");
    return parts.join("");
  }

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
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");

      let js = `(function(){var merchantId=${JSON.stringify(merchantId)};var token=${JSON.stringify(
        token
      )};function getBackendOrigin(){try{var cs=document.currentScript;var src=(cs&&cs.src)||"";if(!src)return"";return new URL(src).origin}catch(e){return""}}function findVariantId(){try{var url=new URL(window.location.href);var fromUrl=url.searchParams.get("variant_id")||url.searchParams.get("variantId")||url.searchParams.get("variant")||"";if(fromUrl)return String(fromUrl).trim();var el=document.querySelector('[name="variant_id"],[name="variantId"],[data-variant-id],input[name="variant_id"],select[name="variant_id"]');if(el){var v=el.getAttribute("data-variant-id")||el.value||"";v=String(v).trim();if(v)return v}var any=document.querySelector('[data-variant-id]');if(any){var a=String(any.getAttribute("data-variant-id")||"").trim();if(a)return a}return""}catch(e){return""}}async function fetchJson(url,opts){var r=await fetch(url,opts);var t=await r.text();var j=null;try{j=t?JSON.parse(t):null}catch(e){throw new Error("Invalid JSON response")}if(!r.ok){var msg=(j&&j.message)||("HTTP "+r.status);var err=new Error(msg);err.status=r.status;err.details=j;throw err}return j}async function getProductBundles(variantId){var v=String(variantId||"").trim();if(!v)return null;var origin=getBackendOrigin();if(!origin)return null;var u=new URL(origin+"/api/proxy/bundles/product");u.searchParams.set("merchantId",merchantId);u.searchParams.set("variantId",v);u.searchParams.set("token",token);return fetchJson(u.toString())}async function getCartBanner(items){var origin=getBackendOrigin();if(!origin)return null;var payload={items:Array.isArray(items)?items:[]};if(!payload.items.length)return null;var body=JSON.stringify(payload);var u=new URL(origin+"/api/proxy/cart/banner");u.searchParams.set("merchantId",merchantId);u.searchParams.set("token",token);return fetchJson(u.toString(),{method:"POST",headers:{"Content-Type":"application/json"},body:body})}function ensureStyles(){if(document.getElementById("bundle-app-style"))return;var s=document.createElement("style");s.id="bundle-app-style";s.textContent='.bundle-app-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;border-radius:14px;padding:12px 14px;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,.18)}.bundle-app-row{display:flex;gap:10px;align-items:center;justify-content:space-between}.bundle-app-title{font-size:14px;font-weight:700;line-height:1.2}.bundle-app-sub{font-size:12px;opacity:.9;margin-top:2px}.bundle-app-btn{border:0;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.18);color:#fff}.bundle-app-btn:disabled{opacity:.6;cursor:not-allowed}';document.head.appendChild(s)}function renderProductBanner(bundle){ensureStyles();var id="bundle-app-banner";var root=document.getElementById(id);if(!root){root=document.createElement("div");root.id=id;document.body.appendChild(root)}root.className="bundle-app-banner";root.style.background=String(bundle&&bundle.bannerColor||"#0ea5e9");var title=String(bundle&&bundle.title||"");var cta=String(bundle&&bundle.cta||"أضف الباقة");var html='<div class="bundle-app-row"><div><div class="bundle-app-title"></div><div class="bundle-app-sub"></div></div><button class="bundle-app-btn" type="button"></button></div>';root.innerHTML=html;root.querySelector(".bundle-app-title").textContent=title;root.querySelector(".bundle-app-sub").textContent="";var btn=root.querySelector(".bundle-app-btn");btn.textContent=cta;btn.onclick=async function(){try{btn.disabled=true;var items=(bundle&&bundle.bundleItems)||[];for(var i=0;i<items.length;i++){var it=items[i]||{};var pid=Number(it.productId);var qty=Math.max(1,Math.floor(Number(it.quantity||1)));if(!Number.isFinite(pid)||pid<=0)continue;if(window.salla&&window.salla.cart&&typeof window.salla.cart.addItem==="function"){await window.salla.cart.addItem({id:pid,quantity:qty})}}btn.disabled=false}catch(e){btn.disabled=false}}}function clearProductBanner(){var root=document.getElementById("bundle-app-banner");if(root)root.remove()}async function refreshProduct(){try{var variantId=findVariantId();if(!variantId){clearProductBanner();return}var res=await getProductBundles(variantId);var bundles=(res&&res.bundles)||[];if(!bundles.length){clearProductBanner();return}renderProductBanner(bundles[0])}catch(e){}}function initAuto(){var inited=false;function start(){if(inited)return;inited=true;refreshProduct();setInterval(refreshProduct,30000)}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",start)}else{start()}}window.BundleApp=window.BundleApp||{};window.BundleApp.getProductBundles=getProductBundles;window.BundleApp.getCartBanner=getCartBanner;window.BundleApp.refreshProduct=refreshProduct;initAuto();})();`;

      js = js.replace(
        "async function fetchJson(url,opts){",
        'function findProductId(){try{var m=String(window.location.pathname||"").match(/\\\\/p(\\\\d+)(?:[/?#]|$)/);if(m&&m[1])return String(m[1]);var el=document.querySelector("[data-product-id],input[name=\\"product_id\\"],input[name=\\"productId\\"]");if(el){var v=el.getAttribute("data-product-id")||el.value||"";v=String(v).trim();if(v)return v}return""}catch(e){return""}}async function fetchJson(url,opts){'
      );

      js = js.replace("async function getProductBundles(variantId){", "async function getProductBundlesByVariantId(variantId){");

      js = js.replace(
        "async function getCartBanner(items){",
        'async function getProductBundlesByProductId(productId){var p=String(productId||"").trim();if(!p)return null;var origin=getBackendOrigin();if(!origin)return null;var u=new URL(origin+"/api/proxy/bundles/for-product");u.searchParams.set("merchantId",merchantId);u.searchParams.set("productId",p);u.searchParams.set("token",token);return fetchJson(u.toString())}async function getCartBanner(items){'
      );

      js = js.replace(
        "async function refreshProduct(){try{var variantId=findVariantId();if(!variantId){clearProductBanner();return}var res=await getProductBundles(variantId);var bundles=(res&&res.bundles)||[];if(!bundles.length){clearProductBanner();return}renderProductBanner(bundles[0])}catch(e){}}",
        "async function refreshProduct(){try{var variantId=findVariantId();var res=null;if(variantId){res=await getProductBundlesByVariantId(variantId)}else{var productId=findProductId();if(!productId){clearProductBanner();return}res=await getProductBundlesByProductId(productId)}var bundles=(res&&res.bundles)||[];if(!bundles.length){clearProductBanner();return}renderProductBanner(bundles[0])}catch(e){}}"
      );

      js = js.replace(
        "window.BundleApp.getProductBundles=getProductBundles;",
        "window.BundleApp.getProductBundlesByVariantId=getProductBundlesByVariantId;window.BundleApp.getProductBundlesByProductId=getProductBundlesByProductId;window.BundleApp.getProductBundles=getProductBundlesByVariantId;"
      );

      js = buildStorefrontSnippetJsManualBundles(merchantId, token);
      return res.send(js);
    } catch (err) {
      return next(err);
    }
  });

  router.use("/oauth/salla", createOAuthRouter(config));
  router.use("/bundles", merchantAuth(config), createBundleRouter(config));

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
      const variantIds = extractVariantIdsFromProductPayload(productResp);
      const report = variantIds.length
        ? await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, variantIds, { concurrency: 6, maxAttempts: 3 })
        : { snapshots: new Map(), missing: [] };

      const variants = Array.from(report.snapshots.values())
        .filter((s) => String(s?.productId || "").trim() === productId)
        .map((s) => ({
          variantId: String(s.variantId),
          productId: String(s.productId),
          name: s.name || null,
          attributes: s.attributes || {},
          imageUrl: s.imageUrl || null,
          price: s.price != null ? Number(s.price) : null,
          cartProductId: productId,
          cartOptions: cartOptionsByVariantId.get(String(s.variantId)) || null,
          isActive: s.isActive === true
        }))
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
      const coupon = await issueOrReuseCouponForCart(config, merchant, merchant.accessToken, items, evaluation, { ttlHours: 24 });

      const discountAmount = Number.isFinite(evaluation?.applied?.totalDiscount) ? Number(evaluation.applied.totalDiscount) : 0;
      const hasDiscount = Boolean(coupon && discountAmount > 0);
      const messages = [];
      if (!items.length) messages.push({ level: "info", code: "CART_EMPTY", message: "Cart has no items." });
      if (!hasDiscount) messages.push({ level: "info", code: "NO_BUNDLE_APPLIED", message: "No bundle discounts apply to this cart." });

      return res.json({
        ok: true,
        merchantId: String(qValue.merchantId),
        hasDiscount,
        discountAmount: hasDiscount ? Number(discountAmount.toFixed(2)) : 0,
        couponCode: hasDiscount ? coupon.code : null,
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

      const evaluation = {
        applied: {
          totalDiscount: draft?.applied ? Number(draft.discountAmount || 0) : 0,
          matchedProductIds: Array.isArray(draft?.matchedProductIds) ? draft.matchedProductIds : [],
          rule: appliedRule
        }
      };

      const coupon = await issueOrReuseCouponForCart(config, merchant, merchant.accessToken, items, evaluation, { ttlHours: 24 });
      const discountAmount = Number.isFinite(evaluation?.applied?.totalDiscount) ? Number(evaluation.applied.totalDiscount) : 0;
      const hasDiscount = Boolean(coupon && discountAmount > 0);

      return res.json({
        ok: true,
        merchantId: String(qValue.merchantId),
        bundleId: String(bValue.bundleId),
        hasDiscount,
        discountAmount: hasDiscount ? Number(discountAmount.toFixed(2)) : 0,
        couponCode: hasDiscount ? coupon.code : null
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
