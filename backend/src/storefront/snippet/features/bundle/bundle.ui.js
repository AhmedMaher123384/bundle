module.exports = [
  `
function openPickerModal(titleHtml, bodyHtml) {
  let resolver = null;
  const wait = new Promise((r) => {
    resolver = r;
  });

  const overlay = document.createElement("div");
  overlay.id = "bundle-app-modal";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,.45)";
  overlay.style.zIndex = "100000";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "16px";

  const card = document.createElement("div");
  card.style.width = "min(520px,100%)";
  card.style.maxHeight = "80vh";
  card.style.overflow = "auto";
  card.style.background = "#fff";
  card.style.borderRadius = "14px";
  card.style.boxShadow = "0 12px 40px rgba(0,0,0,.25)";
  card.style.padding = "12px";
  card.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
    '<div style="font-weight:900;font-size:14px">' +
    titleHtml +
    "</div>" +
    '<button type="button" data-action="close" style="border:0;background:transparent;font-size:18px;line-height:1;cursor:pointer">×</button>' +
    "</div>" +
    '<div style="margin-top:10px">' +
    bodyHtml +
    "</div>";

  overlay.appendChild(card);

  const close = (val) => {
    try {
      overlay.remove();
    } catch (e) {}
    if (resolver) {
      const r = resolver;
      resolver = null;
      r(val);
    }
  };

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close(null);
  });

  const closeBtn = card.querySelector('button[data-action="close"]');
  if (closeBtn) closeBtn.onclick = () => close(null);

  document.body.appendChild(overlay);
  return { overlay, card, close, wait };
}
`,
  `
async function resolveProductRefItems(items, bundleId) {
  const bid = String(bundleId || "").trim();
  const pre =
    bid && variantSelectionsByBundleId[bid] && typeof variantSelectionsByBundleId[bid] === "object"
      ? variantSelectionsByBundleId[bid]
      : null;

  const arr = Array.isArray(items) ? items : [];
  const fixed = [];
  const needs = [];

  for (const it of arr) {
    const v = String((it && it.variantId) || "").trim();
    const qty = Math.max(1, Math.floor(Number((it && it.quantity) || 1)));
    const pid = String((it && it.productId) || "").trim();
    if (isProductRef(v)) {
      if (!pid) return null;
      needs.push({ productId: pid, quantity: qty });
    } else {
      if (!v) continue;
      fixed.push({ variantId: v, productId: pid || null, quantity: qty });
    }
  }

  if (!needs.length) return fixed;

  const units = [];
  const uniqPid = {};
  for (const n of needs) {
    const pid2 = String(n.productId);
    uniqPid[pid2] = true;
    for (let u = 0; u < Number(n.quantity || 0); u += 1) {
      units.push({ productId: pid2, key: pid2 + ":" + u });
    }
  }

  const pidList = Object.keys(uniqPid);
  const varsByPid = {};
  for (const pid3 of pidList) {
    const vars = await getCachedVariants(pid3);
    let list = Array.isArray(vars) ? vars : [];
    if (!list.length) {
      list = [
        {
          variantId: "product:" + pid3,
          productId: pid3,
          cartProductId: pid3,
          cartOptions: null,
          isActive: true,
          name: null,
          attributes: {},
          imageUrl: null,
          price: null
        }
      ];
    }
    varsByPid[pid3] = list;
  }

  const selectedByKey = {};
  const pending = [];

  for (const unit of units) {
    const vlist = (varsByPid[unit.productId] || []).filter((x) => x && x.isActive === true && String(x.variantId || "").trim());
    const preVal = pre ? String(pre[unit.key] || "").trim() : "";
    if (preVal) {
      const ok = vlist.some((x) => String((x && x.variantId) || "").trim() === preVal);
      if (ok) {
        selectedByKey[unit.key] = preVal;
        continue;
      }
    }
    if (vlist.length === 1) {
      selectedByKey[unit.key] = String(vlist[0].variantId || "").trim();
    } else {
      pending.push(unit);
    }
  }

  if (pending.length) {
    let body = "";
    for (const un of pending) {
      const opts = (varsByPid[un.productId] || []).filter((y) => y && y.isActive === true && String(y.variantId || "").trim());
      if (!opts.length) continue;
      body +=
        '<div style="margin-bottom:16px">' +
        '<div style="margin-bottom:6px;font-weight:800">' +
        escHtml("اختر فاريانت للمنتج") +
        "</div>" +
        '<div style="display:flex;flex-wrap:wrap;gap:8px" data-unit-key-row="' +
        escHtml(un.key) +
        '">';

      for (const o of opts) {
        const vid = String((o && o.variantId) || "").trim();
        if (!vid) continue;
        const on = String(selectedByKey[un.key] || "").trim() === vid;
        body +=
          '<button type="button" data-action="pick-variant" data-unit-key="' +
          escHtml(un.key) +
          '" data-variant-id="' +
          escHtml(vid) +
          '" class="bundle-app-variant-btn' +
          (on ? " is-selected" : "") +
          '" aria-pressed="' +
          (on ? "true" : "false") +
          '" style="border:1px solid rgba(2,6,23,.15);background:#fff;color:#0b1220">' +
          (typeof variantOptionInnerHtml === "function" ? variantOptionInnerHtml(o) : "<span>" + escHtml(variantLabel(o)) + "</span>") +
          "</button>";
      }

      body += "</div></div>";
    }

    const modal = await openPickerModal("اختيار الفاريانتات", body);
    if (!modal) return null;

    modal.card.addEventListener("click", (e) => {
      let t = e && e.target;
      while (t && t !== modal.card) {
        if (t && t.getAttribute && t.getAttribute("data-action") === "pick-variant") break;
        t = t.parentNode;
      }
      if (!t || t === modal.card) return;
      e.preventDefault();

      const key = String(t.getAttribute("data-unit-key") || "").trim();
      const val = String(t.getAttribute("data-variant-id") || "").trim();
      if (!key || !val) return;

      selectedByKey[key] = val;
      const selMap = getBundleVariantSelectionMap(bid);
      if (selMap) selMap[key] = val;

      let row = t;
      while (row && row !== modal.card) {
        if (row && row.getAttribute && row.getAttribute("data-unit-key-row")) break;
        row = row.parentNode;
      }
      if (row && row !== modal.card) {
        const btns = row.querySelectorAll('button[data-action="pick-variant"][data-variant-id]');
        for (const b of btns) {
          const vid = String(b.getAttribute("data-variant-id") || "").trim();
          const on = Boolean(vid && vid === val);
          if (on) {
            b.classList.add("is-selected");
            b.setAttribute("aria-pressed", "true");
          } else {
            b.classList.remove("is-selected");
            b.setAttribute("aria-pressed", "false");
          }
        }
      }
    });

    await modal.wait;
  }

  const out = fixed.slice();
  for (const key2 in selectedByKey) {
    if (!Object.prototype.hasOwnProperty.call(selectedByKey, key2)) continue;
    const vid = String(selectedByKey[key2] || "").trim();
    if (!vid) continue;
    let meta = null;
    for (const pidKey in varsByPid) {
      if (!Object.prototype.hasOwnProperty.call(varsByPid, pidKey)) continue;
      const list = varsByPid[pidKey] || [];
      meta = list.find((item) => item && String(item.variantId || "").trim() === vid) || null;
      if (meta) break;
    }
    if (!meta) continue;
    out.push({ variantId: vid, productId: meta.productId, cartProductId: meta.cartProductId, cartOptions: meta.cartOptions, quantity: 1 });
  }

  return out;
}
`,
  `
function applySelectionsToContainer(container, bundleId) {
  try {
    if (!container) return;
    const bid = String(bundleId || "").trim();
    if (!bid) return;
    const sel = getBundleVariantSelectionMap(bid);
    if (!sel) return;

    const rows = container.querySelectorAll("[data-unit-key-row]");
    for (const row of rows) {
      const key = String(row.getAttribute("data-unit-key-row") || "").trim();
      if (!key) continue;
      const val = String(sel[key] || "").trim();

      const btns = row.querySelectorAll('button[data-action="pick-variant"][data-variant-id]');
      for (const b of btns) {
        const vid = String(b.getAttribute("data-variant-id") || "").trim();
        const on = Boolean(val && vid && val === vid);
        if (on) {
          b.classList.add("is-selected");
          b.setAttribute("aria-pressed", "true");
        } else {
          b.classList.remove("is-selected");
          b.setAttribute("aria-pressed", "false");
        }
      }
    }
  } catch (e) {}
}

function updatePickerStatus(container, bundleId) {
  try {
    if (!container) return;
    const bid = String(bundleId || "").trim();
    if (!bid) return;
    const sel = getBundleVariantSelectionMap(bid);
    if (!sel) return;

    const rows = container.querySelectorAll("[data-unit-key-row]");
    const total = rows.length;
    let chosen = 0;
    for (const r of rows) {
      const key = String(r.getAttribute("data-unit-key-row") || "").trim();
      if (!key) continue;
      const v = String(sel[key] || "").trim();
      if (v) chosen += 1;
    }
    const el = container.querySelector('[data-role="picker-status"]');
    if (el) el.textContent = total ? "تم اختيار " + fmtNum(chosen) + " من " + fmtNum(total) : "";
  } catch (e) {}
}

function bindPickerContainer(container, bundleId) {
  try {
    if (!container) return;
    const bid = String(bundleId || "").trim();
    if (!bid) return;

    container.onclick = (e) => {
      let t = e && e.target;
      while (t && t !== container) {
        if (t && t.getAttribute && t.getAttribute("data-action") === "pick-variant") break;
        t = t.parentNode;
      }
      if (!t || t === container) return;
      e.preventDefault();

      const key = String(t.getAttribute("data-unit-key") || "").trim();
      const val = String(t.getAttribute("data-variant-id") || "").trim();
      if (!key || !val) return;

      const sel = getBundleVariantSelectionMap(bid);
      if (!sel) return;
      sel[key] = val;
      applySelectionsToContainer(container, bid);
      updatePickerStatus(container, bid);
    };

    applySelectionsToContainer(container, bid);
    updatePickerStatus(container, bid);
  } catch (e) {}
}
`,
  `
async function ensureVariantPickersForCard(card, bundle) {
  try {
    if (!card || !bundle) return;
    ensurePickerStyles();
    const bid = String(card.getAttribute("data-bundle-id") || "").trim();
    if (!bid) return;

    const container = card.querySelector('.bundle-app-pickers[data-bundle-id]');
    if (!container) return;

    const sig = bundleVariantSig(bundle);
    const cached = variantPickerCacheByBundleId[bid];
    if (cached && cached.sig === sig && cached.html != null) {
      container.innerHTML = cached.html;
      bindPickerContainer(container, bid);
      return;
    }

    const pending = variantPickerPendingByBundleId[bid];
    if (pending && pending.sig === sig && pending.promise) return;

    container.innerHTML = '<div class="bundle-app-picker-hint">جاري تحميل الفاريانت...</div>';

    const promise = (async () => {
      const units = bundleVariantUnits(bundle);
      const sel = getBundleVariantSelectionMap(bid);
      if (!units.length) {
        variantPickerCacheByBundleId[bid] = { sig, html: "" };
        container.innerHTML = "";
        return;
      }

      pruneBundleSelections(sel, units);

      const uniq = {};
      for (const u of units) uniq[String(u.productId)] = true;
      const pids = Object.keys(uniq);
      const lists = await Promise.all(pids.map((pid) => getCachedVariants(pid)));

      const varsByPid = {};
      for (let i = 0; i < pids.length; i += 1) {
        const pid = pids[i];
        let list = Array.isArray(lists[i]) ? lists[i] : [];
        list = list.filter((x) => x && x.isActive === true && String(x.variantId || "").trim());
        if (!list.length) {
          list = [
            {
              variantId: "product:" + pid,
              productId: pid,
              cartProductId: pid,
              cartOptions: null,
              isActive: true,
              name: null,
              attributes: {},
              imageUrl: null,
              price: null
            }
          ];
        }
        varsByPid[pid] = list;
      }

      const need = [];
      for (const unit of units) {
        const list2 = varsByPid[unit.productId] || [];
        if (list2.length === 1) {
          const only = list2[0] || {};
          const vid = String(only.variantId || "").trim();
          if (vid) sel[unit.key] = vid;
        } else if (list2.length > 1) {
          need.push(unit);
        }
      }

      if (!need.length) {
        variantPickerCacheByBundleId[bid] = { sig, html: "" };
        container.innerHTML = "";
        return;
      }

      let html =
        '<div class="bundle-app-pickers-title">اختيار الفاريانت للكميات</div>' +
        '<div class="bundle-app-picker-status" data-role="picker-status"></div>';

      for (const un of need) {
        const opts = (varsByPid[un.productId] || []).filter((y) => y && y.isActive === true && String(y.variantId || "").trim());
        if (!opts.length) continue;

        html +=
          '<div class="bundle-app-picker-row">' +
          '<div class="bundle-app-picker-label">' +
          escHtml("اختر فاريانت") +
          "</div>" +
          '<div class="bundle-app-variant-options" data-unit-key-row="' +
          escHtml(un.key) +
          '">';

        for (const o of opts) {
          const vid = String((o && o.variantId) || "").trim();
          if (!vid) continue;
          const on = String(sel[un.key] || "").trim() === vid;
          html +=
            '<button type="button" class="bundle-app-variant-btn' +
            (on ? " is-selected" : "") +
            '" data-action="pick-variant" data-unit-key="' +
            escHtml(un.key) +
            '" data-variant-id="' +
            escHtml(vid) +
            '" aria-pressed="' +
            (on ? "true" : "false") +
            '">' +
            (typeof variantOptionInnerHtml === "function" ? variantOptionInnerHtml(o) : "<span>" + escHtml(variantLabel(o)) + "</span>") +
            "</button>";
        }

        html += "</div></div>";
      }

      variantPickerCacheByBundleId[bid] = { sig, html };
      container.innerHTML = html;
      bindPickerContainer(container, bid);
    })();

    variantPickerPendingByBundleId[bid] = { sig, promise };
    try {
      await promise;
    } catch (e) {}
    delete variantPickerPendingByBundleId[bid];
  } catch (e) {}
}

function renderProductBanners(bundles) {
  ensureStyles();
  ensureTraditionalStyles();

  const id = "bundle-app-banner";
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement("div");
    root.id = id;
  }
  mountBanner(root);

  const arr = Array.isArray(bundles) ? bundles : [];
  if (!arr.length) {
    clearProductBanner();
    return;
  }

  const trigger = String((arr[0] && arr[0].triggerProductId) || "");
  lastTriggerProductId = trigger || lastTriggerProductId;

  if (selectedBundleId) {
    const ok = arr.some((b) => String((b && b.id) || "") === String(selectedBundleId || ""));
    if (!ok) selectedBundleId = null;
  }

  let html = "";
  for (const b of arr) {
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

    const selectedMinQty = pickMinQty(b);
    const items = normalizeItems(b);
    const itemsText = showItems && items.length ? buildItemsText(items) : "";
    const priceText = showPrice ? buildPriceText(b) : "";
    const tiersHtml = showTiers ? buildTierRows(b, bid, selectedMinQty) : "";
    const msg = String(messageByBundleId[bid] || "");

    const checked = bid === String(selectedBundleId || "");
    const cls = "bundle-app-card" + (checked ? " bundle-app-card--selected" : "");

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

    html +=
      '<div class="' +
      cls +
      '" style="' +
      cardStyle +
      '" data-bundle-id="' +
      escHtml(bid) +
      '">' +
      '<div class="bundle-app-traditional">' +
      '<div class="bundle-app-header">' +
      '<div class="bundle-app-title-section">' +
      '<div class="bundle-app-title">' +
      escHtml(title) +
      "</div>" +
      (subtitle ? '<div class="bundle-app-subtitle">' + escHtml(subtitle) + "</div>" : "") +
      (labelSub ? '<div class="bundle-app-label-sub">' + escHtml(labelSub) + "</div>" : "") +
      "</div>" +
      (label ? '<div class="bundle-app-label" style="' + labelStyle + '">' + escHtml(label) + "</div>" : "") +
      "</div>" +
      (itemsText ? '<div class="bundle-app-items-summary">' + escHtml(itemsText) + "</div>" : "") +
      '<div class="bundle-app-products-section">';

    

    html +=
      "</div>" +
      (priceText ? '<div class="bundle-app-price">' + escHtml(priceText) + "</div>" : "") +
      (tiersHtml ? '<div class="bundle-app-tiers">' + tiersHtml + "</div>" : "") +
      (msg ? '<div class="bundle-app-msg">' + escHtml(msg) + "</div>" : "") +
      '<div class="bundle-app-footer">' +
      '<button class="bundle-app-btn" type="button" data-action="apply-one" data-bundle-id="' +
      escHtml(bid) +
      '" ' +
      (applying ? "disabled" : "") +
      (btnStyle ? ' style="' + btnStyle + '"' : "") +
      ">" +
      escHtml(btnLabel) +
      "</button>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>";
  }

  root.innerHTML = html;

  const tierEls = root.querySelectorAll(".bundle-app-tier[data-tier-minqty][data-bundle-id]");
  for (const el of tierEls) {
    el.onclick = () => {
      const bid = String(el.getAttribute("data-bundle-id") || "");
      const mq = Number(el.getAttribute("data-tier-minqty"));
      if (bid && Number.isFinite(mq) && mq >= 1) {
        selectedTierByBundleId[bid] = Math.floor(mq);
        messageByBundleId[bid] = "";
        renderProductBanners(arr);
      }
    };
  }

  const productChecks = root.querySelectorAll("input.bundle-app-product-check[data-bundle-id][data-item-index]");
  for (const el of productChecks) {
    el.onchange = () => {
      const bid = String(el.getAttribute("data-bundle-id") || "");
      const itemIndex = String(el.getAttribute("data-item-index") || "");
      if (!bid || itemIndex === "") return;

      selectedBundleId = bid;
      messageByBundleId[bid] = "";
      const bundle0 = arr.find((x) => String((x && x.id) || "") === bid) || null;
      const sel = typeof getBundleItemSelectionMap === "function" ? getBundleItemSelectionMap(bid) : null;
      if (sel && typeof sel === "object") {
        let hasAny = false;
        for (const k in sel) {
          if (Object.prototype.hasOwnProperty.call(sel, k)) {
            hasAny = true;
            break;
          }
        }

        if (!hasAny && bundle0) {
          const items0 = normalizeItems(bundle0);
          const settings0 = (bundle0 && bundle0.settings) || {};
          const req0 = Boolean(settings0 && settings0.selectionRequired === true);
          const defIds0 = Array.isArray(settings0 && settings0.defaultSelectedProductIds) ? settings0.defaultSelectedProductIds : [];
          const include0 = {};
          let includeSize0 = 0;
          for (let i0 = 0; i0 < defIds0.length; i0 += 1) {
            const s0 = String(defIds0[i0] || "").trim();
            if (!s0) continue;
            if (!include0[s0]) includeSize0 += 1;
            include0[s0] = true;
          }

          for (let j0 = 0; j0 < items0.length; j0 += 1) {
            const it0 = items0[j0] || {};
            if (it0.isBase === true) continue;
            let pid0 = String(it0.productId || "").trim();
            const vid0 = String(it0.variantId || "").trim();
            if (!pid0 && vid0 && vid0.indexOf("product:") === 0) pid0 = String(vid0).slice("product:".length).trim();
            const on0 = includeSize0 ? include0[pid0] === true : !req0;
            sel[String(j0)] = on0 === true;
          }
        }

        sel[itemIndex] = el.checked === true;
      }

      if (el.checked) {
        const otherChecks = root.querySelectorAll(
          'input.bundle-app-product-check[data-bundle-id]:not([data-bundle-id="' + bid + '"]):not([disabled])'
        );
        const otherBundleIds = {};
        for (const o of otherChecks) {
          const obid = String(o.getAttribute("data-bundle-id") || "").trim();
          if (obid) otherBundleIds[obid] = true;
          o.checked = false;
        }
        for (const ob in otherBundleIds) {
          if (!Object.prototype.hasOwnProperty.call(otherBundleIds, ob)) continue;
          if (typeof clearBundleItemSelection === "function") clearBundleItemSelection(ob);
        }
      } else {
        const bundleChecks = root.querySelectorAll(
          'input.bundle-app-product-check[data-bundle-id="' + bid + '"]:not([disabled])'
        );
        let anyChecked = false;
        for (const b of bundleChecks) {
          if (b.checked) {
            anyChecked = true;
            break;
          }
        }
        if (!anyChecked && String(selectedBundleId || "") === bid) selectedBundleId = null;
      }

      renderProductBanners(arr);
    };
  }

  const productItems = root.querySelectorAll(".bundle-app-product-item[data-item-index]");
  for (const itemEl of productItems) {
    itemEl.onclick = (e) => {
      let t = e && e.target;
      while (t && t !== itemEl) {
        if (t && t.classList && t.classList.contains("bundle-app-product-checkwrap")) return;
        if (t && t.classList && t.classList.contains("bundle-app-product-variants")) return;
        if (t && t.getAttribute && t.getAttribute("data-action") === "pick-variant") return;
        t = t.parentNode;
      }

      const cb = itemEl.querySelector("input.bundle-app-product-check[data-bundle-id][data-item-index]");
      if (!cb) return;
      const bid = String(cb.getAttribute("data-bundle-id") || "").trim();
      if (bid) {
        selectedBundleId = bid;
        messageByBundleId[bid] = "";
      }
      if (cb.disabled) {
        if (bid) renderProductBanners(arr);
        return;
      }
      if (cb.checked) {
        if (bid) renderProductBanners(arr);
        return;
      }
      cb.checked = true;
      if (typeof cb.onchange === "function") cb.onchange();
    };
  }

  const btns = root.querySelectorAll('button.bundle-app-btn[data-action="apply-one"][data-bundle-id]');
  for (const btn of btns) {
    btn.onclick = () => {
      const bid = String(btn.getAttribute("data-bundle-id") || "");
      if (!bid || applying) return;

      const bundleChecks = root.querySelectorAll(
        'input.bundle-app-product-check[data-bundle-id="' + bid + '"]:not([disabled])'
      );
      let anyChecked = false;
      for (const b of bundleChecks) {
        if (b.checked) {
          anyChecked = true;
          break;
        }
      }
      if (!anyChecked) {
        const bundle0 = arr.find((x) => String((x && x.id) || "") === bid) || null;
        if (!bundle0) return;

        const items0 = normalizeItems(bundle0);
        const settings0 = (bundle0 && bundle0.settings) || {};
        const req0 = Boolean(settings0 && settings0.selectionRequired === true);
        const defIds0 = Array.isArray(settings0 && settings0.defaultSelectedProductIds) ? settings0.defaultSelectedProductIds : [];
        const include0 = {};
        let includeSize0 = 0;
        for (let i0 = 0; i0 < defIds0.length; i0 += 1) {
          const s0 = String(defIds0[i0] || "").trim();
          if (!s0) continue;
          if (!include0[s0]) includeSize0 += 1;
          include0[s0] = true;
        }

        const sel0 = typeof getBundleItemSelectionMap === "function" ? getBundleItemSelectionMap(bid) : null;
        let selectedCount0 = 0;
        if (sel0 && typeof sel0 === "object") {
          for (let j0 = 0; j0 < items0.length; j0 += 1) {
            const it0 = items0[j0] || {};
            if (it0.isBase === true) continue;
            let pid0 = String(it0.productId || "").trim();
            const vid0 = String(it0.variantId || "").trim();
            if (!pid0 && vid0 && vid0.indexOf("product:") === 0) pid0 = String(vid0).slice("product:".length).trim();

            const on0 = includeSize0 ? include0[pid0] === true : req0 ? false : true;
            sel0[String(j0)] = on0 === true;
            if (on0 === true) selectedCount0 += 1;
          }
        }

        if (req0 && selectedCount0 <= 0) {
          messageByBundleId[bid] = "يرجى اختيار منتج واحد على الأقل من الباقة";
          renderProductBanners(arr);
          return;
        }

        selectedBundleId = bid;
        messageByBundleId[bid] = "";
        renderProductBanners(arr);
        applyBundleSelection(bundle0);
        return;
      }

      selectedBundleId = bid;
      const bundle = arr.find((x) => String((x && x.id) || "") === bid) || null;
      if (!bundle) return;
      applyBundleSelection(bundle);
    };
  }

  if (selectedBundleId) {
    const selCard = Array.from(root.querySelectorAll(".bundle-app-card[data-bundle-id]")).find(
      (c) => String(c.getAttribute("data-bundle-id") || "") === String(selectedBundleId || "")
    );
    const selBundle = arr.find((x) => String((x && x.id) || "") === String(selectedBundleId || "")) || null;
    if (selCard && selBundle) ensureVariantPickersForTraditionalCard(selCard, selBundle);
  }
}

async function ensureVariantPickersForTraditionalCard(card, bundle) {
  try {
    if (!card || !bundle) return;
    ensurePickerStyles();
    const bid = String(card.getAttribute("data-bundle-id") || "").trim();
    if (!bid) return;

    const variantContainers = card.querySelectorAll(".bundle-app-product-variants[data-bundle-id][data-item-index]");
    const items = normalizeItems(bundle);
    const sel = getBundleVariantSelectionMap(bid);
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

    const settings = (bundle && bundle.settings) || {};
    const req = Boolean(settings && settings.selectionRequired === true);
    const pickerVisible = settings && settings.variantPickerVisible !== false;
    const defIds = Array.isArray(settings && settings.defaultSelectedProductIds) ? settings.defaultSelectedProductIds : [];
    const include = {};
    let includeSize = 0;
    for (let i0 = 0; i0 < defIds.length; i0 += 1) {
      const s0 = String(defIds[i0] || "").trim();
      if (!s0) continue;
      if (!include[s0]) includeSize += 1;
      include[s0] = true;
    }

    const selectedByItemIndex = {};
    const units = [];
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i] || {};
      const v = String(it.variantId || "").trim();
      const isBase = Boolean(it.isBase);
      let pid = String(it.productId || "").trim();
      if (!pid && v && v.indexOf("product:") === 0) pid = String(v).slice("product:".length).trim();
      const on = isBase ? true : hasItemSel ? itemSel && itemSel[String(i)] === true : includeSize ? include[pid] === true : !req;
      selectedByItemIndex[String(i)] = on === true;
      if (!on) continue;
      if (!pid) continue;
      if (!pickerVisible) continue;
      const qty = Math.max(1, Math.floor(Number(it.quantity || 1)));
      const defVid = v && !isProductRef(v) ? v : "";
      for (let u = 0; u < qty; u += 1) {
        units.push({ productId: pid, key: pid + ":" + u, itemIndex: i, defaultVariantId: defVid });
      }
    }

    if (!units.length) {
      for (const c of variantContainers) c.innerHTML = "";
      return;
    }

    pruneBundleSelections(sel, units);

    const uniq = {};
    for (const u of units) uniq[String(u.productId)] = true;
    const pids = Object.keys(uniq);
    const lists = await Promise.all(pids.map((pid) => getCachedVariants(pid)));
    const varsByPid = {};
    for (let i = 0; i < pids.length; i += 1) {
      const pid = pids[i];
      let list = Array.isArray(lists[i]) ? lists[i] : [];
      list = list.filter((x) => x && x.isActive === true && String(x.variantId || "").trim());
      varsByPid[pid] = list;
    }

    for (const u of units) {
      const list0 = varsByPid[u.productId] || [];
      if (!sel) continue;
      const cur = String(sel[u.key] || "").trim();
      if (cur) continue;
      const defVid = String(u.defaultVariantId || "").trim();
      if (defVid) {
        const ok = list0.some((x) => String((x && x.variantId) || "").trim() === defVid);
        if (ok) {
          sel[u.key] = defVid;
          continue;
        }
      }
      if (list0.length === 1) {
        const only = list0[0] || {};
        const vid0 = String(only.variantId || "").trim();
        if (vid0) sel[u.key] = vid0;
      }
    }

    const unitsByItem = {};
    for (const u of units) {
      const idx = String(u.itemIndex);
      if (!unitsByItem[idx]) unitsByItem[idx] = [];
      unitsByItem[idx].push(u);
    }

    for (const container of variantContainers) {
      const itemIndex = String(container.getAttribute("data-item-index") || "");
      if (itemIndex !== "" && selectedByItemIndex[itemIndex] !== true) {
        container.innerHTML = "";
        continue;
      }
      const itemUnits = unitsByItem[itemIndex] || [];
      if (!itemUnits.length) {
        container.innerHTML = "";
        continue;
      }

      let html = '<div class="bundle-app-pickers-title">اختيار الفاريانت</div>';
      for (const unit of itemUnits) {
        const pid = unit.productId;
        const key = unit.key;
        const variants = varsByPid[pid] || [];
        if (!variants.length) continue;
        const selectedVariantId = String((sel && sel[key]) || "").trim();

        html +=
          '<div class="bundle-app-picker-row" data-unit-key-row="' +
          escHtml(key) +
          '">' +
          '<div class="bundle-app-variant-options">';

        for (const v of variants) {
          const variantId = String((v && v.variantId) || "").trim();
          if (!variantId) continue;
          const isSelected = selectedVariantId === variantId;
          html +=
            '<button type="button" class="bundle-app-variant-btn' +
            (isSelected ? " is-selected" : "") +
            '" aria-pressed="' +
            (isSelected ? "true" : "false") +
            '" data-action="pick-variant" data-unit-key="' +
            escHtml(key) +
            '" data-variant-id="' +
            escHtml(variantId) +
            '">' +
            (typeof variantOptionInnerHtml === "function" ? variantOptionInnerHtml(v) : "<span>" + escHtml(variantLabel(v)) + "</span>") +
            "</button>";
        }

        html += "</div></div>";
      }

      container.innerHTML = html;
      bindPickerContainer(container, bid);
    }
  } catch (e) {}
}

function clearProductBanner() {
  const root = document.getElementById("bundle-app-banner");
  if (root) root.remove();
}

function mountBanner(root) {
  try {
    if (!root) return;
    if (root.getAttribute && root.getAttribute("data-mounted") === "1") return;

    let container = document.querySelector('.bundle-app-container[data-feature-location="product"]');
    if (!container) {
      container = document.createElement("div");
      container.className = "bundle-app-container";
      container.setAttribute("data-feature-location", "product");

      const anchors = [
        "form[action*='cart']",
        "form[action*='checkout']",
        ".product-form",
        "[data-product-form]",
        "[data-add-to-cart]",
        "button[type='submit'][name='add-to-cart']",
        "button[type='submit']"
      ];
      let host = null;
      for (const sel of anchors) {
        const el = document.querySelector(sel);
        if (el) {
          host = el;
          break;
        }
      }

      if (host && host.parentNode) host.parentNode.insertBefore(container, host);
      else (document.body || document.documentElement).appendChild(container);
    }

    if (root.parentNode !== container) container.appendChild(root);
    container.style.display = "block";
    root.setAttribute("data-mounted", "1");
  } catch (e) {}
}

function findVariantId() {
  try {
    const p =
      window.salla && window.salla.config && window.salla.config.product ? window.salla.config.product : null;
    let v = p && (p.variantId || p.variant_id || p.selectedVariantId || p.selected_variant_id || p.currentVariantId);
    v = String(v || "").trim();
    if (v) return v;

    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("variant_id") || url.searchParams.get("variantId") || url.searchParams.get("variant") || "";
    if (fromUrl) return String(fromUrl).trim();

    const el = document.querySelector('[name="variant_id"],[name="variantId"],[data-variant-id],input[name="variant_id"],select[name="variant_id"]');
    if (el) {
      let vv = (el.getAttribute && el.getAttribute("data-variant-id")) || el.value || "";
      vv = String(vv).trim();
      if (vv) return vv;
    }

    const any = document.querySelector("[data-variant-id]");
    if (any) {
      const a = String(any.getAttribute("data-variant-id") || "").trim();
      if (a) return a;
    }
    return "";
  } catch (e) {
    return "";
  }
}

function findProductId() {
  try {
    const p =
      window.salla && window.salla.config && window.salla.config.product ? window.salla.config.product : null;
    let pid = p && (p.id || p.productId || p.product_id);
    pid = String(pid || "").trim();
    if (pid) return pid;

    const path = String(window.location.pathname || "");
    const m =
      path.match(/\\/p(\\d+)(?:[/?#]|$)/) ||
      path.match(/\\/(?:products?|product)\\/(\\d+)(?:[/?#]|$)/) ||
      path.match(/\\/(?:products?|product)\\/[^/?#]*?(\\d+)(?:[/?#]|$)/);
    if (m && m[1]) return String(m[1]);

    const el = document.querySelector('[data-product-id],input[name="product_id"],input[name="productId"]');
    if (el) {
      let v = (el.getAttribute && el.getAttribute("data-product-id")) || el.value || "";
      v = String(v).trim();
      if (v) return v;
    }

    return "";
  } catch (e) {
    return "";
  }
}
`,
  `
try {
  initAuto();
} catch (e) {}
`
];
