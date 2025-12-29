module.exports = [
  `
async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let j = null;
  try {
    j = t ? JSON.parse(t) : null;
  } catch (e) {
    throw new Error("Invalid JSON response");
  }
  if (!r.ok) {
    const msg = (j && j.message) || "HTTP " + r.status;
    const err = new Error(msg);
    err.status = r.status;
    err.details = j;
    throw err;
  }
  return j;
}

function getBackendOrigin() {
  try {
    const src = String(typeof scriptSrc === "string" ? scriptSrc : "").trim();
    if (src) return new URL(src).origin;
  } catch (e) {}
  try {
    const cs = document.currentScript;
    const src2 = String((cs && cs.src) || "").trim();
    if (src2) return new URL(src2).origin;
  } catch (e2) {}
  return "";
}

function buildUrl(path, params) {
  const origin = getBackendOrigin();
  if (!origin) return null;
  const u = new URL(origin + path);
  for (const k in params || {}) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    const v = params[k];
    if (v == null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  u.searchParams.set("merchantId", merchantId);
  u.searchParams.set("token", token);
  return u.toString();
}

async function getProductBundlesByVariantId(variantId) {
  const v = String(variantId || "").trim();
  if (!v) return null;
  const u = buildUrl("/api/proxy/bundles/product", { variantId: v });
  if (!u) return null;
  return fetchJson(u);
}

async function getProductBundlesByProductId(productId) {
  const p = String(productId || "").trim();
  if (!p) return null;
  const u = buildUrl("/api/proxy/bundles/for-product", { productId: p });
  if (!u) return null;
  return fetchJson(u);
}

async function requestApplyBundle(bundleId, items) {
  const payload = {
    bundleId: String(bundleId || ""),
    items: Array.isArray(items) ? items : []
  };
  const u = buildUrl("/api/proxy/bundles/apply", {});
  if (!u) return null;
  return fetchJson(u, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function getProductVariantsByProductId(productId) {
  const p = String(productId || "").trim();
  if (!p) return null;
  const u = buildUrl("/api/proxy/products/variants", { productId: p });
  if (!u) return null;
  return fetchJson(u);
}
`,
  `
function isProductRef(variantId) {
  return String(variantId || "").trim().indexOf("product:") === 0;
}

var variantsCacheByProductId = {};
var variantsPendingByProductId = {};

async function getCachedVariants(productId) {
  const pid = String(productId || "").trim();
  if (!pid) return [];
  if (Object.prototype.hasOwnProperty.call(variantsCacheByProductId, pid)) return variantsCacheByProductId[pid] || [];

  const pend = variantsPendingByProductId[pid];
  if (pend && pend.then) return pend;

  const p = (async function () {
    try {
      const res = await getProductVariantsByProductId(pid);
      const vars = (res && res.variants) || [];
      variantsCacheByProductId[pid] = Array.isArray(vars) ? vars : [];
      return variantsCacheByProductId[pid];
    } finally {
      try {
        delete variantsPendingByProductId[pid];
      } catch (e) {
        variantsPendingByProductId[pid] = null;
      }
    }
  })();

  variantsPendingByProductId[pid] = p;
  return p;
}

function stringifyAttrs(attrs) {
  try {
    if (!attrs || typeof attrs !== "object") return "";
    const parts = [];
    for (const k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      const key = String(k || "").trim();
      const v = attrs[k];
      if (v == null) continue;
      const vs = String(v || "").trim();
      if (!vs) continue;
      parts.push((key ? key + ": " : "") + vs);
    }
    return parts.join(" • ");
  } catch (e) {
    return "";
  }
}

function variantLabel(v) {
  const id = String((v && v.variantId) || "").trim();
  const name = String((v && v.name) || "").trim();
  const attrs = stringifyAttrs(v && v.attributes);
  const price = v && v.price != null ? Number(v.price) : null;
  const priceText = Number.isFinite(price) && price >= 0 ? fmtMoney(price) : "";

  let base = "";
  if (attrs && name) base = name + " • " + attrs;
  else if (attrs) base = attrs;
  else if (name) base = name;
  else if (id) base = id;

  if (base && priceText) return base + " • " + priceText;
  if (base) return base;
  if (priceText) return priceText;
  return "—";
}

function normHex(s) {
  try {
    const x = String(s || "").trim();
    if (!x) return "";
    const m = x.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (!m) return "";
    return x.charAt(0) === "#" ? x : "#" + x;
  } catch (e) {
    return "";
  }
}

function escCssUrl(u) {
  try {
    let s = String(u || "").trim();
    if (!s) return "";
    s = s.replace(/[\\n\\r\\t\\f\\\\\\"'()<>]/g, "");
    return s;
  } catch (e) {
    return "";
  }
}

function pickVariantSwatch(v) {
  try {
    const img = String((v && v.imageUrl) || "").trim();
    if (img) return { t: "img", v: img };
    const attrs = v && v.attributes && typeof v.attributes === "object" ? v.attributes : null;
    if (attrs) {
      for (const k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        const hex = normHex(attrs[k]);
        if (hex) return { t: "hex", v: hex };
      }
    }
    const hex2 = normHex(v && v.name);
    if (hex2) return { t: "hex", v: hex2 };
    return null;
  } catch (e) {
    return null;
  }
}

function variantOptionInnerHtml(v) {
  const sw = pickVariantSwatch(v);
  let out = "";
  if (sw && sw.t === "img") {
    const u = escCssUrl(sw.v);
    if (u) {
      out +=
        '<span class="bundle-app-variant-swatch is-image" style="background-image:url(\\'' +
        escHtml(u) +
        '\\')"></span>';
    }
  } else if (sw && sw.t === "hex" && sw.v) {
    out += '<span class="bundle-app-variant-swatch" style="background:' + escHtml(sw.v) + '"></span>';
  }
  out += '<span class="bundle-app-variant-text">' + escHtml(variantLabel(v)) + "</span>";
  return out;
}

var selectedBundleId = null;
var lastTriggerProductId = null;
var messageByBundleId = {};
var selectedTierByBundleId = {};
var applying = false;
var variantSelectionsByBundleId = {};
var postAddShownByBundleId = {};
var variantPickerCacheByBundleId = {};
var variantPickerPendingByBundleId = {};

function getBundleVariantSelectionMap(bundleId) {
  const bid = String(bundleId || "").trim();
  if (!bid) return null;
  let m = variantSelectionsByBundleId[bid];
  if (!m || typeof m !== "object") m = {};
  variantSelectionsByBundleId[bid] = m;
  return m;
}

function bundleVariantSig(bundle) {
  try {
    const items = normalizeItems(bundle);
    const parts = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const v = String(it.variantId || "").trim();
      if (!isProductRef(v)) continue;
      const pid = String(it.productId || "").trim();
      if (!pid) continue;
      const qty = Math.max(1, Math.floor(Number(it.quantity || 1)));
      parts.push(pid + "x" + qty);
    }
    parts.sort();
    return parts.join("|");
  } catch (e) {
    return "";
  }
}

function bundleVariantUnits(bundle) {
  const items = normalizeItems(bundle);
  const units = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const v = String(it.variantId || "").trim();
    if (!isProductRef(v)) continue;
    const pid = String(it.productId || "").trim();
    if (!pid) continue;
    const qty = Math.max(1, Math.floor(Number(it.quantity || 1)));
    for (let u = 0; u < qty; u++) {
      units.push({ productId: pid, key: pid + ":" + u });
    }
  }
  return units;
}

function pruneBundleSelections(sel, units) {
  try {
    if (!sel || typeof sel !== "object") return;
    const keep = {};
    for (let i = 0; i < units.length; i++) keep[String((units[i] && units[i].key) || "")] = true;
    for (const k in sel) {
      if (!Object.prototype.hasOwnProperty.call(sel, k)) continue;
      if (!keep[k]) {
        try {
          delete sel[k];
        } catch (e) {
          sel[k] = null;
        }
      }
    }
  } catch (e) {}
}

function escHtml(input) {
  const s = String(input == null ? "" : input);
  return s.replace(/[&<>"']/g, function (ch) {
    return ch === "&"
      ? "&amp;"
      : ch === "<"
        ? "&lt;"
        : ch === ">"
          ? "&gt;"
          : ch === '"'
            ? "&quot;"
            : "&#39;";
  });
}

function fmtNum(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  try {
    return x.toLocaleString("ar-SA");
  } catch (e) {
    return String(x);
  }
}

function fmtMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const v = Math.round(x * 100) / 100;
  let s;
  try {
    s = v.toLocaleString("ar-SA", {
      minimumFractionDigits: v % 1 ? 2 : 0,
      maximumFractionDigits: 2
    });
  } catch (e) {
    s = String(v);
  }
  return s + " ر.س";
}

function normalizeTitle(raw) {
  let title = String(raw || "");
  if (!title || title === "Bundle") title = "باقة";
  try {
    title = title.replace(/^Bundle\\s*-\\s*/i, "باقة - ");
  } catch (e) {}
  return title;
}

function minRequiredBaseQty(bundle) {
  return 1;
}

function selectionKey(triggerProductId) {
  return "bundle_app_selected_bundle:" + String(merchantId || "") + ":" + String(triggerProductId || "");
}

function pendingKey(triggerProductId) {
  return "bundle_app_pending_coupon:" + String(merchantId || "") + ":" + String(triggerProductId || "");
}

function pendingAnyKey() {
  return "bundle_app_pending_coupon:" + String(merchantId || "");
}

function loadSelection(triggerProductId) {
  try {
    const raw = localStorage.getItem(selectionKey(triggerProductId));
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && typeof j === "object" ? j : null;
  } catch (e) {
    return null;
  }
}

function saveSelection(triggerProductId, data) {
  try {
    localStorage.setItem(selectionKey(triggerProductId), JSON.stringify(data || {}));
  } catch (e) {}
}

function clearSelection(triggerProductId) {
  try {
    localStorage.removeItem(selectionKey(triggerProductId));
  } catch (e) {}
}
`,
  `
function isCartLikePage() {
  try {
    const p = String(window.location.pathname || "").toLowerCase();
    return p.indexOf("cart") !== -1 || p.indexOf("checkout") !== -1;
  } catch (e) {
    return false;
  }
}

async function tryApplyCoupon(code) {
  const c = String(code || "").trim();
  if (!c) return false;
  if (storeClosedNow()) return false;
  try {
    const cart = window.salla && window.salla.cart;
    let applied = false;
    if (cart && typeof cart.applyCoupon === "function") {
      await cart.applyCoupon(c);
      applied = true;
    } else if (cart && cart.coupon && typeof cart.coupon.apply === "function") {
      await cart.coupon.apply(c);
      applied = true;
    } else if (cart && cart.coupon && typeof cart.coupon.set === "function") {
      await cart.coupon.set(c);
      applied = true;
    } else if (cart && typeof cart.setCoupon === "function") {
      await cart.setCoupon(c);
      applied = true;
    } else if (cart && typeof cart.addCoupon === "function") {
      await cart.addCoupon(c);
      applied = true;
    } else if (window.salla && typeof window.salla.applyCoupon === "function") {
      await window.salla.applyCoupon(c);
      applied = true;
    } else if (window.salla && window.salla.coupon && typeof window.salla.coupon.apply === "function") {
      await window.salla.coupon.apply(c);
      applied = true;
    }
    if (applied) {
      try {
        g.BundleApp._lastCouponApplyStatus = null;
        g.BundleApp._lastCouponApplyMessage = "";
      } catch (x0) {}
      return true;
    }
    return false;
  } catch (e) {
    const st = extractHttpStatus(e);
    const msg = extractHttpMessage(e);
    try {
      g.BundleApp._lastCouponApplyStatus = st;
      g.BundleApp._lastCouponApplyMessage = String(msg || "");
    } catch (x1) {}
    markStoreClosed({ status: st, message: msg });
    if (storeClosedNow()) return false;
    warn("bundle-app: coupon apply failed", e && (e.details || e.message || e));
    return false;
  }
}

function extractHttpStatus(e) {
  try {
    const s =
      (e &&
        ((e.statusCode != null && e.statusCode) ||
          (e.status != null && e.status) ||
          (e.response && e.response.status) ||
          (e.request && e.request.status))) ||
      null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  } catch (x) {
    return null;
  }
}

function extractHttpMessage(e) {
  try {
    let m = "";
    if (e && e.details && typeof e.details === "object") {
      m = String(e.details.message || e.details.error || e.details.title || "").trim();
      if (!m && e.details.data && typeof e.details.data === "object") {
        m = String(e.details.data.message || e.details.data.error || e.details.data.title || "").trim();
      }
    }
    if (!m && e && e.response && e.response.data != null) {
      const d = e.response.data;
      if (typeof d === "string") {
        m = String(d || "").trim();
      } else if (typeof d === "object") {
        m = String(d.message || d.error || d.title || "").trim();
        if (!m && d.data && typeof d.data === "object") {
          m = String(d.data.message || d.data.error || d.data.title || "").trim();
        }
      }
    }
    if (!m && e) m = String(e.message || "").trim();
    return m;
  } catch (x) {
    return "";
  }
}

function storeClosedNow() {
  try {
    const until = Number((g.BundleApp && g.BundleApp._storeClosedUntil) || 0);
    return Number.isFinite(until) && until > Date.now();
  } catch (e) {
    return false;
  }
}

function markStoreClosed(e) {
  try {
    const st = extractHttpStatus(e);
    const msg = extractHttpMessage(e);
    const m = String(msg || "");
    const ml = m.toLowerCase();
    let isClosed = Boolean(
      m.indexOf("المتجر مغلق") !== -1 ||
        m.indexOf("المتجر مغلق حالياً") !== -1 ||
        m.indexOf("المتجر مغلق حاليا") !== -1 ||
        ml.indexOf("store is closed") !== -1 ||
        (ml.indexOf("closed") !== -1 && ml.indexOf("store") !== -1)
    );
    if (!isClosed && Number(st) === 410) isClosed = Boolean(m.indexOf("مغلق") !== -1 || ml.indexOf("closed") !== -1);
    if (isClosed) g.BundleApp._storeClosedUntil = Date.now() + 60000;
  } catch (x) {}
}

function humanizeCartError(e) {
  try {
    const st = extractHttpStatus(e);
    const msg = extractHttpMessage(e);
    if (Number(st) === 410) {
      const m = String(msg || "").toLowerCase();
      if (m.indexOf("مغلق") !== -1) return "المتجر مغلق";
      if (m.indexOf("closed") !== -1) return "المتجر مغلق";
    }
    if (Number(st) === 429) return "تم حظرك مؤقتاً";
    if (Number(st) === 404) return "المنتج غير موجود";
    if (Number(st) === 401) return "غير مصرح";
    if (Number(st) === 403) return "غير مصرح";
    if (Number(st) === 400) {
      const m2 = String(msg || "");
      const ml2 = m2.toLowerCase();
      if (
        m2.indexOf("لا يشمل") !== -1 ||
        m2.indexOf("كوبون") !== -1 ||
        ml2.indexOf("coupon") !== -1 ||
        ml2.indexOf("eligible") !== -1 ||
        ml2.indexOf("not applicable") !== -1
      ) {
        return "المنتجات في السلة لا يشملها الكوبون";
      }
      return "طلب غير صالح";
    }
    if (Number(st) === 422) return "بيانات غير صالحة";
    if (Number(st) === 500) return "خطأ في الخادم";
    if (Number(st) === 503) return "الخدمة غير متاحة";
    if (Number(st) === 504) return "انتهت مهلة الخادم";
    if (msg && msg.indexOf("timeout") !== -1) return "انتهت المهلة";
    return null;
  } catch (e2) {
    return null;
  }
}

async function removeItemsFromCart(items) {
  if (storeClosedNow()) return;
  const cart = window.salla && window.salla.cart;
  if (!cart) throw new Error("Salla cart API not available");

  const arr = Array.isArray(items) ? items : [];
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i] || {};
    let v = String(it.variantId || "").trim();
    let pid = String(it.productId || "").trim();
    if (v && v.indexOf("product:") === 0) {
      if (!pid) pid = String(v).slice("product:".length).trim();
      v = "";
    }
    const pidNum = Number(pid);
    try {
      if (cart && typeof cart.removeItem === "function") {
        if (v) await cart.removeItem(v);
        else if (pid && Number.isFinite(pidNum) && pidNum > 0) await cart.removeItem(pidNum);
        continue;
      }
      if (cart && typeof cart.deleteItem === "function") {
        if (v) await cart.deleteItem(v);
        else if (pid && Number.isFinite(pidNum) && pidNum > 0) await cart.deleteItem(pidNum);
        continue;
      }
      if (cart && typeof cart.updateItem === "function") {
        if (v) await cart.updateItem({ id: v, quantity: 0 });
        else if (pid && Number.isFinite(pidNum) && pidNum > 0) await cart.updateItem({ id: pidNum, quantity: 0 });
        continue;
      }
      if (cart && typeof cart.setItemQuantity === "function") {
        if (v) await cart.setItemQuantity(v, 0);
        else if (pid && Number.isFinite(pidNum) && pidNum > 0) await cart.setItemQuantity(pidNum, 0);
        continue;
      }
    } catch (e) {
      const st = extractHttpStatus(e);
      const msg = extractHttpMessage(e);
      markStoreClosed({ status: st, message: msg });
      if (storeClosedNow()) return;
      if (st === 410) continue;
      warn("bundle-app: remove item failed", e && (e.details || e.message || e));
    }
  }
}

async function tryClearCoupon() {
  try {
    const cart = window.salla && window.salla.cart;
    let cleared = false;
    if (cart && typeof cart.clearCoupon === "function") {
      await cart.clearCoupon();
      cleared = true;
    } else if (cart && cart.coupon && typeof cart.coupon.clear === "function") {
      await cart.coupon.clear();
      cleared = true;
    } else if (cart && cart.coupon && typeof cart.coupon.remove === "function") {
      await cart.coupon.remove();
      cleared = true;
    } else if (cart && typeof cart.removeCoupon === "function") {
      await cart.removeCoupon();
      cleared = true;
    } else if (window.salla && typeof window.salla.clearCoupon === "function") {
      await window.salla.clearCoupon();
      cleared = true;
    }
    if (cleared) {
      try {
        g.BundleApp._lastCouponClearStatus = null;
        g.BundleApp._lastCouponClearMessage = "";
      } catch (x0) {}
    }
  } catch (e) {
    const st = extractHttpStatus(e);
    const msg = extractHttpMessage(e);
    try {
      g.BundleApp._lastCouponClearStatus = st;
      g.BundleApp._lastCouponClearMessage = String(msg || "");
    } catch (x1) {}
    markStoreClosed({ status: st, message: msg });
  }
}
`,
  `
function getDefaultMinQty() {
  return 1;
}

function getPageQty() {
  try {
    const qty = Number(window.salla && window.salla.config && window.salla.config.product && window.salla.config.product.quantity);
    if (Number.isFinite(qty) && qty >= 1) return Math.floor(qty);
    return 1;
  } catch (e) {
    return 1;
  }
}

function pickMinQty(bundle) {
  try {
    const bid = String((bundle && bundle.id) || "").trim();
    const v = Number(selectedTierByBundleId[bid]);
    if (Number.isFinite(v) && v >= 1) return Math.floor(v);
    return 1;
  } catch (e) {
    return 1;
  }
}

function pickPricingForQty(bundle, qty) {
  try {
    const base = (bundle && bundle.pricing && bundle.pricing.base) || null;
    const tiers = (bundle && bundle.pricing && bundle.pricing.tiers) || [];
    const q = Math.max(1, Math.floor(Number(qty || 1)));
    if (Array.isArray(tiers) && tiers.length) {
      let best = null;
      for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i] || {};
        const mq = Math.max(1, Math.floor(Number(t.minQty || 1)));
        if (mq === q) return t;
        if (mq <= q && (best == null || mq > best.minQty)) best = t;
      }
      if (best) return best;
    }
    return base;
  } catch (e) {
    return (bundle && bundle.pricing && bundle.pricing.base) || null;
  }
}

function pctFrom(original, final) {
  try {
    const o = Number(original);
    const f = Number(final);
    if (!Number.isFinite(o) || !Number.isFinite(f) || o <= 0) return null;
    const diff = o - f;
    if (diff <= 0) return null;
    const pct = Math.round((diff / o) * 100);
    return Number.isFinite(pct) && pct > 0 ? pct : null;
  } catch (e) {
    return null;
  }
}

function normalizeItems(bundle) {
  let comps = (bundle && bundle.components) || [];
  if (!Array.isArray(comps) || !comps.length) comps = (bundle && bundle.bundleItems) || [];

  const out = [];
  const baseMin = minRequiredBaseQty(bundle);
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i] || {};
    const v = String(c.variantId || "").trim();
    const pid = String(c.productId || "").trim();
    const isBase = Boolean(c.isBase);
    const q = isBase ? Math.max(getPageQty(), baseMin) : Math.max(1, Math.floor(Number(c.quantity || 1)));
    if (!v) continue;
    out.push({ variantId: v, productId: pid || null, quantity: q, isBase: isBase });
  }
  out.sort(function (a, b) {
    return String(a.variantId).localeCompare(String(b.variantId));
  });
  return out;
}

function buildItemsText(items) {
  let products = 0;
  let totalQty = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    if (!it.variantId) continue;
    products++;
    totalQty += Math.max(1, Math.floor(Number(it.quantity || 1)));
  }
  return "عدد المنتجات: " + fmtNum(products) + " • إجمالي القطع: " + fmtNum(totalQty);
}

function computeQtyItems(bundle, opts) {
  try {
    const comps = (bundle && bundle.components) || [];
    const qSel = pickMinQty(bundle);
    let baseQty = Math.max(1, Math.floor(Number(getPageQty() || 1)));
    if (Number.isFinite(qSel) && qSel > baseQty) baseQty = qSel;

    const items = [];
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i] || {};
      const v = String(c.variantId || "").trim();
      const pid = String(c.productId || "").trim();
      const isBase = Boolean(c.isBase);
      const qty = isBase ? baseQty : Math.max(1, Math.floor(Number(c.quantity || 1)));
      if (!v) continue;
      items.push({ variantId: v, productId: pid || null, quantity: qty, isBase: isBase });
    }
    items.sort(function (a, b) {
      return String(a.variantId).localeCompare(String(b.variantId));
    });

    const mode = String((opts && opts.mode) || "apply");
    if (mode === "preview") {
      const bid = String((bundle && bundle.id) || "").trim();
      const sel = getBundleVariantSelectionMap(bid) || {};
      const out = [];
      for (let j = 0; j < items.length; j++) {
        const it = items[j] || {};
        const vid = String(it.variantId || "").trim();
        if (vid.indexOf("product:") === 0) {
          const ref = String(it.productId || "").trim();
          let pickedCount = 0;
          const qty2 = Math.max(1, Math.floor(Number(it.quantity || 1)));
          for (let u = 0; u < qty2; u++) {
            const key = ref + ":" + u;
            const pv = String(sel[key] || "").trim();
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = ref + ":" + p;
            const pv2 = String(sel[key2] || "").trim();
            const useVid = pv2 || vid;
            out.push({ variantId: useVid, productId: ref || null, quantity: 1, isBase: it.isBase });
          }
        } else {
          out.push(it);
        }
      }
      return out;
    }

    return items;
  } catch (e) {
    return [];
  }
}

function computeProductsItems(bundle, opts) {
  try {
    const comps = (bundle && bundle.components) || [];
    const settings = (bundle && bundle.settings) || {};
    const req = Boolean(settings && settings.selectionRequired === true);
    const defIds = Array.isArray(settings && settings.defaultSelectedProductIds) ? settings.defaultSelectedProductIds : [];
    const include = new Set(defIds.map(function (x) { return String(x || "").trim(); }).filter(Boolean));

    const bid = String((bundle && bundle.id) || "").trim();
    const sel = getBundleVariantSelectionMap(bid) || {};
    const items = [];

    for (let i = 0; i < comps.length; i++) {
      const c = comps[i] || {};
      const v = String(c.variantId || "").trim();
      const pid = String(c.productId || "").trim();
      const qty = Math.max(1, Math.floor(Number(c.quantity || 1)));
      if (!v) continue;

      const should = include.size ? include.has(pid) : !req;
      if (!should) continue;

      if (v.indexOf("product:") === 0) {
        const mode = String((opts && opts.mode) || "apply");
        if (mode === "preview") {
          let pickedCount = 0;
          for (let u = 0; u < qty; u++) {
            const key = pid + ":" + u;
            const pv = String(sel[key] || "").trim();
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = pid + ":" + p;
            const pv2 = String(sel[key2] || "").trim();
            if (!pv2 && settings && settings.variantRequired !== false) continue;
            items.push({ variantId: pv2 || v, productId: pid || null, quantity: 1, isBase: false });
          }
        } else {
          let pickedAll = true;
          const parts = [];
          for (let u2 = 0; u2 < qty; u2++) {
            const key3 = pid + ":" + u2;
            const pv3 = String(sel[key3] || "").trim();
            if (!pv3) pickedAll = false;
            parts.push(pv3 || v);
          }
          if (req && settings && settings.variantRequired !== false && !pickedAll) continue;
          for (let m = 0; m < parts.length; m++) {
            items.push({ variantId: parts[m], productId: pid || null, quantity: 1, isBase: false });
          }
        }
      } else {
        items.push({ variantId: v, productId: pid || null, quantity: qty, isBase: false });
      }
    }

    items.sort(function (a, b) {
      return String(a.variantId).localeCompare(String(b.variantId));
    });
    return items;
  } catch (e) {
    return [];
  }
}

function computeNoDiscountItems(bundle, opts) {
  try {
    const comps = (bundle && bundle.components) || [];
    const settings = (bundle && bundle.settings) || {};
    const req = Boolean(settings && settings.selectionRequired === true);
    const defIds = Array.isArray(settings && settings.defaultSelectedProductIds) ? settings.defaultSelectedProductIds : [];
    const include = new Set(defIds.map(function (x) { return String(x || "").trim(); }).filter(Boolean));

    const bid = String((bundle && bundle.id) || "").trim();
    const sel = getBundleVariantSelectionMap(bid) || {};
    const items = [];

    for (let i = 0; i < comps.length; i++) {
      const c = comps[i] || {};
      const v = String(c.variantId || "").trim();
      const pid = String(c.productId || "").trim();
      const qty = Math.max(1, Math.floor(Number(c.quantity || 1)));
      if (!v) continue;

      const should = include.size ? include.has(pid) : !req;
      if (!should) continue;

      if (v.indexOf("product:") === 0) {
        const mode = String((opts && opts.mode) || "apply");
        if (mode === "preview") {
          let pickedCount = 0;
          for (let u = 0; u < qty; u++) {
            const key = pid + ":" + u;
            const pv = String(sel[key] || "").trim();
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = pid + ":" + p;
            const pv2 = String(sel[key2] || "").trim();
            items.push({ variantId: pv2 || v, productId: pid || null, quantity: 1, isBase: false });
          }
        } else {
          for (let m = 0; m < qty; m++) {
            const key3 = pid + ":" + m;
            const pv3 = String(sel[key3] || "").trim();
            items.push({ variantId: pv3 || v, productId: pid || null, quantity: 1, isBase: false });
          }
        }
      } else {
        items.push({ variantId: v, productId: pid || null, quantity: qty, isBase: false });
      }
    }

    items.sort(function (a, b) {
      return String(a.variantId).localeCompare(String(b.variantId));
    });
    return items;
  } catch (e) {
    return [];
  }
}

function computePostAddItems(bundle, opts) {
  try {
    const comps = (bundle && bundle.components) || [];
    const bid = String((bundle && bundle.id) || "").trim();
    const sel = getBundleVariantSelectionMap(bid) || {};
    const items = [];

    for (let i = 0; i < comps.length; i++) {
      const c = comps[i] || {};
      const v = String(c.variantId || "").trim();
      const pid = String(c.productId || "").trim();
      const qty = Math.max(1, Math.floor(Number(c.quantity || 1)));
      if (!v) continue;

      if (v.indexOf("product:") === 0) {
        const mode = String((opts && opts.mode) || "apply");
        if (mode === "preview") {
          let pickedCount = 0;
          for (let u = 0; u < qty; u++) {
            const key = pid + ":" + u;
            const pv = String(sel[key] || "").trim();
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = pid + ":" + p;
            const pv2 = String(sel[key2] || "").trim();
            items.push({ variantId: pv2 || v, productId: pid || null, quantity: 1, isBase: false });
          }
        } else {
          for (let m = 0; m < qty; m++) {
            const key3 = pid + ":" + m;
            const pv3 = String(sel[key3] || "").trim();
            items.push({ variantId: pv3 || v, productId: pid || null, quantity: 1, isBase: false });
          }
        }
      } else {
        items.push({ variantId: v, productId: pid || null, quantity: qty, isBase: false });
      }
    }

    items.sort(function (a, b) {
      return String(a.variantId).localeCompare(String(b.variantId));
    });
    return items;
  } catch (e) {
    return [];
  }
}

function computeBundleApplyItems(bundle, opts) {
  try {
    const mode = String((opts && opts.mode) || "apply");
    const kind = String((bundle && bundle.kind) || "").trim();
    if (kind === "quantity_discount") return computeQtyItems(bundle, { mode: mode });
    if (kind === "products_discount") return computeProductsItems(bundle, { mode: mode });
    if (kind === "products_no_discount") return computeNoDiscountItems(bundle, { mode: mode });
    if (kind === "post_add_upsell") return computePostAddItems(bundle, { mode: mode });
    return computeQtyItems(bundle, { mode: mode });
  } catch (e) {
    return normalizeItems(bundle);
  }
}

function buildTierRows(bundle, bundleId, selectedMinQty, isBundleSelected) {
  try {
    const tiers = (bundle && bundle.offer && bundle.offer.tiers) || [];
    const pricingTiers = (bundle && bundle.pricing && bundle.pricing.tiers) || [];
    const rows = [];

    if (Array.isArray(tiers) && tiers.length) {
      for (let i = 0; i < tiers.length; i++) {
        const mq = Math.max(1, Math.floor(Number((tiers[i] && tiers[i].minQty) || 1)));
        let pr = null;
        for (let j = 0; j < pricingTiers.length; j++) {
          const pt = pricingTiers[j] || {};
          if (Math.floor(Number(pt.minQty || 0)) === mq) {
            pr = pt;
            break;
          }
        }
        rows.push({ minQty: mq, pricing: pr });
      }
    } else {
      rows.push({ minQty: 1, pricing: pickPricingForQty(bundle, 1) });
    }

    rows.sort(function (a, b) {
      return a.minQty - b.minQty;
    });

    let out = "";
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k];
      const prc = r.pricing || {};
      const o = Number(prc.originalTotal);
      const f = Number(prc.finalTotal);
      const d = Number(prc.discountAmount);
      const left = "عند " + fmtNum(r.minQty) + " قطع";
      let right = "";
      if (Number.isFinite(o) && Number.isFinite(f)) {
        right = "قبل " + fmtMoney(o) + " • بعد " + fmtMoney(f);
        if (Number.isFinite(d) && d > 0) {
          right += " • وفّرت " + fmtMoney(d);
          const pct = pctFrom(o, f);
          if (pct != null) right += " (" + fmtNum(pct) + "%)";
        }
      }
      const active = Boolean(isBundleSelected && Number(selectedMinQty) === Number(r.minQty));
      const cls = "bundle-app-tier" + (active ? " bundle-app-tier--selected" : "");
      out +=
        '<label class="' +
        cls +
        '" data-bundle-id="' +
        escHtml(bundleId) +
        '" data-tier-minqty="' +
        escHtml(r.minQty) +
        '">' +
        '<div class="bundle-app-tier-main"><div><strong>' +
        escHtml(left) +
        "</strong></div>" +
        (right ? '<div class="bundle-app-muted">' + escHtml(right) + "</div>" : "") +
        '</div><span class="bundle-app-checkwrap bundle-app-tier-checkwrap"><input class="bundle-app-tier-check" type="checkbox" data-bundle-id="' +
        escHtml(bundleId) +
        '" data-tier-minqty="' +
        escHtml(r.minQty) +
        '" ' +
        (active ? "checked" : "") +
        ' /><span class="bundle-app-checkmark"></span></span></label>' +
        (active ? '<div class="bundle-app-pickers bundle-app-pickers--inline" data-bundle-id="' + escHtml(bundleId) + '"></div>' : "");
    }
    return out;
  } catch (e) {
    return "";
  }
}

function buildPriceText(bundle) {
  try {
    const selected = pickMinQty(bundle);
    let baseQty = Math.max(1, Math.floor(Number(getPageQty() || 1)));
    if (Number.isFinite(selected) && selected > baseQty) baseQty = selected;
    const p = pickPricingForQty(bundle, baseQty);
    if (!p) return "";
    const o = Number(p.originalTotal);
    const f = Number(p.finalTotal);
    const d = Number(p.discountAmount);
    if (!Number.isFinite(o) || !Number.isFinite(f)) return "";
    let s = "قبل " + fmtMoney(o) + " • بعد " + fmtMoney(f);
    if (Number.isFinite(d) && d > 0) s += " • وفّرت " + fmtMoney(d);
    return s;
  } catch (e) {
    return "";
  }
}
`,
  `
async function applyBundleSelection(bundle) {
  const bid = String((bundle && bundle.id) || "").trim();
  const trigger = String((bundle && bundle.triggerProductId) || "").trim();
  const kind = String((bundle && bundle.kind) || "").trim();

  if (!bid) return;
  if (!trigger && kind !== "products_no_discount" && kind !== "post_add_upsell") return;

  if (storeClosedNow()) {
    messageByBundleId[bid] = "لم يتم إضافة الباقة (المتجر مغلق حالياً)";
    applying = false;
    try {
      renderProductBanners(lastBundles || []);
    } catch (e0) {}
    return;
  }

  if (kind === "post_add_upsell" && postAddShownByBundleId[bid]) {
    messageByBundleId[bid] = "تم عرض الإضافة بالفعل";
    try {
      renderProductBanners(lastBundles || []);
    } catch (e00) {}
    return;
  }

  selectedBundleId = bid;
  applying = true;
  try {
    messageByBundleId[bid] = "جاري إضافة الباقة...";
    renderProductBanners(lastBundles || []);
  } catch (e) {}

  try {
    const rawItems = typeof computeBundleApplyItems === "function" ? computeBundleApplyItems(bundle) : normalizeItems(bundle);
    const items = await resolveProductRefItems(rawItems, bid);

    if (!items || !items.length) {
      messageByBundleId[bid] =
        kind === "products_discount" || kind === "products_no_discount" || kind === "post_add_upsell"
          ? "اختار المنتجات قبل الإضافة"
          : "لازم تختار الفاريانت قبل إضافة الباقة";
      applying = false;
      try {
        renderProductBanners(lastBundles || []);
      } catch (e000) {}
      return;
    }

    if (kind === "products_no_discount" || kind === "post_add_upsell") {
      try {
        await addItemsToCart(items);
        messageByBundleId[bid] = "تمت إضافة المنتجات للسلة";
        if (kind === "post_add_upsell") postAddShownByBundleId[bid] = true;
      } catch (addErr) {
        markStoreClosed(addErr);
        const hm = humanizeCartError(addErr);
        messageByBundleId[bid] = hm ? "لم يتم الإضافة (" + hm + ")" : "لم يتم الإضافة";
      }
      applying = false;
      try {
        renderProductBanners(lastBundles || []);
      } catch (e01) {}
      return;
    }

    let canDiscount = true;
    for (let i00 = 0; i00 < items.length; i00++) {
      const it00 = items[i00] || {};
      const vv00 = String((it00 && it00.variantId) || "");
      if (vv00 && vv00.indexOf("product:") === 0) {
        let pid00 = String(it00.productId || "").trim();
        if (!pid00) pid00 = String(vv00).slice("product:".length).trim();
        let vars00 = [];
        if (pid00 && typeof getCachedVariants === "function") {
          try {
            vars00 = await getCachedVariants(pid00);
          } catch (eVar0) {
            vars00 = [];
          }
        }
        if (vars00 && Array.isArray(vars00) && vars00.length > 1) {
          canDiscount = false;
          break;
        }
      }
    }

    const prev = loadSelection(trigger);
    try {
      await tryClearCoupon();
    } catch (eClr0) {}
    try {
      clearPendingCoupon(trigger);
    } catch (eClr1) {}
    if (prev && prev.bundleId && String(prev.bundleId) !== bid && Array.isArray(prev.items) && prev.items.length) {
      try {
        removeItemsFromCart(prev.items);
      } catch (eRem0) {}
    }

    if (storeClosedNow()) {
      messageByBundleId[bid] = "لم يتم إضافة الباقة (المتجر مغلق حالياً)";
      applying = false;
      try {
        renderProductBanners(lastBundles || []);
      } catch (e03) {}
      return;
    }

    try {
      await addItemsToCart(items);
    } catch (addErr2) {
      markStoreClosed(addErr2);
      const hm3 = humanizeCartError(addErr2);
      messageByBundleId[bid] = hm3 ? "لم يتم الإضافة (" + hm3 + ")" : "لم يتم الإضافة";
      applying = false;
      try {
        renderProductBanners(lastBundles || []);
      } catch (e030) {}
      return;
    }

    saveSelection(trigger, { bundleId: bid, items: items });
    messageByBundleId[bid] = "تمت إضافة الباقة للسلة";
    try {
      renderProductBanners(lastBundles || []);
    } catch (e0300) {}

    if (!canDiscount) {
      messageByBundleId[bid] = "تمت إضافة الباقة للسلة (اختر الفاريانت لتفعيل الخصم)";
      applying = false;
      try {
        renderProductBanners(lastBundles || []);
      } catch (e0301) {}
      return;
    }

    let res = null;
    try {
      res = await requestApplyBundle(bid, items);
    } catch (reqErr) {
      markStoreClosed(reqErr);
      messageByBundleId[bid] = "تمت إضافة الباقة للسلة لكن فشل تجهيز الخصم";
      try {
        clearPendingCoupon(trigger);
      } catch (e03100a) {}
      applying = false;
      try {
        renderProductBanners(lastBundles || []);
      } catch (e0310) {}
      return;
    }

    if (res && res.ok) {
      const cc = (res && (res.couponCode || (res.coupon && res.coupon.code))) || "";
      if (cc) {
        try {
          g.BundleApp._couponAutoApplyUntil = Date.now() + 90000;
        } catch (e03100) {}
        savePendingCoupon(trigger, { code: String(cc), ts: Date.now() });
        messageByBundleId[bid] = "تمت إضافة الباقة للسلة • جاري تفعيل الخصم";
        try {
          renderProductBanners(lastBundles || []);
        } catch (e0311) {}
        try {
          setTimeout(function () {
            try {
              applyPendingCouponForCart();
            } catch (e0312) {}
          }, 800);
        } catch (e0313) {}
      }
      if (res.couponIssueFailed) {
        messageByBundleId[bid] = "تمت إضافة الباقة للسلة لكن فشل كوبون الخصم";
        try {
          clearPendingCoupon(trigger);
        } catch (e03100b) {}
      } else if (res.hasDiscount === false) {
        messageByBundleId[bid] = "تمت إضافة الباقة للسلة (بدون خصم)";
        try {
          clearPendingCoupon(trigger);
        } catch (e03100c) {}
      } else if (!cc) {
        messageByBundleId[bid] = "تمت إضافة الباقة للسلة";
        try {
          clearPendingCoupon(trigger);
        } catch (e03100d) {}
      }
    } else {
      const errMsg = (res && res.message) || "فشلت العملية";
      messageByBundleId[bid] = "تمت إضافة الباقة للسلة لكن " + errMsg;
      try {
        clearPendingCoupon(trigger);
      } catch (e03100e) {}
    }
  } catch (applyErr) {
    markStoreClosed(applyErr);
    const hm2 = humanizeCartError(applyErr);
    messageByBundleId[bid] = hm2 ? "لم يتم الإضافة (" + hm2 + ")" : "لم يتم الإضافة";
  }

  applying = false;
  try {
    renderProductBanners(lastBundles || []);
  } catch (e04) {}
}

var lastBundles = null;

async function refreshProduct() {
  let state = null;
  try {
    state =
      g.BundleApp && g.BundleApp.__refreshState
        ? g.BundleApp.__refreshState
        : (g.BundleApp.__refreshState = { busy: false, queued: false, lastKey: "", lastSig: "" });

    if (state.busy) {
      state.queued = true;
      return;
    }
    state.busy = true;

    const variantId = findVariantId();
    const productId = findProductId();
    const key = variantId ? "v:" + String(variantId) : productId ? "p:" + String(productId) : "";
    log("bundle-app: ids", { variantId: variantId, productId: productId });

    let res = null;
    if (variantId) res = await getProductBundlesByVariantId(variantId);
    else if (productId) res = await getProductBundlesByProductId(productId);
    else {
      clearProductBanner();
      state.lastKey = "";
      state.lastSig = "";
      return;
    }

    const bundles = (res && res.bundles) || [];
    if (!bundles.length) {
      clearProductBanner();
      state.lastKey = key;
      state.lastSig = "";
      return;
    }

    let sig = "";
    for (let i = 0; i < bundles.length; i++) {
      const b = bundles[i] || {};
      sig +=
        String(b.id || i) +
        "|" +
        bundleVariantSig(b) +
        "|" +
        String(b.pricing && b.pricing.base && b.pricing.base.finalTotal != null ? b.pricing.base.finalTotal : "") +
        ";";
    }

    if (!applying && key === state.lastKey && sig === state.lastSig) return;

    state.lastKey = key;
    state.lastSig = sig;
    lastBundles = bundles;
    renderProductBanners(bundles);
  } catch (e) {
    warn("bundle-app: refresh failed", e && (e.details || e.message || e));
    clearProductBanner();
  } finally {
    if (state) {
      state.busy = false;
      if (state.queued) {
        state.queued = false;
        setTimeout(function () {
          refreshProduct();
        }, 0);
      }
    }
  }
}
`
];
