module.exports = `
function alsoBoughtRootId() {
  return "bundle-app-also-bought-root";
}

function ensureAlsoBoughtRoot() {
  const id = alsoBoughtRootId();
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement("div");
    root.id = id;
    (document.body || document.documentElement).appendChild(root);
  }
  return root;
}

function clearAlsoBoughtWidget() {
  try {
    const root = document.getElementById(alsoBoughtRootId());
    if (root) root.remove();
  } catch (e) {}
}

function renderAlsoBoughtItems(bundle) {
  const items = normalizeItems(bundle);
  let html = "";
  html += '<div style="display:flex;flex-direction:column;gap:10px">';
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i] || {};
    const v = String(it.variantId || "").trim();
    const pid = String(it.productId || "").trim();
    const isRef = typeof isProductRef === "function" ? isProductRef(v) : v.indexOf("product:") === 0;
    const img = String(it.imageUrl || "").trim();
    const name = String(it.name || "").trim() || (pid ? "منتج " + pid : "منتج");
    const qty = Math.max(1, Math.floor(Number(it.quantity || 1)));
    const price = it.price != null && Number.isFinite(Number(it.price)) && Number(it.price) >= 0 ? fmtMoney(Number(it.price)) : "";
    html += '<div data-item-index="' + escHtml(String(i)) + '" style="display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid rgba(2,6,23,.10);border-radius:14px;background:#fff">';
    html += '<div style="width:54px;height:54px;flex:0 0 54px;border-radius:12px;overflow:hidden;background:rgba(2,6,23,.06)">';
    if (img) html += '<img alt="" loading="lazy" src="' + escHtml(img) + '" style="width:100%;height:100%;object-fit:cover;display:block"/>';
    html += "</div>";
    html += '<div style="min-width:0;flex:1;display:flex;flex-direction:column;gap:4px">';
    html += '<div style="font-size:13px;font-weight:950;line-height:1.25;color:#0b1220;word-break:break-word">' + escHtml(name) + "</div>";
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;font-size:12px;color:rgba(2,6,23,.75);font-weight:850">';
    if (price) html += "<span>" + escHtml(price) + "</span>";
    if (qty > 1) html += '<span style="opacity:.8">× ' + escHtml(String(qty)) + "</span>";
    html += "</div>";
    html += "</div>";
    html += '<div style="flex:0 0 auto;display:flex;align-items:center;gap:8px">';
    html +=
      '<button type="button" class="bundle-app-btn bundle-app-btn--mini" data-action="' +
      (isRef ? "ab-pick-variant" : "ab-add-item") +
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

function showAlsoBoughtWidget(bundle, placement) {
  try {
    ensureStyles();
    ensurePickerStyles();
  } catch (e0) {}

  const b = bundle || null;
  if (!b) {
    clearAlsoBoughtWidget();
    return;
  }
  const bid = String(b.id || "").trim();
  if (!bid) {
    clearAlsoBoughtWidget();
    return;
  }

  const root = ensureAlsoBoughtRoot();
  const title = normalizeTitle(b.title || b.name || "منتجات اشترها عملاؤنا ايضا");
  const sub = String(b.subtitle || "").trim();

  const pos = "position:fixed;right:14px;bottom:14px;z-index:100000;display:flex;flex-direction:column;align-items:flex-end;gap:10px;";
  const fab =
    "border:0;border-radius:999px;padding:12px 14px;font-size:13px;font-weight:950;cursor:pointer;box-shadow:0 18px 44px rgba(2,6,23,.22);background:#0b1220;color:#fff;max-width:min(90vw,360px);";

  let html = "";
  html += '<div style="' + pos + '" data-bundle-id="' + escHtml(bid) + '" data-placement="' + escHtml(String(placement || "")) + '">';
  html += '<button type="button" style="' + fab + '" data-action="ab-open">منتجات اشترها عملاؤنا ايضا</button>';
  html += '<div data-role="ab-sheet" style="display:none">';
  html += '<div class="bundle-app-bottomsheet" data-action="ab-close" aria-hidden="true">';
  html += '<div class="bundle-app-bottomsheet__panel" role="dialog" aria-modal="true" data-action="ab-stop">';
  html += '<div class="bundle-app-bottomsheet__head">';
  html += '<div style="min-width:0">';
  html += '<div class="bundle-app-bottomsheet__title">' + escHtml(title) + "</div>";
  if (sub) html += '<div class="bundle-app-bottomsheet__sub">' + escHtml(sub) + "</div>";
  html += "</div>";
  html += '<button class="bundle-app-bottomsheet__close" type="button" data-action="ab-close" aria-label="إغلاق">×</button>';
  html += "</div>";
  html += '<div class="bundle-app-bottomsheet__content">' + renderAlsoBoughtItems(b) + "</div>";
  html += '<div class="bundle-app-bottomsheet__cta">';
  html += '<button class="bundle-app-bottomsheet__btn bundle-app-bottomsheet__btn-secondary" type="button" data-action="ab-close">إغلاق</button>';
  html += '<button class="bundle-app-bottomsheet__btn bundle-app-bottomsheet__btn-primary" type="button" data-action="ab-add-all">أضف الكل</button>';
  html += "</div>";
  html += "</div>";
  html += "</div>";
  html += "</div>";
  html += "</div>";

  root.innerHTML = html;

  function openSheet() {
    try {
      const el = root.querySelector('[data-role="ab-sheet"]');
      if (el) el.style.display = "block";
    } catch (e) {}
  }
  function closeSheet() {
    try {
      const el = root.querySelector('[data-role="ab-sheet"]');
      if (el) el.style.display = "none";
      try {
        const box = root.querySelector(".bundle-app-popup__variantbox");
        if (box) box.remove();
      } catch (e2) {}
    } catch (e) {}
  }

  root.onclick = function (e) {
    try {
      let t = e && e.target ? e.target : null;
      while (t && t !== root) {
        const act = t && t.getAttribute ? t.getAttribute("data-action") : "";
        if (act) {
          if (e && e.preventDefault) e.preventDefault();
          if (act === "ab-open") {
            openSheet();
            return;
          }
          if (act === "ab-close") {
            closeSheet();
            return;
          }
          if (act === "ab-stop") {
            return;
          }
          if (act === "ab-add-all") {
            (async function () {
              try {
                const items = normalizeItems(b);
                const resolved = typeof resolveProductRefItems === "function" ? await resolveProductRefItems(items, bid) : items;
                await addItemsToCart(resolved || []);
              } catch (e0) {}
            })();
            closeSheet();
            return;
          }
          if (act === "ab-add-item") {
            const idx = Number(String(t.getAttribute("data-item-index") || "").trim());
            const items = normalizeItems(b);
            if (!Number.isFinite(idx) || idx < 0 || idx >= items.length) return;
            const it = items[idx] || {};
            const v = String(it.variantId || "").trim();
            const pid = String(it.productId || "").trim();
            const qty = Math.max(1, Math.floor(Number(it.quantity || 1)));
            addItemsToCart([{ variantId: v, productId: pid || null, quantity: qty }]);
            return;
          }
          if (act === "ab-pick-variant") {
            const pid = String(t.getAttribute("data-product-id") || "").trim();
            const idx = Number(String(t.getAttribute("data-item-index") || "").trim());
            const items = normalizeItems(b);
            const qty = Number.isFinite(idx) && idx >= 0 && idx < items.length ? Math.max(1, Math.floor(Number((items[idx] || {}).quantity || 1))) : 1;
            if (!pid) return;
            openAlsoBoughtVariantPicker(root, b, pid, qty);
            return;
          }
          break;
        }
        t = t.parentNode;
      }
    } catch (e0) {}
  };
}

async function openAlsoBoughtVariantPicker(root, bundle, productId, qty) {
  try {
    const pid = String(productId || "").trim();
    if (!pid) return;
    const bid = String((bundle && bundle.id) || "").trim();
    if (!bid) return;
    const q = Math.max(1, Math.floor(Number(qty || 1)));

    const vars = typeof getCachedVariants === "function" ? await getCachedVariants(pid) : [];
    const list = (Array.isArray(vars) ? vars : []).filter((x) => x && x.isActive === true && String(x.variantId || "").trim());
    if (!list.length) {
      addItemsToCart([{ variantId: "product:" + pid, productId: pid, quantity: q }]);
      return;
    }

    const sel = typeof getBundleVariantSelectionMap === "function" ? getBundleVariantSelectionMap(bid) : null;
    const key = pid + ":0";
    let selected = sel ? String(sel[key] || "").trim() : "";
    if (!selected || !list.some((x) => String((x && x.variantId) || "").trim() === selected))
      selected = String((list[0] && list[0].variantId) || "").trim();

    try {
      const old = root.querySelector(".bundle-app-popup__variantbox");
      if (old) old.remove();
    } catch (e0) {}

    const box = document.createElement("div");
    box.className = "bundle-app-popup__variantbox";
    let html = "";
    html += '<div class="bundle-app-popup__varianthead">اختيار الفاريانت</div>';
    html += '<select class="bundle-app-popup__variantselect" data-role="ab-variant-select">';
    for (const v of list) {
      const vid = String(v.variantId || "").trim();
      if (!vid) continue;
      html += '<option value="' + escHtml(vid) + '"' + (vid === selected ? " selected" : "") + ">" + escHtml(variantLabel(v)) + "</option>";
    }
    html += "</select>";
    html += '<div class="bundle-app-popup__variantactions">';
    html += '<button type="button" class="bundle-app-btn bundle-app-btn--ghost" data-role="ab-variant-cancel">إلغاء</button>';
    html += '<button type="button" class="bundle-app-btn" data-role="ab-variant-confirm">إضافة</button>';
    html += "</div>";
    box.innerHTML = html;
    root.appendChild(box);

    const select = box.querySelector('select[data-role="ab-variant-select"]');
    const btnCancel = box.querySelector('button[data-role="ab-variant-cancel"]');
    const btnOk = box.querySelector('button[data-role="ab-variant-confirm"]');

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
    if (btnOk) {
      btnOk.onclick = function () {
        try {
          const vid = String((select && select.value) || "").trim();
          if (!vid) return;
          if (sel) sel[key] = vid;
          addItemsToCart([{ variantId: vid, productId: pid, quantity: q }]);
        } catch (e2) {}
        close();
      };
    }
  } catch (e) {}
}
`;

