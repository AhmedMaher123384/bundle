module.exports = `
function popupRootId() {
  return "bundle-app-popup-root";
}

function ensurePopupRoot() {
  const id = popupRootId();
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement("div");
    root.id = id;
    (document.body || document.documentElement).appendChild(root);
  }
  return root;
}

function clearBundlePopup() {
  try {
    const root = document.getElementById(popupRootId());
    if (root) root.remove();
  } catch (e) {}
}

function popupCartTotalsKey() {
  return "bundle_app_popup_cart_totals_cache:" + String(merchantId || "");
}

async function readCartTotalsForPopup() {
  try {
    const storageKey = popupCartTotalsKey();
    const cached = (() => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (!raw) return null;
        const j = JSON.parse(raw);
        if (!j || typeof j !== "object") return null;
        const ts = Number(j.ts || 0);
        if (!Number.isFinite(ts) || ts <= 0) return null;
        if (Date.now() - ts > 5000) return null;
        return j;
      } catch (e) {
        return null;
      }
    })();
    if (cached) return cached;

    let total = null;
    let count = 0;
    try {
      const r = await fetch("/api/cart", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const t = r ? await r.text() : "";
      let j = null;
      try {
        j = t ? JSON.parse(t) : null;
      } catch (e0) {
        j = null;
      }
      const cart = (j && (j.cart || (j.data && (j.data.cart || j.data)) || j)) || null;
      const items = (cart && (cart.items || (cart.data && cart.data.items) || cart.cart_items || cart.cartItems)) || [];
      if (Array.isArray(items)) count = items.length;
      const candidates = [cart && cart.total, cart && cart.total_amount, cart && cart.totalAmount, cart && cart.subtotal, cart && cart.subtotal_amount];
      for (let i = 0; i < candidates.length; i += 1) {
        const n = Number(candidates[i]);
        if (Number.isFinite(n) && n >= 0) {
          total = n;
          break;
        }
      }
      if (total == null && Array.isArray(items) && items.length) {
        let sum = 0;
        let ok = false;
        for (const it of items) {
          const qty = Math.max(1, Math.floor(Number(it && (it.quantity || it.qty || it.count || 1)) || 1));
          const unit = Number((it && (it.price || it.unit_price || it.unitPrice || (it.product && it.product.price) || (it.variant && it.variant.price))) || 0);
          if (Number.isFinite(unit) && unit >= 0) {
            sum += unit * qty;
            ok = true;
          }
        }
        if (ok) total = sum;
      }
    } catch (e1) {}

    const out = { ts: Date.now(), total: total, count: count };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(out));
    } catch (e2) {}
    return out;
  } catch (e) {
    return { ts: Date.now(), total: null, count: 0 };
  }
}

function renderPopupCartSummary(bundle) {
  const settings = (bundle && bundle.popupSettings) || {};
  const show = settings && settings.showCartTotal !== false;
  if (!show) return "";
  return (
    '<div class="bundle-app-popup__summary">' +
    '<div class="bundle-app-popup__summary-title">السلة</div>' +
    '<div class="bundle-app-popup__summary-body">' +
    '<div class="bundle-app-popup__summary-line"><span>الإجمالي</span> <span data-role="popup-cart-total">—</span></div>' +
    '<div class="bundle-app-popup__summary-line is-muted"><span>عدد المنتجات</span> <span data-role="popup-cart-count">—</span></div>' +
    "</div>" +
    "</div>"
  );
}

function renderPopupProducts(bundle) {
  const items = normalizeItems(bundle);
  let html = '<div class="bundle-app-popup__products">';
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i] || {};
    const name = String(it.name || "").trim();
    const img = String(it.imageUrl || "").trim();
    const price = it.price != null && Number.isFinite(Number(it.price)) && Number(it.price) >= 0 ? fmtMoney(Number(it.price)) : "";
    const qty = Math.max(1, Math.floor(Number(it.quantity || 1)));
    const v = String(it.variantId || "").trim();
    const pid = String(it.productId || "").trim();
    const isRef = typeof isProductRef === "function" ? isProductRef(v) : v.indexOf("product:") === 0;
    const title = name || (pid ? "منتج " + pid : "منتج");
    html += '<div class="bundle-app-popup__item" data-item-index="' + String(i) + '">';
    html += '<div class="bundle-app-popup__item-media">';
    if (img) html += '<img alt="" loading="lazy" src="' + escHtml(img) + '"/>';
    else html += '<div class="bundle-app-popup__item-ph"></div>';
    html += "</div>";
    html += '<div class="bundle-app-popup__item-body">';
    html += '<div class="bundle-app-popup__item-title">' + escHtml(title) + "</div>";
    html += '<div class="bundle-app-popup__item-sub">';
    if (price) html += '<span class="bundle-app-popup__item-price">' + escHtml(price) + "</span>";
    if (qty > 1) html += '<span class="bundle-app-popup__item-qty">× ' + escHtml(String(qty)) + "</span>";
    html += "</div>";
    html += "</div>";
    html += '<div class="bundle-app-popup__item-actions">';
    html +=
      '<button type="button" class="bundle-app-btn bundle-app-btn--mini" data-action="' +
      (isRef ? "popup-pick-variant" : "popup-add-item") +
      '" data-item-index="' +
      escHtml(String(i)) +
      '" data-product-id="' +
      escHtml(pid || (isRef ? String(v).slice("product:".length).trim() : "")) +
      '" data-variant-id="' +
      escHtml(v) +
      '">' +
      (isRef ? "اختيار" : "أضف") +
      "</button>";
    html += "</div>";
    html += "</div>";
  }
  html += "</div>";
  return html;
}

function showBundlePopup(bundle, meta) {
  try {
    ensureStyles();
    ensurePickerStyles();
  } catch (e0) {}

  const b = bundle || null;
  if (!b) return;
  const bid = String(b.id || "").trim();
  if (!bid) return;

  const root = ensurePopupRoot();
  const settings = (b && b.popupSettings) || {};
  const allowDoNotShow = settings && settings.allowDoNotShow !== false;
  const allowBulkAdd = settings && settings.allowBulkAdd !== false;

  let html = "";
  html += '<div class="bundle-app-popup" data-bundle-id="' + escHtml(bid) + '">';
  html += '<div class="bundle-app-popup__overlay" data-action="popup-close" aria-hidden="true"></div>';
  html += '<div class="bundle-app-popup__panel" role="dialog" aria-modal="true">';
  html += '<div class="bundle-app-popup__head">';
  html += '<div class="bundle-app-popup__head-text">';
  html += '<div class="bundle-app-popup__title">' + escHtml(normalizeTitle(b.title || b.name || "باقة")) + "</div>";
  if (String(b.subtitle || "").trim()) html += '<div class="bundle-app-popup__subtitle">' + escHtml(String(b.subtitle || "").trim()) + "</div>";
  html += "</div>";
  html += '<button type="button" class="bundle-app-popup__close" data-action="popup-close" aria-label="إغلاق">×</button>';
  html += "</div>";
  html += '<div class="bundle-app-popup__body">';
  html += renderPopupCartSummary(b);
  html += renderPopupProducts(b);
  html += "</div>";
  html += '<div class="bundle-app-popup__foot">';
  html += '<div class="bundle-app-popup__foot-actions">';
  html += '<button type="button" class="bundle-app-btn bundle-app-btn--ghost" data-action="popup-continue">استكمال التسوق</button>';
  if (allowBulkAdd) {
    html += '<button type="button" class="bundle-app-btn" data-action="popup-add-bundle" data-bundle-id="' + escHtml(bid) + '">أضف الباقة</button>';
  }
  html += "</div>";
  if (allowDoNotShow) {
    html += '<label class="bundle-app-popup__dontshow"><input type="checkbox" data-role="popup-dontshow" /> <span>عدم الظهور مرة أخرى</span></label>';
  }
  html += "</div>";
  html += "</div>";
  html += "</div>";

  root.innerHTML = html;

  root.onclick = function (e) {
    try {
      let t = e && e.target ? e.target : null;
      while (t && t !== root) {
        const act = t && t.getAttribute ? t.getAttribute("data-action") : "";
        if (act) {
          if (e && e.preventDefault) e.preventDefault();
          if (act === "popup-close" || act === "popup-continue") {
            clearBundlePopup();
            return;
          }
          if (act === "popup-add-bundle") {
            try {
              applyBundleSelection(b);
            } catch (eA0) {}
            clearBundlePopup();
            return;
          }
          if (act === "popup-add-item") {
            const idx = String(t.getAttribute("data-item-index") || "").trim();
            const i = Number(idx);
            const items = normalizeItems(b);
            if (!Number.isFinite(i) || i < 0 || i >= items.length) return;
            const it = items[i] || {};
            const v = String(it.variantId || "").trim();
            const pid = String(it.productId || "").trim();
            const qty = Math.max(1, Math.floor(Number(it.quantity || 1)));
            addItemsToCart([{ variantId: v, productId: pid || null, quantity: qty }]);
            return;
          }
          if (act === "popup-pick-variant") {
            const pid = String(t.getAttribute("data-product-id") || "").trim();
            if (!pid) return;
            openPopupVariantPicker(root, b, pid);
            return;
          }
          break;
        }
        t = t.parentNode;
      }
    } catch (e0) {}
  };

  try {
    const dont = root.querySelector('input[data-role="popup-dontshow"]');
    if (dont) {
      dont.onchange = function () {
        if (dont.checked === true) {
          try {
            markPopupDismissed(bid);
          } catch (eD0) {}
          clearBundlePopup();
        }
      };
    }
  } catch (e1) {}

  try {
    (async function () {
      const totals = await readCartTotalsForPopup();
      const totalEl = root.querySelector('[data-role="popup-cart-total"]');
      const countEl = root.querySelector('[data-role="popup-cart-count"]');
      if (totalEl) totalEl.textContent = totals && totals.total != null && Number.isFinite(Number(totals.total)) ? fmtMoney(Number(totals.total)) : "—";
      if (countEl) countEl.textContent = totals && Number.isFinite(Number(totals.count)) ? fmtNum(Number(totals.count)) : "—";
    })();
  } catch (e2) {}
}

async function openPopupVariantPicker(root, bundle, productId) {
  try {
    const pid = String(productId || "").trim();
    if (!pid) return;
    const bid = String((bundle && bundle.id) || "").trim();
    if (!bid) return;
    const vars = typeof getCachedVariants === "function" ? await getCachedVariants(pid) : [];
    const list = (Array.isArray(vars) ? vars : []).filter((x) => x && x.isActive === true && String(x.variantId || "").trim());
    if (!list.length) {
      addItemsToCart([{ variantId: "product:" + pid, productId: pid, quantity: 1 }]);
      return;
    }

    const key = pid + ":0";
    const sel = typeof getBundleVariantSelectionMap === "function" ? getBundleVariantSelectionMap(bid) : null;
    let selected = sel ? String(sel[key] || "").trim() : "";
    if (!selected || !list.some((x) => String((x && x.variantId) || "").trim() === selected))
      selected = String((list[0] && list[0].variantId) || "").trim();

    const box = document.createElement("div");
    box.className = "bundle-app-popup__variantbox";
    let html = "";
    html += '<div class="bundle-app-popup__varianthead">اختيار الفاريانت</div>';
    html += '<select class="bundle-app-popup__variantselect" data-role="popup-variant-select">';
    for (const v of list) {
      const vid = String(v.variantId || "").trim();
      if (!vid) continue;
      html += '<option value="' + escHtml(vid) + '"' + (vid === selected ? " selected" : "") + ">" + escHtml(variantLabel(v)) + "</option>";
    }
    html += "</select>";
    html += '<div class="bundle-app-popup__variantactions">';
    html += '<button type="button" class="bundle-app-btn bundle-app-btn--ghost" data-role="popup-variant-cancel">إلغاء</button>';
    html += '<button type="button" class="bundle-app-btn" data-role="popup-variant-confirm">إضافة</button>';
    html += "</div>";
    box.innerHTML = html;
    root.appendChild(box);

    const select = box.querySelector('select[data-role="popup-variant-select"]');
    const btnCancel = box.querySelector('button[data-role="popup-variant-cancel"]');
    const btnOk = box.querySelector('button[data-role="popup-variant-confirm"]');

    function close() {
      try {
        box.remove();
      } catch (e0) {
        try {
          if (box.parentNode) box.parentNode.removeChild(box);
        } catch (e1) {}
      }
    }

    if (btnCancel) btnCancel.onclick = close;
    if (btnOk)
      btnOk.onclick = function () {
        const vid = select ? String(select.value || "").trim() : "";
        const meta = list.find((x) => String((x && x.variantId) || "").trim() === vid) || null;
        if (sel && typeof sel === "object" && vid) sel[key] = vid;
        addItemsToCart([
          {
            variantId: vid,
            productId: pid,
            cartProductId: meta && meta.cartProductId ? String(meta.cartProductId) : pid,
            cartOptions: meta && meta.cartOptions ? meta.cartOptions : null,
            quantity: 1
          }
        ]);
        close();
      };
  } catch (e) {}
}
`;

