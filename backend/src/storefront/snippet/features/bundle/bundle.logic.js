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
var selectedItemIndexesByBundleId = {};
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
    const name = c.name != null ? String(c.name || "").trim() || null : null;
    const imageUrl = c.imageUrl != null ? String(c.imageUrl || "").trim() || null : null;
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
            const pv = String(sel[key] || "").trim();
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = ref + ":" + p;
            const pv2 = String(sel[key2] || "").trim();
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
              const pv = String(sel[key] || "").trim();
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
        const pv = String(sel[key] || "").trim();
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
            const pv = String(sel[key] || "").trim();
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = pid2 + ":" + p;
            const pv2 = String(sel[key2] || "").trim();
            if (!pv2 && settings && settings.variantRequired !== false) continue;
            out.push({ variantId: pv2 || v, productId: pid2 || null, quantity: 1, isBase: Boolean(it2.isBase) });
          }
        } else {
          let pickedAll = true;
          const parts = [];
          for (let u2 = 0; u2 < qty; u2++) {
            const key3 = pid2 + ":" + u2;
            const pv3 = String(sel[key3] || "").trim();
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
            const pv = String(sel[key] || "").trim();
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
            const pv = String(sel[key] || "").trim();
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = pid2 + ":" + p;
            const pv2 = String(sel[key2] || "").trim();
            out.push({ variantId: pv2 || v, productId: pid2 || null, quantity: 1, isBase: Boolean(it2.isBase) });
          }
        } else {
          for (let m = 0; m < qty; m++) {
            const key3 = pid2 + ":" + m;
            const pv3 = String(sel[key3] || "").trim();
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
            const pv = String(sel[key] || "").trim();
            if (pv) pickedCount++;
          }
          for (let p = 0; p < pickedCount; p++) {
            const key2 = pid2 + ":" + p;
            const pv2 = String(sel[key2] || "").trim();
            out.push({ variantId: pv2 || v, productId: pid2 || null, quantity: 1, isBase: Boolean(it2.isBase) });
          }
        } else {
          for (let m = 0; m < qty; m++) {
            const key3 = pid2 + ":" + m;
            const pv3 = String(sel[key3] || "").trim();
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
      const left = "احمد " + fmtNum(r.minQty) + " ماهر";
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
        "</div></label>";
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
