module.exports = `
function renderBundleCard_quantity_discount(b) {
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
  const showTiers = !(b && b.showTiers === false);

  const selectedMinQty = pickMinQty(b);
  const items = normalizeItems(b);
  const itemsText = showItems && items.length ? buildItemsText(items) : "";
  const priceText = showPrice ? buildPriceText(b) : "";
  const tiersHtml = showTiers ? buildTierRows(b, bid, selectedMinQty, true) : "";
  const msg = String(messageByBundleId[bid] || "");

  const checked = bid === String(selectedBundleId || "");
  const cls = "bundle-app-card bundle-app-card--kind-quantity" + (checked ? " bundle-app-card--selected" : "");

  let btnLabel = String((b && b.cta) || "أضف الباقة");
  if (tiersHtml) {
    btnLabel =
      btnLabel +
      " (" +
      fmtNum(Math.max(getPageQty(), Math.max(minRequiredBaseQty(b), selectedMinQty))) +
      " قطع)";
  }

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
    '" data-kind="quantity_discount">';

  html += '<div class="bundle-app-kind-chip">خصم كمية</div>';

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

  if (itemsText) html += '<div class="bundle-app-items">' + escHtml(itemsText) + "</div>";

  if (tiersHtml) html += '<div class="bundle-app-tiers bundle-app-tiers--quantity">' + tiersHtml + "</div>";

  if (showItems && items.length) {
    html += '<div class="bundle-app-products bundle-app-products--quantity">';
    for (let i1 = 0; i1 < items.length; i1 += 1) {
      const it1 = items[i1] || {};
      const v1 = String(it1.variantId || "").trim();
      if (!v1) continue;
      const name1 = String(it1.name || "").trim() || String(it1.productId || "").trim() || v1;
      const qty1 = Math.max(1, Math.floor(Number(it1.quantity || 1)));
      const img1 = String(it1.imageUrl || "").trim();
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
        "</div>" +
        '<div class="bundle-app-product__attrs">' +
        escHtml("الكمية: " + fmtNum(qty1)) +
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

