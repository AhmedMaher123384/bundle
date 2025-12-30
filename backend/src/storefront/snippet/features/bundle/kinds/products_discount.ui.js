module.exports = `
function renderBundleCard_products_discount(b) {
  const bid = String((b && b.id) || "");
  const color = String((b && b.bannerColor) || "#0ea5e9");
  const textColor = String((b && b.textColor) || "#ffffff");
  const title = normalizeTitle(b && b.title);
  const subtitle = String((b && b.subtitle) || "");
  const label = String((b && b.label) || "");
  const labelSub = String((b && b.labelSub) || "");
  const labelBg = String((b && (b.labelBgColor || b.badgeColor)) || "");
  const labelText = String((b && b.labelTextColor) || textColor || "");
  const ctaBg = String((b && b.ctaBgColor) || "");
  const ctaText = String((b && b.ctaTextColor) || "");
  const showItems = !(b && b.showItems === false);
  const showPrice = !(b && b.showPrice === false);

  const settings = (b && b.settings) || {};
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

  const items = normalizeItems(b);
  const itemsText = showItems && items.length ? buildItemsText(items) : "";
  const priceText = showPrice ? buildProductsPriceText(b, bid) : "";
  const msg = String(messageByBundleId[bid] || "");

  const checked = bid === String(selectedBundleId || "");
  const cls = "bundle-app-card bundle-app-card--kind-products-discount" + (checked ? " bundle-app-card--selected" : "");

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

  let btnLabel = String((b && b.cta) || "أضف الباقة");

  const cardStyle = "background:" + escHtml(color) + ";color:" + escHtml(textColor) + ";";
  let btnStyle = "";
  if (ctaBg) btnStyle += "background:" + escHtml(ctaBg) + ";";
  if (ctaText) btnStyle += "color:" + escHtml(ctaText) + ";";

  let labelStyle = "";
  if (labelBg) labelStyle += "background:" + escHtml(labelBg) + ";";
  else labelStyle += "background:rgba(255,255,255,.18);";
  if (labelText) labelStyle += "color:" + escHtml(labelText) + ";";

  let html = "";
  html +=
    '<div class="' +
    cls +
    '" style="' +
    cardStyle +
    '" data-bundle-id="' +
    escHtml(bid) +
    '" data-kind="products_discount">';

  html += '<div class="bundle-app-kind-chip">خصم منتجات</div>';

  html += '<div class="bundle-app-row">';
  html += '<div class="bundle-app-choice">';
  html += '<div class="bundle-app-content">';
  html += '<div class="bundle-app-head">';
  html += '<div class="bundle-app-title">' + escHtml(title) + "</div>";
  html += label ? '<div class="bundle-app-label" style="' + labelStyle + '">' + escHtml(label) + "</div>" : "";
  html += "</div>";
  html += subtitle ? '<div class="bundle-app-subtitle">' + escHtml(subtitle) + "</div>" : "";
  html += labelSub ? '<div class="bundle-app-label-sub">' + escHtml(labelSub) + "</div>" : "";
  html += "</div>";
  html += "</div>";
  html += "</div>";

  html += '<div class="bundle-app-kind-hint">' + escHtml(req ? "اختر منتج واحد على الأقل" : "اختار المنتجات اللي عايزها") + "</div>";

  if (itemsText) html += '<div class="bundle-app-items">' + escHtml(itemsText) + "</div>";

  if (showItems && items.length) {
    html += '<div class="bundle-app-products bundle-app-products--products">';
    for (let i1 = 0; i1 < items.length; i1 += 1) {
      const it1 = items[i1] || {};
      const v1 = String(it1.variantId || "").trim();
      if (!v1) continue;
      const isBase1 = Boolean(it1.isBase);
      let pid1 = String(it1.productId || "").trim();
      if (!pid1 && v1 && v1.indexOf("product:") === 0) pid1 = String(v1).slice("product:".length).trim();

      const on1 = isBase1
        ? true
        : hasItemSel
          ? itemSel && itemSel[String(i1)] === true
          : includeSize
            ? include[pid1] === true
            : !req;

      const name1 = String(it1.name || "").trim() || pid1 || v1;
      const qty1 = Math.max(1, Math.floor(Number(it1.quantity || 1)));
      const img1 = String(it1.imageUrl || "").trim();

      let attrsText1 = "";
      const attrs1 = it1.attributes;
      if (attrs1 && typeof attrs1 === "object" && !Array.isArray(attrs1)) {
        const parts1 = [];
        for (const k1 in attrs1) {
          if (!Object.prototype.hasOwnProperty.call(attrs1, k1)) continue;
          const kk1 = String(k1 || "").trim();
          const vv1 = attrs1[k1];
          let vs1 = "";
          if (Array.isArray(vv1)) {
            const xs1 = vv1.map((x) => String(x || "").trim()).filter(Boolean);
            vs1 = xs1.join(" / ");
          } else if (vv1 != null && typeof vv1 === "object") {
            const cand1 = String(vv1.value || vv1.name || vv1.label || "").trim();
            vs1 = cand1 || String(vv1 || "").trim();
          } else {
            vs1 = String(vv1 == null ? "" : vv1).trim();
          }
          if (!kk1 || !vs1) continue;
          parts1.push(kk1 + ": " + vs1);
        }
        attrsText1 = parts1.join(" • ");
      }

      const attrsLine1 = "الكمية: " + fmtNum(qty1) + (attrsText1 ? " • " + attrsText1 : "");

      html +=
        '<div class="bundle-app-product bundle-app-product-item" data-item-index="' +
        escHtml(i1) +
        '">' +
        '<div class="bundle-app-product__media">' +
        (img1 ? '<img class="bundle-app-product__img" src="' + escHtml(img1) + '" alt="" />' : "") +
        "</div>" +
        '<div class="bundle-app-product__body">' +
        '<div class="bundle-app-product__top">' +
        '<div class="bundle-app-product__name">' +
        escHtml(name1) +
        "</div>" +
        '<div class="bundle-app-product__checkwrap bundle-app-product-checkwrap"' +
        (isBase1 ? ' style="display:none"' : "") +
        ">" +
        '<input class="bundle-app-product__check bundle-app-product-check" type="checkbox" data-bundle-id="' +
        escHtml(bid) +
        '" data-item-index="' +
        escHtml(i1) +
        '"' +
        (on1 ? " checked" : "") +
        (isBase1 ? " disabled" : "") +
        "/>" +
        '<div class="bundle-app-product__checkmark"></div>' +
        "</div>" +
        "</div>" +
        '<div class="bundle-app-product__attrs">' +
        escHtml(attrsLine1) +
        "</div>" +
        '<div class="bundle-app-product-variants" data-bundle-id="' +
        escHtml(bid) +
        '" data-item-index="' +
        escHtml(i1) +
        '"></div>' +
        "</div>" +
        "</div>";
    }
    html += "</div>";
  }

  html +=
    (priceText ? '<div class="bundle-app-price">' + escHtml(priceText) + "</div>" : "") +
    (msg ? '<div class="bundle-app-msg">' + escHtml(msg) + "</div>" : "") +
    '<button class="bundle-app-btn" type="button" data-action="apply-one" data-bundle-id="' +
    escHtml(bid) +
    '" ' +
    (applying ? "disabled" : "") +
    (btnStyle ? ' style="' + btnStyle + ';width:100%;margin-top:12px"' : ' style="width:100%;margin-top:12px"') +
    ">" +
    escHtml(btnLabel) +
    "</button>" +
    "</div>";

  return html;
}
`;
