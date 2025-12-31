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
  function normalizeItemsForProxy(raw) {
    try {
      const map = {};
      const arr = Array.isArray(raw) ? raw : [];
      for (let i = 0; i < arr.length; i += 1) {
        const it = arr[i] || {};
        const vid =
          String(
            it.variantId ||
              it.variant_id ||
              it.sku_id ||
              it.skuId ||
              (it.variant && (it.variant.id || it.variant.variant_id)) ||
              it.id ||
              ""
          ).trim() || "";
        const qRaw = it.quantity != null ? it.quantity : it.qty != null ? it.qty : it.amount != null ? it.amount : null;
        const q = Math.max(0, Math.floor(Number(qRaw || 0)));
        if (!vid || !Number.isFinite(q) || q <= 0) continue;
        map[vid] = (map[vid] || 0) + q;
      }
      return Object.keys(map)
        .sort(function (a, b) {
          return String(a).localeCompare(String(b));
        })
        .map(function (k) {
          return { variantId: String(k), quantity: map[k] };
        });
    } catch (e) {
      return [];
    }
  }

  let rawCartItems = null;
  try {
    rawCartItems = await readCartItems();
  } catch (e0) {
    rawCartItems = null;
  }

  const normalized = normalizeItemsForProxy(rawCartItems && rawCartItems.length ? rawCartItems : items);
  const payload = { bundleId: bundleId != null ? String(bundleId || "") : null, items: normalized };
  const u = buildUrl("/api/proxy/bundles/apply", {});
  if (!u) return null;
  return fetchJson(u, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function savePendingCouponAny(code) {
  try {
    const c = String(code || "").trim();
    if (!c) return;
    localStorage.setItem(pendingAnyKey(), JSON.stringify({ code: c, ts: Date.now(), trigger: "*" }));
  } catch (e) {}
}

function clearPendingCouponAny() {
  try {
    localStorage.removeItem(pendingAnyKey());
  } catch (e) {}
}

async function syncCartDiscount(reasonBundleId) {
  if (storeClosedNow()) return null;
  if (!isCartLikePage()) return null;

  let rawItems = [];
  try {
    rawItems = await readCartItems();
  } catch (e0) {
    rawItems = [];
  }

  const payloadItems = (function () {
    try {
      const map = {};
      for (let i = 0; i < (rawItems || []).length; i += 1) {
        const it = rawItems[i] || {};
        const vid =
          String(
            it.variantId ||
              it.variant_id ||
              it.sku_id ||
              it.skuId ||
              (it.variant && (it.variant.id || it.variant.variant_id)) ||
              it.id ||
              ""
          ).trim() || "";
        const qRaw = it.quantity != null ? it.quantity : it.qty != null ? it.qty : it.amount != null ? it.amount : null;
        const q = Math.max(0, Math.floor(Number(qRaw || 0)));
        if (!vid || !Number.isFinite(q) || q <= 0) continue;
        map[vid] = (map[vid] || 0) + q;
      }
      return Object.keys(map)
        .sort(function (a, b) {
          return String(a).localeCompare(String(b));
        })
        .map(function (k) {
          return { variantId: String(k), quantity: map[k] };
        });
    } catch (e) {
      return [];
    }
  })();

  const sig = payloadItems.map(function (x) {
    return String(x.variantId) + ":" + String(x.quantity);
  }).join("|");

  var st = null;
  try {
    st = g.BundleApp && g.BundleApp.__cartDiscountSync ? g.BundleApp.__cartDiscountSync : (g.BundleApp.__cartDiscountSync = { inFlight: false, lastSig: "", lastAt: 0 });
  } catch (e1) {
    st = { inFlight: false, lastSig: "", lastAt: 0 };
  }

  if (st.inFlight) return null;
  if (sig && st.lastSig === sig && Date.now() - Number(st.lastAt || 0) < 2000) return null;
  st.lastSig = sig;
  st.lastAt = Date.now();
  st.inFlight = true;

  try {
    if (!payloadItems.length) {
      clearPendingCouponAny();
      try {
        await tryClearCoupon();
      } catch (eClr) {}
      return { ok: true, hasDiscount: false, discountAmount: 0 };
    }

    const u = buildUrl("/api/proxy/bundles/apply", {});
    if (!u) return null;
    const res = await fetchJson(u, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundleId: reasonBundleId != null ? String(reasonBundleId || "") : null, items: payloadItems })
    });

    if (res && res.ok) {
      const cc = String(res.couponCode || "").trim();
      if (cc) {
        savePendingCouponAny(cc);
        try {
          g.BundleApp._couponAutoApplyUntil = Date.now() + 90000;
        } catch (e2) {}
        try {
          setTimeout(function () {
            try {
              applyPendingCouponForCart();
            } catch (e3) {}
          }, 650);
        } catch (e4) {}
      } else {
        clearPendingCouponAny();
        try {
          await tryClearCoupon();
        } catch (eClr2) {}
      }
    }

    return res;
  } catch (e) {
    return null;
  } finally {
    try {
      st.inFlight = false;
    } catch (e5) {}
  }
}

function initCartDiscountAutoSync() {
  try {
    var st =
      g.BundleApp && g.BundleApp.__cartDiscountAuto
        ? g.BundleApp.__cartDiscountAuto
        : (g.BundleApp.__cartDiscountAuto = { inited: false, timer: 0, lastEvt: 0 });
    if (st.inited) return;
    st.inited = true;

    function schedule(immediate) {
      try {
        if (st.timer) clearTimeout(st.timer);
      } catch (e0) {}
      st.timer = setTimeout(function () {
        try {
          syncCartDiscount(null);
        } catch (e1) {}
      }, immediate === true ? 0 : 700);
    }

    function onEvt() {
      var now = Date.now();
      if (now - Number(st.lastEvt || 0) < 450) return;
      st.lastEvt = now;
      schedule(false);
    }

    try {
      window.addEventListener("focus", onEvt);
      window.addEventListener("popstate", onEvt);
      window.addEventListener("hashchange", onEvt);
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") onEvt();
      });
      document.addEventListener("change", onEvt, true);
      document.addEventListener("click", onEvt, true);
    } catch (e2) {}

    try {
      setInterval(function () {
        try {
          if (isCartLikePage()) schedule(true);
        } catch (e3) {}
      }, 4500);
    } catch (e4) {}

    schedule(true);
  } catch (e) {}
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

function variantTextParts(v) {
  try {
    const id = String((v && v.variantId) || "").trim();
    const name = String((v && v.name) || "").trim();
    const attrs = stringifyAttrs(v && v.attributes);
    const price = v && v.price != null ? Number(v.price) : null;
    const priceText = Number.isFinite(price) && price >= 0 ? fmtMoney(price) : "";

    const title = name || attrs || id || "—";
    const sub = name && attrs ? attrs : "";
    return { title: title, sub: sub, price: priceText };
  } catch (e) {
    return { title: "—", sub: "", price: "" };
  }
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
  const txt = variantTextParts(v);
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
  out += '<span class="bundle-app-variant-text">';
  out += '<span class="bundle-app-variant-title">' + escHtml(txt.title) + "</span>";
  if (txt.sub) out += '<span class="bundle-app-variant-sub">' + escHtml(txt.sub) + "</span>";
  if (txt.price) out += '<span class="bundle-app-variant-price">' + escHtml(txt.price) + "</span>";
  out += "</span>";
  return out;
}

var selectedBundleId = null;
var lastTriggerProductId = null;
var messageByBundleId = {};
var selectedTierByBundleId = {};
var selectedItemIndexesByBundleId = {};
var applying = false;
var variantSelectionsByBundleId = {};
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

function getBundleItemSelectionMap(bundleId) {
  const bid = String(bundleId || "").trim();
  if (!bid) return null;
  let m = selectedItemIndexesByBundleId[bid];
  if (!m || typeof m !== "object") m = {};
  selectedItemIndexesByBundleId[bid] = m;
  return m;
}

function clearBundleItemSelection(bundleId) {
  try {
    const bid = String(bundleId || "").trim();
    if (!bid) return;
    const m = selectedItemIndexesByBundleId[bid];
    if (m && typeof m === "object") {
      for (const k in m) {
        if (!Object.prototype.hasOwnProperty.call(m, k)) continue;
        try {
          delete m[k];
        } catch (e) {
          m[k] = null;
        }
      }
    }
  } catch (e) {}
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
      const kk = String(k || "");
      const bar = kk.indexOf("|");
      const unitKey = bar > 0 ? kk.slice(bar + 1) : "";
      if (!keep[kk] && !(unitKey && keep[unitKey])) {
        try {
          delete sel[k];
        } catch (e) {
          sel[k] = null;
        }
      }
    }
  } catch (e) {}
}

function tierKey(minQty, unitKey) {
  const mq = Math.max(1, Math.floor(Number(minQty || 1)));
  const k = String(unitKey || "").trim();
  if (!k) return "";
  return String(mq) + "|" + k;
}

function readTierSelection(sel, minQty, unitKey) {
  try {
    if (!sel || typeof sel !== "object") return "";
    const k0 = String(unitKey || "").trim();
    if (!k0) return "";
    const k1 = tierKey(minQty, k0);
    if (k1) {
      const v1 = String(sel[k1] || "").trim();
      if (v1) return v1;
    }
    return String(sel[k0] || "").trim();
  } catch (e) {
    return "";
  }
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

function triggerInCartKey(triggerProductId) {
  return "bundle_app_trigger_in_cart:" + String(merchantId || "") + ":" + String(triggerProductId || "");
}

function triggerInCartVariantKey(variantId) {
  return "bundle_app_trigger_in_cart_variant:" + String(merchantId || "") + ":" + String(variantId || "");
}

function postAddDismissKey(triggerProductId) {
  return "bundle_app_post_add_dismissed:" + String(merchantId || "") + ":" + String(triggerProductId || "");
}

function postAddDismissVariantKey(variantId) {
  return "bundle_app_post_add_dismissed_variant:" + String(merchantId || "") + ":" + String(variantId || "");
}

function markTriggerInCart(triggerProductId) {
  try {
    const pid = String(triggerProductId || "").trim();
    if (!pid) return;
    localStorage.setItem(triggerInCartKey(pid), JSON.stringify({ ts: Date.now() }));
  } catch (e) {}
}

function markTriggerVariantInCart(variantId) {
  try {
    const vid = String(variantId || "").trim();
    if (!vid) return;
    localStorage.setItem(triggerInCartVariantKey(vid), JSON.stringify({ ts: Date.now() }));
  } catch (e) {}
}

function markPostAddDismiss(triggerProductId, triggerVariantId) {
  try {
    const ts = Date.now();
    const pid = String(triggerProductId || "").trim();
    const vid = String(triggerVariantId || "").trim();
    if (pid) localStorage.setItem(postAddDismissKey(pid), JSON.stringify({ ts: ts }));
    if (vid) localStorage.setItem(postAddDismissVariantKey(vid), JSON.stringify({ ts: ts }));
  } catch (e) {}
}

function clearTriggerMarks(triggerProductId, triggerVariantId) {
  try {
    const pid = String(triggerProductId || "").trim();
    if (pid) localStorage.removeItem(triggerInCartKey(pid));
  } catch (e0) {}
  try {
    const vid = String(triggerVariantId || "").trim();
    if (vid) localStorage.removeItem(triggerInCartVariantKey(vid));
  } catch (e1) {}
}

function dismissPostAddForTrigger(triggerProductId, triggerVariantId) {
  try {
    markPostAddDismiss(triggerProductId, triggerVariantId);
    clearTriggerMarks(triggerProductId, triggerVariantId);
  } catch (e) {}
  try {
    scheduleUpsellRefresh();
  } catch (e2) {}
}

function scheduleUpsellRefresh() {
  try {
    if (g && g.BundleApp) g.BundleApp._postAddRefreshAt = Date.now();
  } catch (e0) {}
  try {
    setTimeout(function () {
      try {
        if (typeof refreshProduct === "function") refreshProduct();
      } catch (e1) {}
    }, 350);
  } catch (e2) {}
}

function loadTriggerMark(key) {
  try {
    const raw = localStorage.getItem(String(key || ""));
    if (!raw) return null;
    const j = JSON.parse(raw);
    const ts = Number(j && j.ts);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    return { ts: ts };
  } catch (e) {
    return null;
  }
}

function hasRecentTriggerMark(triggerProductId, triggerVariantId) {
  try {
    const ttlMs = 6 * 60 * 60 * 1000;
    const now = Date.now();
    const pid = String(triggerProductId || "").trim();
    const vid = String(triggerVariantId || "").trim();
    if (pid) {
      const m = loadTriggerMark(triggerInCartKey(pid));
      if (m && now - m.ts <= ttlMs) return true;
    }
    if (vid) {
      const m2 = loadTriggerMark(triggerInCartVariantKey(vid));
      if (m2 && now - m2.ts <= ttlMs) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

function shouldShowPostAdd(triggerProductId, triggerVariantId) {
  try {
    const pid = String(triggerProductId || "").trim();
    const vid = String(triggerVariantId || "").trim();
    if (!pid && !vid) return false;

    const now = Date.now();
    const showTtlMs = 2 * 60 * 1000;

    let addTs = 0;
    if (pid) {
      const m0 = loadTriggerMark(triggerInCartKey(pid));
      if (m0 && Number.isFinite(m0.ts) && m0.ts > addTs) addTs = m0.ts;
    }
    if (vid) {
      const m1 = loadTriggerMark(triggerInCartVariantKey(vid));
      if (m1 && Number.isFinite(m1.ts) && m1.ts > addTs) addTs = m1.ts;
    }
    if (!addTs || !Number.isFinite(addTs)) return false;
    if (now - addTs > showTtlMs) return false;

    let disTs = 0;
    if (pid) {
      const d0 = loadTriggerMark(postAddDismissKey(pid));
      if (d0 && Number.isFinite(d0.ts) && d0.ts > disTs) disTs = d0.ts;
    }
    if (vid) {
      const d1 = loadTriggerMark(postAddDismissVariantKey(vid));
      if (d1 && Number.isFinite(d1.ts) && d1.ts > disTs) disTs = d1.ts;
    }
    if (disTs && Number.isFinite(disTs) && disTs >= addTs) return false;

    let pageLoadedAt = 0;
    try {
      pageLoadedAt = Number((g && g.BundleApp && g.BundleApp._pageLoadedAt) || 0);
    } catch (eLoadAt) {
      pageLoadedAt = 0;
    }
    if (Number.isFinite(pageLoadedAt) && pageLoadedAt > 0) {
      const slackMs = 1500;
      if (addTs < pageLoadedAt - slackMs) return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}

function ensureCartHooks() {
  try {
    if (g && g.BundleApp && g.BundleApp._bundleCartHooked) return;
  } catch (e0) {}
  try {
    if (g && g.BundleApp) g.BundleApp._bundleCartHooked = true;
  } catch (e1) {}

  try {
    const cart = window.salla && window.salla.cart;
    if (!cart) return;

    function hookMethod(name, handler) {
      try {
        if (!cart || typeof cart[name] !== "function") return;
        const key = "_orig_" + name;
        try {
          if (g && g.BundleApp && g.BundleApp[key]) return;
        } catch (eKey) {}
        const orig = cart[name];
        try {
          if (g && g.BundleApp) g.BundleApp[key] = orig;
        } catch (eSave) {}
        cart[name] = function () {
          try {
            handler.apply(this, arguments);
          } catch (eH) {}
          return orig.apply(this, arguments);
        };
      } catch (eHook) {}
    }

    hookMethod("addItem", function (payload) {
      try {
        const idRaw = payload && payload.id != null ? payload.id : null;
        const idStr = String(idRaw || "").trim();
        const idNum = Number(idStr);
        if (Number.isFinite(idNum) && idNum > 0) markTriggerInCart(String(idNum));
        if (idStr) markTriggerVariantInCart(idStr);
        scheduleUpsellRefresh();
      } catch (eM) {}
    });

    hookMethod("quickAdd", function (productId) {
      try {
        const pid = String(productId || "").trim();
        const pidNum = Number(pid);
        if (Number.isFinite(pidNum) && pidNum > 0) markTriggerInCart(String(pidNum));
        scheduleUpsellRefresh();
      } catch (eM2) {}
    });
  } catch (e2) {}
}

function ensureCartSignals() {
  try {
    if (g && g.BundleApp && g.BundleApp._bundleCartSignalsHooked) return;
  } catch (e0) {}
  try {
    if (g && g.BundleApp) g.BundleApp._bundleCartSignalsHooked = true;
  } catch (e1) {}

  function markCurrentAsInCart() {
    try {
      const pid = typeof findProductId === "function" ? String(findProductId() || "").trim() : "";
      const vid = typeof findVariantId === "function" ? String(findVariantId() || "").trim() : "";
      if (!pid && !vid) return;
      if (pid) markTriggerInCart(pid);
      if (vid) markTriggerVariantInCart(vid);
      scheduleUpsellRefresh();
    } catch (e) {}
  }

  function looksLikeAddToCartButton(el) {
    try {
      if (!el || !el.getAttribute) return false;
      const da = String(el.getAttribute("data-action") || "").toLowerCase();
      const id = String(el.getAttribute("id") || "").toLowerCase();
      const cls = String(el.getAttribute("class") || "").toLowerCase();
      const name = String(el.getAttribute("name") || "").toLowerCase();
      const aria = String(el.getAttribute("aria-label") || "").toLowerCase();
      const title = String(el.getAttribute("title") || "").toLowerCase();
      const text = String((el.textContent || "")).toLowerCase();

      const s = (da + " " + id + " " + cls + " " + name + " " + aria + " " + title + " " + text).trim();

      if (s.indexOf("wishlist") !== -1 || s.indexOf("favorite") !== -1 || s.indexOf("favourite") !== -1) return false;
      if (s.indexOf("مفض") !== -1) return false;

      if (cls && (cls.indexOf("add-to-cart") !== -1 || cls.indexOf("addtocart") !== -1)) return true;

      const hasAdd =
        s.indexOf("add") !== -1 ||
        s.indexOf("buy") !== -1 ||
        s.indexOf("purchase") !== -1 ||
        s.indexOf("quickadd") !== -1 ||
        s.indexOf("أضف") !== -1 ||
        s.indexOf("اضف") !== -1 ||
        s.indexOf("اشتر") !== -1;
      const hasCart = s.indexOf("cart") !== -1 || s.indexOf("basket") !== -1 || s.indexOf("bag") !== -1 || s.indexOf("checkout") !== -1;
      const hasCartAr = s.indexOf("سلة") !== -1 || s.indexOf("سله") !== -1 || s.indexOf("الدفع") !== -1;

      if (hasAdd && (hasCart || hasCartAr)) return true;

      return false;
    } catch (e) {
      return false;
    }
  }

  try {
    document.addEventListener(
      "submit",
      function (e) {
        try {
          const form = e && e.target && e.target.tagName ? e.target : null;
          if (!form) return;
          const action = String((form.getAttribute && form.getAttribute("action")) || "").toLowerCase();
          if (action && action.indexOf("cart") === -1 && action.indexOf("checkout") === -1) return;
          markCurrentAsInCart();
        } catch (e2) {}
      },
      true
    );
  } catch (eSub) {}

  try {
    document.addEventListener(
      "click",
      function (e) {
        try {
          let t = e && e.target ? e.target : null;
          let steps = 0;
          while (t && steps < 6) {
            if (t.tagName) {
              const tag = String(t.tagName || "").toLowerCase();
              if (tag === "button" || tag === "a" || tag === "input") {
                if (looksLikeAddToCartButton(t)) {
                  markCurrentAsInCart();
                  return;
                }
                if (tag === "button") {
                  const type = String((t.getAttribute && t.getAttribute("type")) || "").toLowerCase();
                  if (type === "submit") {
                    const form = t.form || null;
                    const action = String((form && form.getAttribute && form.getAttribute("action")) || "").toLowerCase();
                    if (action && (action.indexOf("cart") !== -1 || action.indexOf("checkout") !== -1)) {
                      markCurrentAsInCart();
                      return;
                    }
                  }
                }
              }
            }
            t = t.parentNode;
            steps += 1;
          }
        } catch (e3) {}
      },
      true
    );
  } catch (eClk) {}
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
    function withTimeout(p, ms) {
      return Promise.race([
        p,
        new Promise(function (_r, rej) {
          setTimeout(function () {
            rej(new Error("timeout"));
          }, Math.max(1, Number(ms || 1)));
        })
      ]);
    }

    function runAndAssertOk(p) {
      return withTimeout(
        Promise.resolve(p).then(function (res) {
          if (res && typeof res === "object") {
            const ok = res.ok != null ? Boolean(res.ok) : res.success != null ? Boolean(res.success) : null;
            if (ok === false) {
              const raw = res.message != null ? res.message : res.error != null ? res.error : res.title != null ? res.title : res;
              const m = typeof raw === "string" ? String(raw || "").trim() : safeDebugStringify(raw, 3000);
              const e0 = new Error(m || "coupon_apply_failed");
              e0.details = res;
              throw e0;
            }
          }
          return res;
        }),
        12_000
      );
    }

    function sleep(ms) {
      return new Promise(function (r) {
        setTimeout(r, Math.max(0, Number(ms || 0)));
      });
    }

    function buildCandidates() {
      var fns = [];
      if (cart) {
        if (typeof cart.applyCoupon === "function") fns.push({ label: "cart.applyCoupon(string)", fn: function () { return cart.applyCoupon(c); } });
        if (typeof cart.addCoupon === "function") {
          fns.push({ label: "cart.addCoupon({code})", fn: function () { return cart.addCoupon({ code: c }); } });
          fns.push({ label: "cart.addCoupon({coupon_code})", fn: function () { return cart.addCoupon({ coupon_code: c }); } });
          fns.push({ label: "cart.addCoupon(string)", fn: function () { return cart.addCoupon(c); } });
        }
        if (cart.coupon && typeof cart.coupon.apply === "function") {
          fns.push({ label: "cart.coupon.apply(string)", fn: function () { return cart.coupon.apply(c); } });
          fns.push({ label: "cart.coupon.apply({code})", fn: function () { return cart.coupon.apply({ code: c }); } });
          fns.push({ label: "cart.coupon.apply({coupon_code})", fn: function () { return cart.coupon.apply({ coupon_code: c }); } });
        }
        if (cart.coupon && typeof cart.coupon.set === "function") {
          fns.push({ label: "cart.coupon.set(string)", fn: function () { return cart.coupon.set(c); } });
          fns.push({ label: "cart.coupon.set({code})", fn: function () { return cart.coupon.set({ code: c }); } });
          fns.push({ label: "cart.coupon.set({coupon_code})", fn: function () { return cart.coupon.set({ coupon_code: c }); } });
        }
        if (typeof cart.setCoupon === "function") {
          fns.push({ label: "cart.setCoupon(string)", fn: function () { return cart.setCoupon(c); } });
          fns.push({ label: "cart.setCoupon({code})", fn: function () { return cart.setCoupon({ code: c }); } });
          fns.push({ label: "cart.setCoupon({coupon_code})", fn: function () { return cart.setCoupon({ coupon_code: c }); } });
        }
      }
      if (window.salla) {
        if (typeof window.salla.applyCoupon === "function")
          fns.push({ label: "salla.applyCoupon(string)", fn: function () { return window.salla.applyCoupon(c); } });
        if (window.salla.coupon && typeof window.salla.coupon.apply === "function") {
          fns.push({ label: "salla.coupon.apply(string)", fn: function () { return window.salla.coupon.apply(c); } });
          fns.push({ label: "salla.coupon.apply({code})", fn: function () { return window.salla.coupon.apply({ code: c }); } });
          fns.push({
            label: "salla.coupon.apply({coupon_code})",
            fn: function () { return window.salla.coupon.apply({ coupon_code: c }); }
          });
        }
      }
      return fns;
    }

    var lastErr = null;
    var attempts = 0;
    var lastAttemptLabel = "";
    for (var pass = 0; pass < 3; pass += 1) {
      if (pass > 0) await sleep(450 * pass);
      var fns = buildCandidates();
      if (!fns.length) return false;
      for (var i = 0; i < fns.length; i += 1) {
        attempts += 1;
        try {
          lastAttemptLabel = String((fns[i] && fns[i].label) || "");
          await runAndAssertOk((fns[i] && fns[i].fn ? fns[i].fn() : null));
          try {
            g.BundleApp._lastCouponApplyStatus = null;
            g.BundleApp._lastCouponApplyMessage = "";
            g.BundleApp._lastCouponApplyDetails = "";
          } catch (x0) {}
          return true;
        } catch (eTry) {
          lastErr = eTry;
          var stTry = extractHttpStatus(eTry);
          var msgTry = extractHttpMessage(eTry);
          markStoreClosed({ status: stTry, message: msgTry });
          if (storeClosedNow()) return false;
        }
      }
    }

    if (lastErr) {
      try {
        lastErr._bundleAttemptLabel = lastAttemptLabel;
        lastErr._bundleAttempts = attempts;
      } catch (x) {}
      throw lastErr;
    }

    try {
      g.BundleApp._lastCouponApplyStatus = null;
      g.BundleApp._lastCouponApplyMessage = "";
      g.BundleApp._lastCouponApplyDetails = "";
    } catch (x0) {}
    return true;
  } catch (e) {
    const st = extractHttpStatus(e);
    const msg = extractHttpMessage(e);
    try {
      g.BundleApp._lastCouponApplyStatus = st;
      g.BundleApp._lastCouponApplyMessage = String(msg || "");
      g.BundleApp._lastCouponApplyDetails = safeDebugStringify(
        {
          status: st,
          message: msg,
          attempt: (e && (e._bundleAttemptLabel || e.attempt || e.method)) || undefined,
          attempts: (e && (e._bundleAttempts || e.attempts)) || undefined,
          details: (e && (e.details || (e.response && e.response.data) || e)) || null
        },
        12000
      );
    } catch (x1) {}
    markStoreClosed({ status: st, message: msg });
    if (storeClosedNow()) return false;
    warn("bundle-app: coupon apply failed", e && (e.details || e.message || e));
    return false;
  }
}

async function readCartItems() {
  const cart = window.salla && window.salla.cart;
  if (!cart) return [];

  function pickItems(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return obj;
    if (Array.isArray(obj.items)) return obj.items;
    if (obj.data) {
      if (Array.isArray(obj.data.items)) return obj.data.items;
      if (Array.isArray(obj.data.cart && obj.data.cart.items)) return obj.data.cart.items;
    }
    if (Array.isArray(obj.cart && obj.cart.items)) return obj.cart.items;
    return [];
  }

  function withTimeout(p, ms) {
    return Promise.race([
      Promise.resolve(p),
      new Promise(function (_r, rej) {
        setTimeout(function () {
          rej(new Error("timeout"));
        }, Math.max(1, Number(ms || 1)));
      })
    ]);
  }

  try {
    const direct = pickItems(cart.items || (cart.data && cart.data.items) || null);
    if (direct && direct.length) return direct;
  } catch (e0) {}

  const candidates = [];
  try {
    if (typeof cart.getItems === "function") candidates.push(cart.getItems());
  } catch (e1) {}
  try {
    if (typeof cart.getCart === "function") candidates.push(cart.getCart());
  } catch (e2) {}
  try {
    if (typeof cart.fetch === "function") candidates.push(cart.fetch());
  } catch (e3) {}

  for (let i = 0; i < candidates.length; i += 1) {
    try {
      const res = await withTimeout(candidates[i], 4500);
      const items = pickItems(res);
      if (items && items.length) return items;
    } catch (e4) {}
  }

  return [];
}

function cartItemMatchesTrigger(it, triggerProductId, triggerVariantId) {
  try {
    const pid = String(
      (it && (it.product_id || it.productId || (it.product && (it.product.id || it.product.product_id)))) || ""
    ).trim();
    const vid = String(
      (it && (it.variant_id || it.variantId || it.sku_id || it.skuId || (it.variant && it.variant.id) || it.id)) || ""
    ).trim();
    const trgPid = String(triggerProductId || "").trim();
    const trgVid = String(triggerVariantId || "").trim();
    if (trgPid && pid && pid === trgPid) return true;
    if (trgVid && vid && String(vid) === trgVid) return true;
    if (trgPid) {
      const vNum = Number(vid);
      if (Number.isFinite(vNum) && String(vNum) === trgPid) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function hasTriggerInCart(triggerProductId, triggerVariantId) {
  try {
    const pid = String(triggerProductId || "").trim();
    const vid = String(triggerVariantId || "").trim();
    if (!pid && !vid) return false;
    if (hasRecentTriggerMark(pid, vid)) return true;

    const items = await readCartItems();
    if (!items || !items.length) return false;
    const ok = items.some((it) => cartItemMatchesTrigger(it, pid, vid));
    if (ok) {
      if (pid) markTriggerInCart(pid);
      if (vid) markTriggerVariantInCart(vid);
    }
    return ok;
  } catch (e) {
    return hasRecentTriggerMark(triggerProductId, triggerVariantId);
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
      const raw0 = e.details.message || e.details.error || e.details.title || "";
      m = typeof raw0 === "string" ? String(raw0 || "").trim() : safeDebugStringify(raw0, 3000);
      if (!m && e.details.data && typeof e.details.data === "object") {
        const raw1 = e.details.data.message || e.details.data.error || e.details.data.title || "";
        m = typeof raw1 === "string" ? String(raw1 || "").trim() : safeDebugStringify(raw1, 3000);
      }
    }
    if (!m && e && e.response && e.response.data != null) {
      const d = e.response.data;
      if (typeof d === "string") {
        m = String(d || "").trim();
      } else if (typeof d === "object") {
        const raw2 = d.message || d.error || d.title || "";
        m = typeof raw2 === "string" ? String(raw2 || "").trim() : safeDebugStringify(raw2, 3000);
        if (!m && d.data && typeof d.data === "object") {
          const raw3 = d.data.message || d.data.error || d.data.title || "";
          m = typeof raw3 === "string" ? String(raw3 || "").trim() : safeDebugStringify(raw3, 3000);
        }
      }
    }
    if (!m && e) {
      const em = e.message;
      m = typeof em === "string" ? String(em || "").trim() : em != null ? safeDebugStringify(em, 3000) : "";
    }
    if (m === "[object Object]" && e) {
      m = safeDebugStringify((e && (e.details || (e.response && e.response.data) || e)) || null, 3000);
    }
    return m;
  } catch (x) {
    return "";
  }
}

function safeDebugStringify(value, maxLen) {
  const seen = typeof WeakSet !== "undefined" ? new WeakSet() : null;
  function looksSensitiveKey(k) {
    const s = String(k || "").toLowerCase();
    return (
      s.indexOf("token") !== -1 ||
      s.indexOf("authorization") !== -1 ||
      s.indexOf("cookie") !== -1 ||
      s.indexOf("password") !== -1 ||
      s.indexOf("secret") !== -1 ||
      (s.length >= 3 && s.indexOf("key") !== -1)
    );
  }
  function looksSensitiveValue(v) {
    const s = String(v || "");
    if (s.length >= 24 && s.indexOf("Bearer ") === 0) return true;
    if (s.length >= 24 && s.indexOf("eyJ") === 0) return true;
    if (s.length >= 24 && /^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(s)) return true;
    return false;
  }
  function cleanse(v, k) {
    try {
      if (v == null) return v;
      if (typeof v === "string") {
        if (looksSensitiveKey(k) || looksSensitiveValue(v)) return "[REDACTED]";
        return v;
      }
      if (typeof v === "number" || typeof v === "boolean") return v;
      if (typeof v !== "object") return String(v);
      if (seen) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      if (Array.isArray(v)) return v.map(function (x) { return cleanse(x, k); });
      const out = {};
      for (const kk in v) {
        if (!Object.prototype.hasOwnProperty.call(v, kk)) continue;
        out[kk] = cleanse(v[kk], kk);
      }
      return out;
    } catch (e0) {
      try {
        return String(v);
      } catch (e1) {
        return "[Unserializable]";
      }
    }
  }
  try {
    const clean = cleanse(value, "");
    let s = "";
    try {
      s = JSON.stringify(clean);
    } catch (e0) {
      s = String(clean);
    }
    const lim = Math.max(200, Math.min(20000, Number(maxLen || 6000)));
    if (s.length > lim) return s.slice(0, lim) + "...(truncated)";
    return s;
  } catch (e) {
    try {
      return String(value);
    } catch (e2) {
      return "";
    }
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
    const dbg = (function () {
      try {
        return Boolean((g && g.BundleApp && g.BundleApp.__verboseErrors) || (typeof debug !== "undefined" && debug));
      } catch (x0) {
        return false;
      }
    })();
    const extra = dbg
      ? (function () {
          try {
            const last = g && g.BundleApp ? g.BundleApp._lastCouponApplyDetails : "";
            const packed = { status: st, message: msg, couponApplyDetails: last || undefined };
            return safeDebugStringify(packed, 8000);
          } catch (x) {
            return safeDebugStringify({ status: st, message: msg }, 8000);
          }
        })()
      : "";
    function withExtra(base) {
      if (!dbg) return base;
      const b = String(base || "").trim();
      const ex = String(extra || "").trim();
      if (!ex) return b || null;
      if (!b) return ex;
      return b + " | " + ex;
    }
    if (Number(st) === 410) {
      const m = String(msg || "").toLowerCase();
      if (m.indexOf("مغلق") !== -1) return withExtra("المتجر مغلق");
      if (m.indexOf("closed") !== -1) return withExtra("المتجر مغلق");
    }
    if (Number(st) === 429) return withExtra("تم حظرك مؤقتاً");
    if (Number(st) === 404) return withExtra("المنتج غير موجود");
    if (Number(st) === 401) return withExtra("غير مصرح");
    if (Number(st) === 403) return withExtra("غير مصرح");
    if (Number(st) === 400) {
      const m2 = String(msg || "");
      const ml2 = m2.toLowerCase();
      if (
        m2.indexOf("غير صحيح") !== -1 ||
        m2.indexOf("منتهي") !== -1 ||
        ml2.indexOf("expired") !== -1 ||
        ml2.indexOf("invalid") !== -1 ||
        ml2.indexOf("not valid") !== -1
      ) {
        return withExtra("الكود غير صحيح أو منتهي");
      }
      if (
        m2.indexOf("لا يشمل") !== -1 ||
        m2.indexOf("كوبون") !== -1 ||
        ml2.indexOf("coupon") !== -1 ||
        ml2.indexOf("eligible") !== -1 ||
        ml2.indexOf("not applicable") !== -1
      ) {
        return withExtra("المنتجات في السلة لا يشملها الكوبون");
      }
      return withExtra("طلب غير صالح");
    }
    if (Number(st) === 422) return withExtra("بيانات غير صالحة");
    if (Number(st) === 500) return withExtra("خطأ في الخادم");
    if (Number(st) === 503) return withExtra("الخدمة غير متاحة");
    if (Number(st) === 504) return withExtra("انتهت مهلة الخادم");
    if (msg && msg.indexOf("timeout") !== -1) return withExtra("انتهت المهلة");
    return dbg && (st != null || msg) ? withExtra("") : null;
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

var componentMetaByProductId = {};
var componentMetaByVariantId = {};

function canonProductId(pid, variantId) {
  try {
    let p = String(pid || "").trim();
    const v = String(variantId || "").trim();
    if (!p && v && v.indexOf("product:") === 0) p = v.slice("product:".length).trim();
    if (p && p.indexOf("product:") === 0) p = p.slice("product:".length).trim();
    return p;
  } catch (e) {
    return String(pid || "").trim();
  }
}

function readMainProductMetaFromDom() {
  try {
    let name = "";
    let imageUrl = "";

    try {
      const mt =
        document.querySelector('meta[property="og:title"]') ||
        document.querySelector('meta[name="twitter:title"]') ||
        document.querySelector('meta[name="title"]');
      if (mt) name = String(mt.getAttribute("content") || "").trim();
    } catch (e0) {}
    if (!name) {
      try {
        const h1 = document.querySelector("h1");
        if (h1) name = String(h1.textContent || "").trim();
      } catch (e1) {}
    }

    try {
      const mi =
        document.querySelector('meta[property="og:image"]') ||
        document.querySelector('meta[name="twitter:image"]') ||
        document.querySelector('meta[name="twitter:image:src"]');
      if (mi) imageUrl = String(mi.getAttribute("content") || "").trim();
    } catch (e2) {}
    if (!imageUrl) {
      try {
        const img =
          document.querySelector("img.product-image") ||
          document.querySelector(".product img") ||
          document.querySelector('[data-product-image] img,[data-product-gallery] img') ||
          document.querySelector("main img");
        if (img) imageUrl = String(img.getAttribute("src") || img.src || "").trim();
      } catch (e3) {}
    }

    name = name ? name.slice(0, 220) : "";
    imageUrl = imageUrl ? imageUrl.slice(0, 900) : "";
    return { name: name || null, imageUrl: imageUrl || null };
  } catch (e) {
    return { name: null, imageUrl: null };
  }
}

function rememberComponentMeta(variantId, productId, name, imageUrl) {
  try {
    const vid = String(variantId || "").trim();
    const pid = String(productId || "").trim();
    const nm = String(name || "").trim();
    const img = String(imageUrl || "").trim();
    if (pid) {
      const cur = componentMetaByProductId[pid] && typeof componentMetaByProductId[pid] === "object" ? componentMetaByProductId[pid] : {};
      if (nm) cur.name = nm;
      if (img) cur.imageUrl = img;
      componentMetaByProductId[pid] = cur;
    }
    if (vid) {
      const cur2 = componentMetaByVariantId[vid] && typeof componentMetaByVariantId[vid] === "object" ? componentMetaByVariantId[vid] : {};
      if (nm) cur2.name = nm;
      if (img) cur2.imageUrl = img;
      componentMetaByVariantId[vid] = cur2;
    }
  } catch (e) {}
}

function readComponentMeta(variantId, productId) {
  try {
    const vid = String(variantId || "").trim();
    const pid = String(productId || "").trim();
    const byVid = vid ? componentMetaByVariantId[vid] : null;
    const byPid = pid ? componentMetaByProductId[pid] : null;
    if (byVid && typeof byVid === "object") return byVid;
    if (byPid && typeof byPid === "object") return byPid;
    return null;
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
    const pidRaw = String(c.productId || "").trim();
    const pid = canonProductId(pidRaw, v);
    const isBase = Boolean(c.isBase);
    const q = isBase ? Math.max(getPageQty(), baseMin) : Math.max(1, Math.floor(Number(c.quantity || 1)));
    if (!v) continue;
    let name = c.name != null ? String(c.name || "").trim() || null : null;
    let imageUrl = c.imageUrl != null ? String(c.imageUrl || "").trim() || null : null;
    if (!name || !imageUrl) {
      const m = readComponentMeta(v, pid);
      if (m && typeof m === "object") {
        if (!name && String(m.name || "").trim()) name = String(m.name || "").trim();
        if (!imageUrl && String(m.imageUrl || "").trim()) imageUrl = String(m.imageUrl || "").trim();
      }
    }
    rememberComponentMeta(v, pid, name, imageUrl);
    const price = c.price != null && Number.isFinite(Number(c.price)) ? Number(c.price) : null;
    const attributes = c.attributes && typeof c.attributes === "object" && !Array.isArray(c.attributes) ? c.attributes : null;
    const group = c.group != null ? String(c.group || "").trim() || null : null;
    out.push({ variantId: v, productId: pid || null, quantity: q, isBase: isBase, name, imageUrl, price, attributes, group });
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

    const settings = (bundle && bundle.settings) || {};
    const pickerVisible = settings && settings.variantPickerVisible !== false;
    const bid = String((bundle && bundle.id) || "").trim();
    const sel = bid ? getBundleVariantSelectionMap(bid) || {} : {};

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
            const pv = readTierSelection(sel, qSel, key);
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = ref + ":" + p;
            const pv2 = readTierSelection(sel, qSel, key2);
            const useVid = pv2 || vid;
            out.push({ variantId: useVid, productId: ref || null, quantity: 1, isBase: it.isBase });
          }
        } else if (pickerVisible) {
          const ref = String(it.productId || "").trim();
          const qty2 = Math.max(1, Math.floor(Number(it.quantity || 1)));
          if (!ref) {
            out.push(it);
          } else {
            const counts = {};
            for (let u = 0; u < qty2; u++) {
              const key = ref + ":" + u;
              const pv = readTierSelection(sel, qSel, key);
              const useVid = pv || vid;
              if (!useVid) continue;
              counts[useVid] = (counts[useVid] || 0) + 1;
            }
            for (const k in counts) {
              if (!Object.prototype.hasOwnProperty.call(counts, k)) continue;
              out.push({ variantId: k, productId: ref || null, quantity: counts[k], isBase: it.isBase });
            }
          }
        } else {
          out.push(it);
        }
      }
      return out;
    }

    if (!pickerVisible) return items;
    const out = [];
    for (let j = 0; j < items.length; j++) {
      const it = items[j] || {};
      const vid = String(it.variantId || "").trim();
      const ref = String(it.productId || "").trim();
      const qty2 = Math.max(1, Math.floor(Number(it.quantity || 1)));
      if (!vid || !ref || vid.indexOf("product:") === 0) {
        out.push(it);
        continue;
      }
      const counts = {};
      for (let u = 0; u < qty2; u++) {
        const key = ref + ":" + u;
        const pv = readTierSelection(sel, qSel, key);
        const useVid = pv || vid;
        if (!useVid) continue;
        counts[useVid] = (counts[useVid] || 0) + 1;
      }
      for (const k in counts) {
        if (!Object.prototype.hasOwnProperty.call(counts, k)) continue;
        out.push({ variantId: k, productId: ref || null, quantity: counts[k], isBase: it.isBase });
      }
    }
    return out;
  } catch (e) {
    return [];
  }
}

function computeProductsItems(bundle, opts) {
  try {
    const baseItems = normalizeItems(bundle);
    const settings = (bundle && bundle.settings) || {};
    const req = Boolean(settings && settings.selectionRequired === true);
    const defIds = Array.isArray(settings && settings.defaultSelectedProductIds) ? settings.defaultSelectedProductIds : [];
    const include = {};
    let includeSize = 0;
    for (let i0 = 0; i0 < defIds.length; i0 += 1) {
      const s0 = String(defIds[i0] || "").trim();
      if (!s0) continue;
      if (!include[s0]) includeSize += 1;
      include[s0] = true;
    }

    const bid = String((bundle && bundle.id) || "").trim();
    const sel = getBundleVariantSelectionMap(bid) || {};
    const tierMinQty = pickMinQty(bundle);
    const selIdx = getBundleItemSelectionMap(bid) || {};
    let hasSelIdx = false;
    for (const k in selIdx) {
      if (Object.prototype.hasOwnProperty.call(selIdx, k)) {
        hasSelIdx = true;
        break;
      }
    }

    const chosen = [];
    for (let i = 0; i < baseItems.length; i += 1) {
      const it = baseItems[i] || {};
      const isBase = Boolean(it.isBase);
      let pid = String(it.productId || "").trim();
      const vid = String(it.variantId || "").trim();
      if (!pid && vid && vid.indexOf("product:") === 0) pid = String(vid).slice("product:".length).trim();
      if (!vid) continue;

      let should = false;
      if (isBase) should = true;
      else if (hasSelIdx) should = selIdx[String(i)] === true;
      else if (includeSize) should = Boolean(pid && include[pid] === true);
      else should = !req;

      if (!should) continue;
      chosen.push(it);
    }

    const out = [];
    for (let i2 = 0; i2 < chosen.length; i2 += 1) {
      const it2 = chosen[i2] || {};
      const v = String(it2.variantId || "").trim();
      if (!v) continue;
      let pid2 = String(it2.productId || "").trim();
      if (!pid2 && v.indexOf("product:") === 0) pid2 = String(v).slice("product:".length).trim();
      const qty = Math.max(1, Math.floor(Number(it2.quantity || 1)));

      if (v.indexOf("product:") === 0) {
        const mode = String((opts && opts.mode) || "apply");
        if (mode === "preview") {
          let pickedCount = 0;
          for (let u = 0; u < qty; u++) {
            const key = pid2 + ":" + u;
            const pv = readTierSelection(sel, tierMinQty, key);
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = pid2 + ":" + p;
            const pv2 = readTierSelection(sel, tierMinQty, key2);
            if (!pv2 && settings && settings.variantRequired !== false) continue;
            out.push({ variantId: pv2 || v, productId: pid2 || null, quantity: 1, isBase: Boolean(it2.isBase) });
          }
        } else {
          let pickedAll = true;
          const parts = [];
          for (let u2 = 0; u2 < qty; u2++) {
            const key3 = pid2 + ":" + u2;
            const pv3 = readTierSelection(sel, tierMinQty, key3);
            if (!pv3) pickedAll = false;
            parts.push(pv3 || v);
          }
          if (req && settings && settings.variantRequired !== false && !pickedAll) continue;
          for (let m = 0; m < parts.length; m++) {
            out.push({ variantId: parts[m], productId: pid2 || null, quantity: 1, isBase: Boolean(it2.isBase) });
          }
        }
      } else {
        const pickerVisible = settings && settings.variantPickerVisible !== false;
        if (pickerVisible && pid2) {
          const counts = {};
          for (let u = 0; u < qty; u++) {
            const key = pid2 + ":" + u;
            const pv = readTierSelection(sel, tierMinQty, key);
            const useVid = pv || v;
            if (!useVid) continue;
            counts[useVid] = (counts[useVid] || 0) + 1;
          }
          for (const k in counts) {
            if (!Object.prototype.hasOwnProperty.call(counts, k)) continue;
            out.push({ variantId: k, productId: pid2 || null, quantity: counts[k], isBase: Boolean(it2.isBase) });
          }
        } else {
          out.push({ variantId: v, productId: pid2 || null, quantity: qty, isBase: Boolean(it2.isBase) });
        }
      }
    }

    out.sort(function (a, b) {
      return String(a.variantId).localeCompare(String(b.variantId));
    });
    return out;
  } catch (e) {
    return [];
  }
}

function computeNoDiscountItems(bundle, opts) {
  try {
    const baseItems = normalizeItems(bundle);
    const settings = (bundle && bundle.settings) || {};
    const req = Boolean(settings && settings.selectionRequired === true);
    const defIds = Array.isArray(settings && settings.defaultSelectedProductIds) ? settings.defaultSelectedProductIds : [];
    const include = {};
    let includeSize = 0;
    for (let i0 = 0; i0 < defIds.length; i0 += 1) {
      const s0 = String(defIds[i0] || "").trim();
      if (!s0) continue;
      if (!include[s0]) includeSize += 1;
      include[s0] = true;
    }

    const bid = String((bundle && bundle.id) || "").trim();
    const sel = getBundleVariantSelectionMap(bid) || {};
    const tierMinQty = pickMinQty(bundle);
    const selIdx = getBundleItemSelectionMap(bid) || {};
    let hasSelIdx = false;
    for (const k in selIdx) {
      if (Object.prototype.hasOwnProperty.call(selIdx, k)) {
        hasSelIdx = true;
        break;
      }
    }

    const chosen = [];
    for (let i = 0; i < baseItems.length; i += 1) {
      const it = baseItems[i] || {};
      const isBase = Boolean(it.isBase);
      let pid = String(it.productId || "").trim();
      const vid = String(it.variantId || "").trim();
      if (!pid && vid && vid.indexOf("product:") === 0) pid = String(vid).slice("product:".length).trim();
      if (!vid) continue;

      let should = false;
      if (isBase) should = true;
      else if (hasSelIdx) should = selIdx[String(i)] === true;
      else if (includeSize) should = Boolean(pid && include[pid] === true);
      else should = !req;

      if (!should) continue;
      chosen.push(it);
    }

    const out = [];
    for (let i2 = 0; i2 < chosen.length; i2 += 1) {
      const it2 = chosen[i2] || {};
      const v = String(it2.variantId || "").trim();
      if (!v) continue;
      let pid2 = String(it2.productId || "").trim();
      if (!pid2 && v.indexOf("product:") === 0) pid2 = String(v).slice("product:".length).trim();
      const qty = Math.max(1, Math.floor(Number(it2.quantity || 1)));

      if (v.indexOf("product:") === 0) {
        const mode = String((opts && opts.mode) || "apply");
        if (mode === "preview") {
          let pickedCount = 0;
          for (let u = 0; u < qty; u++) {
            const key = pid2 + ":" + u;
            const pv = readTierSelection(sel, tierMinQty, key);
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = pid2 + ":" + p;
            const pv2 = readTierSelection(sel, tierMinQty, key2);
            out.push({ variantId: pv2 || v, productId: pid2 || null, quantity: 1, isBase: Boolean(it2.isBase) });
          }
        } else {
          for (let m = 0; m < qty; m++) {
            const key3 = pid2 + ":" + m;
            const pv3 = readTierSelection(sel, tierMinQty, key3);
            out.push({ variantId: pv3 || v, productId: pid2 || null, quantity: 1, isBase: Boolean(it2.isBase) });
          }
        }
      } else {
        out.push({ variantId: v, productId: pid2 || null, quantity: qty, isBase: Boolean(it2.isBase) });
      }
    }

    out.sort(function (a, b) {
      return String(a.variantId).localeCompare(String(b.variantId));
    });
    return out;
  } catch (e) {
    return [];
  }
}

function computePostAddItems(bundle, opts) {
  try {
    const baseItems = normalizeItems(bundle);
    const bid = String((bundle && bundle.id) || "").trim();
    const sel = getBundleVariantSelectionMap(bid) || {};
    const tierMinQty = pickMinQty(bundle);
    const selIdx = getBundleItemSelectionMap(bid) || {};
    let hasSelIdx = false;
    for (const k in selIdx) {
      if (Object.prototype.hasOwnProperty.call(selIdx, k)) {
        hasSelIdx = true;
        break;
      }
    }

    const chosen = [];
    for (let i = 0; i < baseItems.length; i += 1) {
      const it = baseItems[i] || {};
      if (it.isBase === true) {
        chosen.push(it);
        continue;
      }
      if (hasSelIdx && selIdx[String(i)] !== true) continue;
      chosen.push(it);
    }

    const out = [];
    for (let i2 = 0; i2 < chosen.length; i2 += 1) {
      const it2 = chosen[i2] || {};
      const v = String(it2.variantId || "").trim();
      if (!v) continue;
      let pid2 = String(it2.productId || "").trim();
      if (!pid2 && v.indexOf("product:") === 0) pid2 = String(v).slice("product:".length).trim();
      const qty = Math.max(1, Math.floor(Number(it2.quantity || 1)));

      if (v.indexOf("product:") === 0) {
        const mode = String((opts && opts.mode) || "apply");
        if (mode === "preview") {
          let pickedCount = 0;
          for (let u = 0; u < qty; u++) {
            const key = pid2 + ":" + u;
            const pv = readTierSelection(sel, tierMinQty, key);
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = pid2 + ":" + p;
            const pv2 = readTierSelection(sel, tierMinQty, key2);
            out.push({ variantId: pv2 || v, productId: pid2 || null, quantity: 1, isBase: Boolean(it2.isBase) });
          }
        } else {
          for (let m = 0; m < qty; m++) {
            const key3 = pid2 + ":" + m;
            const pv3 = readTierSelection(sel, tierMinQty, key3);
            out.push({ variantId: pv3 || v, productId: pid2 || null, quantity: 1, isBase: Boolean(it2.isBase) });
          }
        }
      } else {
        out.push({ variantId: v, productId: pid2 || null, quantity: qty, isBase: Boolean(it2.isBase) });
      }
    }

    out.sort(function (a, b) {
      return String(a.variantId).localeCompare(String(b.variantId));
    });
    return out;
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

    const kind = String((bundle && bundle.kind) || "").trim();
    if (kind === "quantity_discount") {
      let hasOne = false;
      for (let i1 = 0; i1 < rows.length; i1++) {
        if (Number(rows[i1] && rows[i1].minQty) === 1) {
          hasOne = true;
          break;
        }
      }
      if (!hasOne) rows.push({ minQty: 1, pricing: pickPricingForQty(bundle, 1) });
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
      const left = Number(r.minQty) === 1 ? "قطعة واحدة" : "عند " + fmtNum(r.minQty) + " قطع";
      let right = "";
      if (Number.isFinite(o) && Number.isFinite(f)) {
        right = "قبل " + fmtMoney(o) + " • بعد " + fmtMoney(f);
        if (Number.isFinite(d) && d > 0) {
          right += " • وفّرت " + fmtMoney(d);
          const pct = pctFrom(o, f);
          if (pct != null) right += " (" + fmtNum(pct) + "%)";
        }
      }
      const active = Number(selectedMinQty) === Number(r.minQty);
      const cls = "bundle-app-tier" + (active ? " bundle-app-tier--selected" : "");
      out +=
        '<div class="bundle-app-tier-wrap">' +
        '<div class="' +
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
        "</div>" +
        '<span class="bundle-app-checkwrap bundle-app-tier-checkwrap">' +
        '<input class="bundle-app-check bundle-app-tier-check" type="checkbox" data-bundle-id="' +
        escHtml(bundleId) +
        '" data-tier-minqty="' +
        escHtml(r.minQty) +
        '" aria-label="اختيار هذا التير"' +
        (active ? " checked" : "") +
        "/>" +
        '<span class="bundle-app-checkmark"></span>' +
        "</span>" +
        "</div>" +
        '<div class="bundle-app-tier-pickers' +
        (active ? " is-open" : "") +
        '" data-bundle-id="' +
        escHtml(bundleId) +
        '" data-tier-minqty="' +
        escHtml(r.minQty) +
        '"></div>' +
        "</div>";
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

function buildProductsPriceText(bundle, bundleId) {
  try {
    const kind = String((bundle && bundle.kind) || "").trim();
    const bid = String(bundleId || (bundle && bundle.id) || "").trim();
    if (!bid) return "";

    const items = normalizeItems(bundle);
    const settings = (bundle && bundle.settings) || {};
    const req = Boolean(settings && settings.selectionRequired === true);
    const defIds = Array.isArray(settings && settings.defaultSelectedProductIds) ? settings.defaultSelectedProductIds : [];
    const include = {};
    let includeSize = 0;
    for (let i0 = 0; i0 < defIds.length; i0 += 1) {
      const s0 = String(defIds[i0] || "").trim();
      if (!s0) continue;
      if (!include[s0]) includeSize += 1;
      include[s0] = true;
    }

    const itemSel = typeof getBundleItemSelectionMap === "function" ? getBundleItemSelectionMap(bid) : null;
    let hasItemSel = false;
    if (itemSel && typeof itemSel === "object") {
      for (const k in itemSel) {
        if (Object.prototype.hasOwnProperty.call(itemSel, k)) {
          hasItemSel = true;
          break;
        }
      }
    }

    let subtotal = 0;
    let hasMissing = false;

    for (let i = 0; i < items.length; i += 1) {
      const it = items[i] || {};
      const v = String(it.variantId || "").trim();
      if (!v) continue;
      const isBase = Boolean(it.isBase);
      let pid = String(it.productId || "").trim();
      if (!pid && v.indexOf("product:") === 0) pid = String(v).slice("product:".length).trim();
      const qty = Math.max(1, Math.floor(Number(it.quantity || 1)));

      let on = false;
      if (isBase) on = true;
      else if (hasItemSel) on = itemSel && itemSel[String(i)] === true;
      else if (includeSize) on = Boolean(pid && include[pid] === true);
      else on = !req;

      if (!on) continue;

      const unit = it.price == null ? null : Number(it.price);
      if (unit == null || !Number.isFinite(unit) || unit < 0) {
        hasMissing = true;
        continue;
      }
      subtotal += unit * qty;
    }

    if (!Number.isFinite(subtotal) || subtotal < 0) return "";
    if (hasMissing && subtotal <= 0) return "السعر حسب اختيارك";

    if (kind === "products_discount") {
      const offer = (bundle && bundle.offer) || {};
      const type = String(offer.type || "").trim();
      const value = Number(offer.value ?? 0);
      let discount = 0;
      if (type === "percentage") {
        const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
        discount = (subtotal * pct) / 100;
      } else if (type === "fixed") {
        const amt = Math.max(0, Number.isFinite(value) ? value : 0);
        discount = Math.min(subtotal, amt);
      } else if (type === "bundle_price") {
        const price = Math.max(0, Number.isFinite(value) ? value : 0);
        discount = Math.max(0, Math.min(subtotal, subtotal - price));
      }

      const finalTotal = Math.max(0, subtotal - discount);
      let s = "قبل " + fmtMoney(subtotal) + " • بعد " + fmtMoney(finalTotal);
      if (Number.isFinite(discount) && discount > 0) s += " • وفّرت " + fmtMoney(discount);
      return s;
    }

    return "الإجمالي " + fmtMoney(subtotal);
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

    const postAddHasDiscount = (() => {
      if (kind !== "post_add_upsell") return false;
      const offer = (bundle && bundle.offer) || null;
      const t = String((offer && offer.type) || "").trim();
      const v = Number(offer && offer.value);
      return Boolean(t && Number.isFinite(v) && v > 0);
    })();

    if (kind === "products_no_discount" || (kind === "post_add_upsell" && !postAddHasDiscount)) {
      try {
        await addItemsToCart(items);
        messageByBundleId[bid] = "تمت إضافة المنتجات للسلة";
        if (kind === "post_add_upsell") {
          try {
            dismissPostAddForTrigger(trigger, typeof findVariantId === "function" ? findVariantId() : "");
          } catch (ePost) {}
        }
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

    if (kind === "post_add_upsell") {
      try {
        dismissPostAddForTrigger(trigger, typeof findVariantId === "function" ? findVariantId() : "");
      } catch (ePost2) {}
    }

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
      const hmReq = humanizeCartError(reqErr);
      var dbgReq = false;
      try {
        dbgReq = Boolean((g && g.BundleApp && g.BundleApp.__verboseErrors) || (typeof debug !== "undefined" && debug));
      } catch (xDbgReq) {}
      var extraReq = "";
      if (dbgReq) {
        try {
          extraReq = safeDebugStringify(
            {
              status: extractHttpStatus(reqErr),
              message: extractHttpMessage(reqErr),
              details: (reqErr && (reqErr.details || (reqErr.response && reqErr.response.data) || reqErr)) || null
            },
            12000
          );
        } catch (xExtraReq) {}
      }
      var baseReq = hmReq ? "تمت إضافة الباقة للسلة لكن فشل تجهيز الخصم (" + hmReq + ")" : "تمت إضافة الباقة للسلة لكن فشل تجهيز الخصم";
      messageByBundleId[bid] = extraReq ? baseReq + " | " + extraReq : baseReq;
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
        var dbgIssue = false;
        try {
          dbgIssue = Boolean((g && g.BundleApp && g.BundleApp.__verboseErrors) || (typeof debug !== "undefined" && debug));
        } catch (xDbgIssue) {}
        var extraIssue = "";
        if (dbgIssue) {
          try {
            extraIssue = safeDebugStringify(
              {
                couponIssueDetails: res.couponIssueDetails || null,
                applied: res.applied || null,
                couponCode: res.couponCode || null,
                discountAmount: res.discountAmount != null ? res.discountAmount : null,
                kind: res.kind || null
              },
              12000
            );
          } catch (xExtraIssue) {}
        }
        messageByBundleId[bid] = extraIssue ? "تمت إضافة الباقة للسلة لكن فشل كوبون الخصم | " + extraIssue : "تمت إضافة الباقة للسلة لكن فشل كوبون الخصم";
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
      var dbgRes = false;
      try {
        dbgRes = Boolean((g && g.BundleApp && g.BundleApp.__verboseErrors) || (typeof debug !== "undefined" && debug));
      } catch (xDbgRes) {}
      var extraRes = "";
      if (dbgRes) {
        try {
          extraRes = safeDebugStringify({ response: res || null }, 12000);
        } catch (xExtraRes) {}
      }
      messageByBundleId[bid] = extraRes ? "تمت إضافة الباقة للسلة لكن " + errMsg + " | " + extraRes : "تمت إضافة الباقة للسلة لكن " + errMsg;
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

    try {
      if (g && g.BundleApp && !g.BundleApp._pageLoadedAt) g.BundleApp._pageLoadedAt = Date.now();
    } catch (eLoad) {}

    try {
      ensureCartHooks();
    } catch (eHook) {}
    try {
      ensureCartSignals();
    } catch (eSig) {}

    const variantId = findVariantId();
    const productId = findProductId();
    const key = productId ? "p:" + String(productId) : variantId ? "v:" + String(variantId) : "";
    log("bundle-app: ids", { variantId: variantId, productId: productId });
    try {
      const pid0 = String(productId || "").trim();
      const vid0 = String(variantId || "").trim();
      const meta0 = readMainProductMetaFromDom();
      if (meta0 && (meta0.name || meta0.imageUrl)) {
        if (pid0) rememberComponentMeta("product:" + pid0, pid0, meta0.name, meta0.imageUrl);
        if (vid0) rememberComponentMeta(vid0, pid0, meta0.name, meta0.imageUrl);
      }
    } catch (eMeta0) {}

    let res = null;
    if (productId) res = await getProductBundlesByProductId(productId);
    else if (variantId) res = await getProductBundlesByVariantId(variantId);
    else {
      clearProductBanner();
      state.lastKey = "";
      state.lastSig = "";
      return;
    }

    let bundles = (res && res.bundles) || [];
    try {
      const hasPostAdd = Array.isArray(bundles) && bundles.some((b) => String((b && b.kind) || "").trim() === "post_add_upsell");
      if (hasPostAdd) {
        const pid = String(productId || "").trim();
        const vid = String(variantId || "").trim();
        const ok = shouldShowPostAdd(pid, vid);
        if (!ok) bundles = bundles.filter((b) => String((b && b.kind) || "").trim() !== "post_add_upsell");
      }
    } catch (eGate) {}
    if (!bundles.length) {
      clearProductBanner();
      state.lastKey = key;
      state.lastSig = "";
      return;
    }

    try {
      const uniqPid = {};
      for (let bi = 0; bi < bundles.length; bi += 1) {
        const its0 = normalizeItems(bundles[bi] || {});
        for (let ii = 0; ii < its0.length; ii += 1) {
          const it0 = its0[ii] || {};
          const v0 = String(it0.variantId || "").trim();
          if (!isProductRef(v0)) continue;
          const pid = typeof canonProductId === "function" ? canonProductId(it0.productId, v0) : String(it0.productId || "").trim();
          if (pid) uniqPid[pid] = true;
        }
      }
      const pids = Object.keys(uniqPid);
      for (let pi = 0; pi < pids.length; pi += 1) {
        try {
          getCachedVariants(pids[pi]);
        } catch (ePre) {}
      }
    } catch (eWarm) {}

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

    if (
      !applying &&
      lastBundles &&
      Array.isArray(lastBundles) &&
      lastBundles.length &&
      key === state.lastKey &&
      Array.isArray(bundles) &&
      bundles.length
    ) {
      try {
        const prev = lastBundles;
        const prevById = {};
        const nextById = {};
        for (let i0 = 0; i0 < prev.length; i0 += 1) {
          const pb = prev[i0] || {};
          const id0 = String(pb.id || "").trim();
          if (id0) prevById[id0] = pb;
        }
        for (let i1 = 0; i1 < bundles.length; i1 += 1) {
          const nb = bundles[i1] || {};
          const id1 = String(nb.id || "").trim();
          if (id1) nextById[id1] = nb;
        }

        let sameIds = true;
        const nextIds = Object.keys(nextById);
        const prevIds = Object.keys(prevById);
        if (nextIds.length !== prevIds.length) sameIds = false;
        if (sameIds) {
          for (let i2 = 0; i2 < nextIds.length; i2 += 1) {
            if (!prevById[nextIds[i2]]) {
              sameIds = false;
              break;
            }
          }
        }

        if (sameIds) {
          function meta(arr0) {
            const m = { items: 0, name: 0, img: 0, price: 0 };
            for (let bi = 0; bi < arr0.length; bi += 1) {
              const bb = arr0[bi] || {};
              const its = normalizeItems(bb);
              for (let ii = 0; ii < its.length; ii += 1) {
                const it = its[ii] || {};
                m.items += 1;
                if (String(it.name || "").trim()) m.name += 1;
                if (String(it.imageUrl || "").trim()) m.img += 1;
                const p = it.price == null ? null : Number(it.price);
                if (p != null && Number.isFinite(p) && p >= 0) m.price += 1;
              }
            }
            return m;
          }

          const pm = meta(prev);
          const nm = meta(bundles);
          const degraded =
            (pm.img > 0 && nm.img <= 0) ||
            (pm.name > 0 && nm.name <= 0) ||
            (pm.img > 0 && nm.img < Math.floor(pm.img * 0.5)) ||
            (pm.name > 0 && nm.name < Math.floor(pm.name * 0.5)) ||
            (pm.price > 0 && nm.price < Math.floor(pm.price * 0.5));

          if (degraded) return;

          try {
            function pickItemsArray(b0) {
              if (b0 && Array.isArray(b0.components) && b0.components.length) return b0.components;
              if (b0 && Array.isArray(b0.bundleItems) && b0.bundleItems.length) return b0.bundleItems;
              return null;
            }

            function itemKey(c0) {
              const v0 = String((c0 && c0.variantId) || "").trim();
              const p0 = String((c0 && c0.productId) || "").trim();
              const b0 = c0 && c0.isBase ? "1" : "0";
              const q0 = c0 && c0.quantity != null ? String(c0.quantity) : "";
              return v0 + "|" + p0 + "|" + b0 + "|" + q0;
            }

            function mergeComponentMeta(prevBundle0, nextBundle0) {
              if (!prevBundle0 || !nextBundle0) return;
              const prevItems = pickItemsArray(prevBundle0);
              const nextItems = pickItemsArray(nextBundle0);
              if (!prevItems || !nextItems) return;

              const prevByKey = {};
              for (let pi = 0; pi < prevItems.length; pi += 1) {
                const pc = prevItems[pi] || {};
                const k = itemKey(pc);
                if (!k) continue;
                if (!prevByKey[k]) prevByKey[k] = [];
                prevByKey[k].push(pc);
              }

              for (let ni = 0; ni < nextItems.length; ni += 1) {
                const nc = nextItems[ni] || {};
                const k = itemKey(nc);
                if (!k || !prevByKey[k] || !prevByKey[k].length) continue;
                const pc = prevByKey[k].shift() || null;
                if (!pc) continue;

                if (!String(nc.name || "").trim() && String(pc.name || "").trim()) nc.name = pc.name;
                if (!String(nc.imageUrl || "").trim() && String(pc.imageUrl || "").trim()) nc.imageUrl = pc.imageUrl;

                const np = nc.price == null ? null : Number(nc.price);
                const pp = pc.price == null ? null : Number(pc.price);
                if ((np == null || !Number.isFinite(np)) && pp != null && Number.isFinite(pp)) nc.price = pc.price;

                if (
                  (!nc.attributes || typeof nc.attributes !== "object" || Array.isArray(nc.attributes)) &&
                  pc.attributes &&
                  typeof pc.attributes === "object" &&
                  !Array.isArray(pc.attributes)
                ) {
                  nc.attributes = pc.attributes;
                }
              }
            }

            for (const idK in nextById) {
              if (!Object.prototype.hasOwnProperty.call(nextById, idK)) continue;
              mergeComponentMeta(prevById[idK], nextById[idK]);
            }
          } catch (eMerge) {}
        }
      } catch (eMeta) {}
    }

    state.lastKey = key;
    state.lastSig = sig;
    lastBundles = bundles;
    renderProductBanners(bundles);
  } catch (e) {
    warn("bundle-app: refresh failed", e && (e.details || e.message || e));
    if (!lastBundles) clearProductBanner();
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
