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
    if (cover) return cover;
    const first = (Array.isArray(bundle?.components) ? bundle.components : [])
      .map((c) => String(c?.variantId || "").trim())
      .find(Boolean);
    return first || null;
  }

  function normalizeComponentsForStorefront(bundle, variantSnapshots) {
    const baseVariantId = resolveBaseVariantIdFromBundle(bundle);
    const components = Array.isArray(bundle?.components) ? bundle.components : [];
    return components
      .map((c) => {
        const variantId = String(c?.variantId || "").trim();
        const quantity = Math.max(1, Math.floor(Number(c?.quantity || 1)));
        if (!variantId) return null;
        const snap = variantSnapshots?.get ? variantSnapshots.get(variantId) : null;
        const productId = String(snap?.productId || "").trim() || null;
        const imageUrl = snap?.imageUrl ? String(snap.imageUrl).trim() || null : null;
        const price = snap?.price != null ? Number(snap.price) : null;
        return {
          variantId,
          productId,
          quantity,
          isBase: baseVariantId ? variantId === baseVariantId : false,
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
        productId: String(c?.productId || "").trim() || null,
        quantity: Math.max(1, Math.floor(Number(c?.quantity || 1))),
        isBase: Boolean(c?.isBase),
        imageUrl: c?.imageUrl ? String(c.imageUrl).trim() || null : null
      }))
      .filter((it) => Boolean(it.productId));
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
    const baseSubtotal = (Array.isArray(components) ? components : []).reduce((acc, c) => {
      const unit = Number(c?.price);
      const qty = Math.max(1, Math.floor(Number(c?.quantity || 1)));
      if (!Number.isFinite(unit) || unit < 0) {
        missingPriceVariantIds.push(String(c?.variantId || "").trim());
        return acc;
      }
      return acc + unit * qty;
    }, 0);
    const baseDiscount = calcDiscountAmount(offer, baseSubtotal);
    const base = {
      originalTotal: Number(baseSubtotal.toFixed(2)),
      discountAmount: Number(Math.max(0, baseDiscount).toFixed(2)),
      finalTotal: Number(Math.max(0, baseSubtotal - baseDiscount).toFixed(2))
    };

    const baseVariantId = resolveBaseVariantIdFromBundle(bundle);
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
        const tierSubtotal = (Array.isArray(components) ? components : []).reduce((acc, c) => {
          const unit = Number(c?.price);
          const qtyRaw = Math.max(1, Math.floor(Number(c?.quantity || 1)));
          const qty = baseVariantId && String(c?.variantId) === String(baseVariantId) ? tier.minQty : qtyRaw;
          if (!Number.isFinite(unit) || unit < 0) {
            missingTier.push(String(c?.variantId || "").trim());
            return acc;
          }
          return acc + unit * qty;
        }, 0);
        const discount = calcDiscountAmount(tier, tierSubtotal);
        return {
          minQty: tier.minQty,
          type: tier.type,
          value: tier.value,
          originalTotal: Number(tierSubtotal.toFixed(2)),
          discountAmount: Number(Math.max(0, discount).toFixed(2)),
          finalTotal: Number(Math.max(0, tierSubtotal - discount).toFixed(2)),
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

  function serializeBundleForStorefront(bundle, variantSnapshots, triggerProductId) {
    const components = normalizeComponentsForStorefront(bundle, variantSnapshots);
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
      triggerProductId: String(bundle?.triggerProductId || triggerProductId || "").trim(),
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
          isBase: Boolean(c.isBase),
          imageUrl: c.imageUrl ? String(c.imageUrl).trim() || null : null
        }))
        .filter((c) => Boolean(c.productId)),
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
    )};var scriptSrc=(document.currentScript&&document.currentScript.src)||"";var debug=false;try{debug=new URL(scriptSrc).searchParams.get("debug")==="1"}catch(e){}function log(){if(!debug)return;try{console.log.apply(console,arguments)}catch(e){}}function warn(){if(!debug)return;try{console.warn.apply(console,arguments)}catch(e){}}function getBackendOrigin(){try{return new URL(scriptSrc).origin}catch(e){return""}}function findVariantId(){try{var url=new URL(window.location.href);var fromUrl=url.searchParams.get("variant_id")||url.searchParams.get("variantId")||url.searchParams.get("variant")||"";if(fromUrl)return String(fromUrl).trim();var el=document.querySelector('[name="variant_id"],[name="variantId"],[data-variant-id],input[name="variant_id"],select[name="variant_id"]');if(el){var v=el.getAttribute("data-variant-id")||el.value||"";v=String(v).trim();if(v)return v}var any=document.querySelector("[data-variant-id]");if(any){var a=String(any.getAttribute("data-variant-id")||"").trim();if(a)return a}return""}catch(e){return""}}function findProductId(){try{var path=String(window.location.pathname||"");var m=path.match(/\\/p(\\d+)(?:[/?#]|$)/);if(m&&m[1])return String(m[1]);var el=document.querySelector("[data-product-id],input[name=\\"product_id\\"],input[name=\\"productId\\"]");if(el){var v=el.getAttribute("data-product-id")||el.value||"";v=String(v).trim();if(v)return v}return""}catch(e){return""}}async function fetchJson(url,opts){var r=await fetch(url,opts);var t=await r.text();var j=null;try{j=t?JSON.parse(t):null}catch(e){throw new Error("Invalid JSON response")}if(!r.ok){var msg=(j&&j.message)||("HTTP "+r.status);var err=new Error(msg);err.status=r.status;err.details=j;throw err}return j}function buildUrl(path,params){var origin=getBackendOrigin();if(!origin)return null;var u=new URL(origin+path);for(var k in (params||{})){if(!Object.prototype.hasOwnProperty.call(params,k))continue;var v=params[k];if(v==null||v==="")continue;u.searchParams.set(k,String(v))}u.searchParams.set("merchantId",merchantId);u.searchParams.set("token",token);return u}async function getProductBundlesByVariantId(variantId){var v=String(variantId||"").trim();if(!v)return null;var u=buildUrl("/api/proxy/bundles/product",{variantId:v});if(!u)return null;return fetchJson(u.toString())}async function getProductBundlesByProductId(productId){var p=String(productId||"").trim();if(!p)return null;var u=buildUrl("/api/proxy/bundles/for-product",{productId:p});if(!u)return null;return fetchJson(u.toString())}async function getCartBanner(items){var payload={items:Array.isArray(items)?items:[]};if(!payload.items.length)return null;var u=buildUrl("/api/proxy/cart/banner",{});if(!u)return null;return fetchJson(u.toString(),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})}function ensureStyles(){if(document.getElementById("bundle-app-style"))return;var s=document.createElement("style");s.id="bundle-app-style";s.textContent='.bundle-app-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;border-radius:14px;padding:12px 14px;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,.18)}.bundle-app-row{display:flex;gap:10px;align-items:center;justify-content:space-between}.bundle-app-title{font-size:14px;font-weight:700;line-height:1.2}.bundle-app-sub{font-size:12px;opacity:.9;margin-top:2px}.bundle-app-btn{border:0;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.18);color:#fff}.bundle-app-btn:disabled{opacity:.6;cursor:not-allowed}';document.head.appendChild(s)}function renderProductBanner(bundle){ensureStyles();var id="bundle-app-banner";var root=document.getElementById(id);if(!root){root=document.createElement("div");root.id=id;document.body.appendChild(root)}root.className="bundle-app-banner";root.style.background=String(bundle&&bundle.bannerColor||"#0ea5e9");var title=String(bundle&&bundle.title||"");var cta=String(bundle&&bundle.cta||"أضف الباقة");var html='<div class="bundle-app-row"><div><div class="bundle-app-title"></div><div class="bundle-app-sub"></div></div><button class="bundle-app-btn" type="button"></button></div>';root.innerHTML=html;root.querySelector(".bundle-app-title").textContent=title;root.querySelector(".bundle-app-sub").textContent="";var btn=root.querySelector(".bundle-app-btn");btn.textContent=cta;btn.onclick=async function(){try{btn.disabled=true;var items=(bundle&&bundle.bundleItems)||[];for(var i=0;i<items.length;i++){var it=items[i]||{};var pid=Number(it.productId);var qty=Math.max(1,Math.floor(Number(it.quantity||1)));if(!Number.isFinite(pid)||pid<=0)continue;if(window.salla&&window.salla.cart&&typeof window.salla.cart.addItem==="function"){await window.salla.cart.addItem({id:pid,quantity:qty})}}btn.disabled=false}catch(e){btn.disabled=false;warn("bundle-app: add-to-cart failed",e&&((e.details)||e.message||e))}}}function clearProductBanner(){var root=document.getElementById("bundle-app-banner");if(root)root.remove()}async function refreshProduct(){try{var variantId=findVariantId();var productId=findProductId();log("bundle-app: ids",{"variantId":variantId,"productId":productId});var res=null;if(variantId){res=await getProductBundlesByVariantId(variantId)}else if(productId){res=await getProductBundlesByProductId(productId)}else{clearProductBanner();return}var bundles=(res&&res.bundles)||[];if(!bundles.length){clearProductBanner();return}renderProductBanner(bundles[0])}catch(e){warn("bundle-app: refresh failed",e&&((e.details)||e.message||e));clearProductBanner()}}function initAuto(){var inited=false;function start(){if(inited)return;inited=true;refreshProduct();setInterval(refreshProduct,1500)}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",start)}else{start()}}window.BundleApp=window.BundleApp||{};window.BundleApp.getProductBundlesByVariantId=getProductBundlesByVariantId;window.BundleApp.getProductBundlesByProductId=getProductBundlesByProductId;window.BundleApp.getCartBanner=getCartBanner;window.BundleApp.refreshProduct=refreshProduct;initAuto()}catch(e){}})();`;
  }

  void buildStorefrontSnippetJs;

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
    parts.push(
      "function ensureStyles(){if(document.getElementById(\"bundle-app-style\"))return;var s=document.createElement(\"style\");s.id=\"bundle-app-style\";s.textContent='.bundle-app-banner{border-radius:14px;padding:12px 14px;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,.18)}.bundle-app-banner--inline{position:relative;display:block;width:100%;margin:12px 0;z-index:10}.bundle-app-banner--fixed{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999}.bundle-app-row{display:flex;gap:10px;align-items:center;justify-content:space-between}.bundle-app-title{font-size:14px;font-weight:700;line-height:1.2}.bundle-app-sub{font-size:12px;opacity:.9;margin-top:2px}.bundle-app-btn{border:0;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.18);color:#fff}.bundle-app-btn:disabled{opacity:.6;cursor:not-allowed}';document.head.appendChild(s)}"
    );
    parts.push(
      "function findBannerMount(){try{var priceSelectors=['[data-testid=\"product-price\"]','[data-testid=\"product-price-value\"]','[class*=\"product-price\"]','[class*=\"price\"]','[data-price]','.price','.product-price','.salla-product-price'];for(var i=0;i<priceSelectors.length;i++){var el=document.querySelector(priceSelectors[i]);if(el)return{el:el,where:\"after\"}}var btnSelectors=['[data-testid=\"add-to-cart\"]','button[name=\"add-to-cart\"]','button[type=\"submit\"]','.salla-add-to-cart-button','.add-to-cart'];for(var j=0;j<btnSelectors.length;j++){var b=document.querySelector(btnSelectors[j]);if(b)return{el:b,where:\"before\"}}return null}catch(e){return null}}function mountBanner(root){try{var m=findBannerMount();if(m&&m.el&&m.el.parentNode){root.className=\"bundle-app-banner bundle-app-banner--inline\";if(m.where===\"before\"){m.el.parentNode.insertBefore(root,m.el)}else{m.el.parentNode.insertBefore(root,m.el.nextSibling)}return true}}catch(e){}root.className=\"bundle-app-banner bundle-app-banner--fixed\";if(!root.parentNode||root.parentNode!==document.body)document.body.appendChild(root);return false}function renderProductBanner(bundle){ensureStyles();var id=\"bundle-app-banner\";var root=document.getElementById(id);if(!root){root=document.createElement(\"div\");root.id=id}mountBanner(root);root.style.background=String(bundle&&bundle.bannerColor||\"#0ea5e9\");var title=String(bundle&&bundle.title||\"\");if(!title||title===\"Bundle\")title=\"باقة\";try{title=title.replace(/^Bundle\\s*-\\s*/i,\"باقة - \")}catch(e){}var cta=String(bundle&&bundle.cta||\"أضف الباقة\");var html='<div class=\"bundle-app-row\"><div><div class=\"bundle-app-title\"></div><div class=\"bundle-app-sub\"></div></div><button class=\"bundle-app-btn\" type=\"button\"></button></div>';root.innerHTML=html;root.querySelector(\".bundle-app-title\").textContent=title;root.querySelector(\".bundle-app-sub\").textContent=\"\";var btn=root.querySelector(\".bundle-app-btn\");btn.textContent=cta;btn.onclick=async function(){try{btn.disabled=true;var items=(bundle&&bundle.bundleItems)||[];for(var i=0;i<items.length;i++){var it=items[i]||{};var pid=Number(it.productId);var qty=Math.max(1,Math.floor(Number(it.quantity||1)));if(!Number.isFinite(pid)||pid<=0)continue;if(window.salla&&window.salla.cart&&typeof window.salla.cart.addItem===\"function\"){await window.salla.cart.addItem({id:pid,quantity:qty})}}btn.disabled=false}catch(e){btn.disabled=false;warn(\"bundle-app: add-to-cart failed\",e&&((e.details)||e.message||e))}}}"
    );
    parts.push("function clearProductBanner(){var root=document.getElementById(\"bundle-app-banner\");if(root)root.remove()}");
    parts.push(
      "async function refreshProduct(){try{var variantId=findVariantId();var productId=findProductId();log(\"bundle-app: ids\",{variantId:variantId,productId:productId});var res=null;if(variantId){res=await getProductBundlesByVariantId(variantId)}else if(productId){res=await getProductBundlesByProductId(productId)}else{clearProductBanner();return}var bundles=(res&&res.bundles)||[];if(!bundles.length){clearProductBanner();return}renderProductBanner(bundles[0])}catch(e){warn(\"bundle-app: refresh failed\",e&&((e.details)||e.message||e));clearProductBanner()}}"
    );
    parts.push(
      "function initAuto(){var inited=false;function start(){if(inited)return;inited=true;refreshProduct();setInterval(refreshProduct,1500)}if(document.readyState===\"loading\"){document.addEventListener(\"DOMContentLoaded\",start)}else{start()}}"
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
      "g.BundleApp.renderTest=function(){renderProductBanner({bannerColor:\"#0ea5e9\",title:\"Bundle test\",cta:\"OK\",bundleItems:[]})};"
    );
    parts.push("initAuto();");
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
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");

      let js = `(function(){var merchantId=${JSON.stringify(merchantId)};var token=${JSON.stringify(
        token
      )};function getBackendOrigin(){try{var cs=document.currentScript;var src=(cs&&cs.src)||"";if(!src)return"";return new URL(src).origin}catch(e){return""}}function findVariantId(){try{var url=new URL(window.location.href);var fromUrl=url.searchParams.get("variant_id")||url.searchParams.get("variantId")||url.searchParams.get("variant")||"";if(fromUrl)return String(fromUrl).trim();var el=document.querySelector('[name="variant_id"],[name="variantId"],[data-variant-id],input[name="variant_id"],select[name="variant_id"]');if(el){var v=el.getAttribute("data-variant-id")||el.value||"";v=String(v).trim();if(v)return v}var any=document.querySelector('[data-variant-id]');if(any){var a=String(any.getAttribute("data-variant-id")||"").trim();if(a)return a}return""}catch(e){return""}}async function fetchJson(url,opts){var r=await fetch(url,opts);var t=await r.text();var j=null;try{j=t?JSON.parse(t):null}catch(e){throw new Error("Invalid JSON response")}if(!r.ok){var msg=(j&&j.message)||("HTTP "+r.status);var err=new Error(msg);err.status=r.status;err.details=j;throw err}return j}async function getProductBundles(variantId){var v=String(variantId||"").trim();if(!v)return null;var origin=getBackendOrigin();if(!origin)return null;var u=new URL(origin+"/api/proxy/bundles/product");u.searchParams.set("merchantId",merchantId);u.searchParams.set("variantId",v);u.searchParams.set("token",token);return fetchJson(u.toString())}async function getCartBanner(items){var origin=getBackendOrigin();if(!origin)return null;var payload={items:Array.isArray(items)?items:[]};if(!payload.items.length)return null;var body=JSON.stringify(payload);var u=new URL(origin+"/api/proxy/cart/banner");u.searchParams.set("merchantId",merchantId);u.searchParams.set("token",token);return fetchJson(u.toString(),{method:"POST",headers:{"Content-Type":"application/json"},body:body})}function ensureStyles(){if(document.getElementById("bundle-app-style"))return;var s=document.createElement("style");s.id="bundle-app-style";s.textContent='.bundle-app-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;border-radius:14px;padding:12px 14px;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,.18)}.bundle-app-row{display:flex;gap:10px;align-items:center;justify-content:space-between}.bundle-app-title{font-size:14px;font-weight:700;line-height:1.2}.bundle-app-sub{font-size:12px;opacity:.9;margin-top:2px}.bundle-app-btn{border:0;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.18);color:#fff}.bundle-app-btn:disabled{opacity:.6;cursor:not-allowed}';document.head.appendChild(s)}function renderProductBanner(bundle){ensureStyles();var id="bundle-app-banner";var root=document.getElementById(id);if(!root){root=document.createElement("div");root.id=id;document.body.appendChild(root)}root.className="bundle-app-banner";root.style.background=String(bundle&&bundle.bannerColor||"#0ea5e9");var title=String(bundle&&bundle.title||"");var cta=String(bundle&&bundle.cta||"أضف الباقة");var html='<div class="bundle-app-row"><div><div class="bundle-app-title"></div><div class="bundle-app-sub"></div></div><button class="bundle-app-btn" type="button"></button></div>';root.innerHTML=html;root.querySelector(".bundle-app-title").textContent=title;root.querySelector(".bundle-app-sub").textContent="";var btn=root.querySelector(".bundle-app-btn");btn.textContent=cta;btn.onclick=async function(){try{btn.disabled=true;var items=(bundle&&bundle.bundleItems)||[];for(var i=0;i<items.length;i++){var it=items[i]||{};var pid=Number(it.productId);var qty=Math.max(1,Math.floor(Number(it.quantity||1)));if(!Number.isFinite(pid)||pid<=0)continue;if(window.salla&&window.salla.cart&&typeof window.salla.cart.addItem==="function"){await window.salla.cart.addItem({id:pid,quantity:qty})}}btn.disabled=false}catch(e){btn.disabled=false}}}function clearProductBanner(){var root=document.getElementById("bundle-app-banner");if(root)root.remove()}async function refreshProduct(){try{var variantId=findVariantId();if(!variantId){clearProductBanner();return}var res=await getProductBundles(variantId);var bundles=(res&&res.bundles)||[];if(!bundles.length){clearProductBanner();return}renderProductBanner(bundles[0])}catch(e){}}function initAuto(){var inited=false;function start(){if(inited)return;inited=true;refreshProduct();setInterval(refreshProduct,1500)}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",start)}else{start()}}window.BundleApp=window.BundleApp||{};window.BundleApp.getProductBundles=getProductBundles;window.BundleApp.getCartBanner=getCartBanner;window.BundleApp.refreshProduct=refreshProduct;initAuto();})();`;

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

      js = buildStorefrontSnippetJsV2(merchantId, token);
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
      const bundles = productId ? await bundleService.getBundlesForProduct(merchant.merchantId, productId) : [];

      const componentVariantIds = Array.from(
        new Set(
          bundles
            .flatMap((b) => (Array.isArray(b?.components) ? b.components : []))
            .map((c) => String(c?.variantId || "").trim())
            .filter(Boolean)
        )
      );

      const componentReport = componentVariantIds.length
        ? await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, componentVariantIds, { concurrency: 4, maxAttempts: 3 })
        : { snapshots: new Map(), missing: [] };

      const combinedSnapshots = new Map(componentReport.snapshots);
      if (snap) combinedSnapshots.set(String(value.variantId), snap);
      const combinedMissing = [...(variantReport.missing || []), ...(componentReport.missing || [])];

      const safeBundles = bundles.map((b) => serializeBundleForStorefront(b, combinedSnapshots, productId));

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
      const bundles = triggerProductId ? await bundleService.getBundlesForProduct(merchant.merchantId, triggerProductId) : [];

      const componentVariantIds = Array.from(
        new Set(
          bundles
            .flatMap((b) => (Array.isArray(b?.components) ? b.components : []))
            .map((c) => String(c?.variantId || "").trim())
            .filter(Boolean)
        )
      );

      const componentReport = componentVariantIds.length
        ? await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, componentVariantIds, { concurrency: 4, maxAttempts: 3 })
        : { snapshots: new Map(), missing: [] };

      const safeBundles = bundles.map((b) => serializeBundleForStorefront(b, componentReport.snapshots, triggerProductId));

      const inactiveVariantIds = Array.from(componentReport.snapshots.values())
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
          missing: componentReport.missing || [],
          inactive: inactiveVariantIds
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

      const bundles = await bundleService.getBundlesForProduct(String(req.params.storeId), String(req.params.productId));
      const componentVariantIds = Array.from(
        new Set(
          bundles
            .flatMap((b) => (Array.isArray(b?.components) ? b.components : []))
            .map((c) => String(c?.variantId || "").trim())
            .filter(Boolean)
        )
      );
      const componentReport = componentVariantIds.length
        ? await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, componentVariantIds, { concurrency: 4, maxAttempts: 3 })
        : { snapshots: new Map(), missing: [] };

      const triggerProductId = String(req.params.productId || "").trim();
      const safeBundles = bundles.map((b) => serializeBundleForStorefront(b, componentReport.snapshots, triggerProductId));

      const inactiveVariantIds = Array.from(componentReport.snapshots.values())
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
          missing: componentReport.missing || [],
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

      const items = bValue.items;
      const variantIds = Array.from(new Set(items.map((i) => String(i.variantId)).filter(Boolean)));
      const report = await fetchVariantsSnapshotReport(config.salla, merchant.accessToken, variantIds, { concurrency: 5, maxAttempts: 3 });
      const inactive = Array.from(report.snapshots.values())
        .filter((s) => s?.isActive !== true)
        .map((s) => s.variantId);

      const evaluation = await bundleService.evaluateBundles(merchant, items, report.snapshots);
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
