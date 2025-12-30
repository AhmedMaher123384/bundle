module.exports = `
function renderBundleCard_post_add_upsell(b) {
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

  const items = normalizeItems(b);
  const msg = String(messageByBundleId[bid] || "");

  const checked = bid === String(selectedBundleId || "");
  const cls = "bundle-app-card bundle-app-card--kind-upsell" + (checked ? " bundle-app-card--selected" : "");

  let btnLabel = String((b && b.cta) || "أضف مع السلة");

  const cardStyle = "background:" + escHtml(color) + ";color:" + escHtml(textColor) + ";";
  let btnStyle = "";
  if (ctaBg) btnStyle += "background:" + escHtml(ctaBg) + ";";
  if (ctaText) btnStyle += "color:" + escHtml(ctaText) + ";";

  let labelStyle = "";
  if (labelBg) labelStyle += "background:" + escHtml(labelBg) + ";";
  else labelStyle += "background:rgba(255,255,255,.18);";
  if (labelText) labelStyle += "color:" + escHtml(labelText) + ";";

  let card = "";
  card +=
    '<div class="' +
    cls +
    '" style="' +
    cardStyle +
    '" data-bundle-id="' +
    escHtml(bid) +
    '" data-kind="post_add_upsell">';

  card += '<div class="bundle-app-kind-chip">إضافات مقترحة</div>';

  card += '<div class="bundle-app-row">';
  card += '<div class="bundle-app-choice">';
  card += '<div class="bundle-app-content">';
  card += '<div class="bundle-app-head">';
  card += '<div class="bundle-app-title">' + escHtml(title) + "</div>";
  card += label ? '<div class="bundle-app-label" style="' + labelStyle + '">' + escHtml(label) + "</div>" : "";
  card += "</div>";
  card += subtitle ? '<div class="bundle-app-subtitle">' + escHtml(subtitle) + "</div>" : "";
  card += labelSub ? '<div class="bundle-app-label-sub">' + escHtml(labelSub) + "</div>" : "";
  card += "</div>";
  card += "</div>";
  card += "</div>";

  if (showItems && items.length) {
    card += '<div class="bundle-app-products bundle-app-products--upsell">';
    for (let i1 = 0; i1 < items.length; i1 += 1) {
      const it1 = items[i1] || {};
      const v1 = String(it1.variantId || "").trim();
      if (!v1) continue;
      const isBase1 = Boolean(it1.isBase);
      const name1 = String(it1.name || "").trim() || String(it1.productId || "").trim() || v1;
      const qty1 = Math.max(1, Math.floor(Number(it1.quantity || 1)));
      const img1 = String(it1.imageUrl || "").trim();
      card +=
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
        (isBase1 ? " checked disabled" : "") +
        "/>" +
        '<div class="bundle-app-product__checkmark"></div>' +
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
    card += "</div>";
  }

  card +=
    (msg ? '<div class="bundle-app-msg">' + escHtml(msg) + "</div>" : "") +
    '<button class="bundle-app-btn bundle-app-btn--upsell" type="button" data-action="apply-one" data-bundle-id="' +
    escHtml(bid) +
    '" ' +
    (applying ? "disabled" : "") +
    (btnStyle ? ' style="' + btnStyle + ';width:100%;margin-top:12px"' : ' style="width:100%;margin-top:12px"') +
    ">" +
    escHtml(btnLabel) +
    "</button>" +
    "</div>";

  let sheet = "";
  sheet += '<div class="bundle-app-bottomsheet" data-role="postadd-sheet" data-bundle-id="' + escHtml(bid) + '">';
  sheet += '<div class="bundle-app-bottomsheet__panel" data-role="postadd-panel" role="dialog" aria-modal="true">';
  sheet += '<div class="bundle-app-bottomsheet__head">';
  sheet += '<div class="bundle-app-bottomsheet__title">إضافات مقترحة</div>';
  sheet +=
    '<button class="bundle-app-bottomsheet__close" type="button" data-action="close-postadd" data-bundle-id="' +
    escHtml(bid) +
    '" aria-label="إغلاق">×</button>';
  sheet += "</div>";
  sheet += '<div class="bundle-app-bottomsheet__content">' + card + "</div>";
  sheet += "</div></div>";

  return sheet;
}
`;
