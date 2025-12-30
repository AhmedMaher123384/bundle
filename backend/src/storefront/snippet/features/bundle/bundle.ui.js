const kindQuantityDiscountUi = require("./kinds/quantity_discount.ui");
const kindProductsDiscountUi = require("./kinds/products_discount.ui");
const kindProductsNoDiscountUi = require("./kinds/products_no_discount.ui");
const kindPostAddUpsellUi = require("./kinds/post_add_upsell.ui");

module.exports = [
  kindQuantityDiscountUi,
  kindProductsDiscountUi,
  kindProductsNoDiscountUi,
  kindPostAddUpsellUi,
  `
async function resolveProductRefItems(items, bundleId) {
  const bid = String(bundleId || "").trim();
  const pre =
    bid && variantSelectionsByBundleId[bid] && typeof variantSelectionsByBundleId[bid] === "object"
      ? variantSelectionsByBundleId[bid]
      : null;
  const mqRaw = bid && selectedTierByBundleId && selectedTierByBundleId[bid] != null ? Number(selectedTierByBundleId[bid]) : 1;
  const mq = Number.isFinite(mqRaw) && mqRaw >= 1 ? Math.floor(mqRaw) : 1;

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
  const lists = await Promise.all(pidList.map((pid3) => getCachedVariants(pid3)));
  for (let i = 0; i < pidList.length; i += 1) {
    const pid3 = pidList[i];
    const vars = lists[i];
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

  for (const unit of units) {
    const vlist = (varsByPid[unit.productId] || []).filter((x) => x && x.isActive === true && String(x.variantId || "").trim());
    const tierK = String(mq) + "|" + String(unit.key);
    const preVal = pre ? String(pre[tierK] || pre[unit.key] || "").trim() : "";
    if (preVal) {
      const ok = vlist.some((x) => String((x && x.variantId) || "").trim() === preVal);
      if (ok) {
        selectedByKey[unit.key] = preVal;
        continue;
      }
    }
    if (vlist.length) {
      selectedByKey[unit.key] = String((vlist[0] && vlist[0].variantId) || "").trim() || ("product:" + String(unit.productId));
    } else {
      selectedByKey[unit.key] = "product:" + String(unit.productId);
    }
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
      let val = String(sel[key] || "").trim();
      if (!val) {
        const bar = key.indexOf("|");
        if (bar > 0) val = String(sel[key.slice(bar + 1)] || "").trim();
      }

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
      let v = String(sel[key] || "").trim();
      if (!v) {
        const bar = key.indexOf("|");
        if (bar > 0) v = String(sel[key.slice(bar + 1)] || "").trim();
      }
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

    const mq = pickMinQty(bundle);
    const sig = bundleVariantSig(bundle) + "|mq:" + String(mq);
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
          if (vid && !readTierSelection(sel, mq, unit.key)) {
            const sk0 = tierKey(mq, unit.key);
            if (sk0) sel[sk0] = vid;
          }
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
        const sk = tierKey(mq, un.key);
        if (!sk) continue;

        html +=
          '<div class="bundle-app-picker-row">' +
          '<div class="bundle-app-picker-label">' +
          escHtml("اختر فاريانت") +
          "</div>" +
          '<div class="bundle-app-variant-options" data-unit-key-row="' +
          escHtml(sk) +
          '">';

        for (const o of opts) {
          const vid = String((o && o.variantId) || "").trim();
          if (!vid) continue;
          const on = readTierSelection(sel, mq, un.key) === vid;
          html +=
            '<button type="button" class="bundle-app-variant-btn' +
            (on ? " is-selected" : "") +
            '" data-action="pick-variant" data-unit-key="' +
            escHtml(sk) +
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
    const kind = String((b && b.kind) || "").trim();
    if (kind === "products_discount") html += renderBundleCard_products_discount(b);
    else if (kind === "products_no_discount") html += renderBundleCard_products_no_discount(b);
    else if (kind === "post_add_upsell") html += renderBundleCard_post_add_upsell(b);
    else html += renderBundleCard_quantity_discount(b);
  }

  root.innerHTML = html;

  try {
    const cards = root.querySelectorAll(".bundle-app-card[data-bundle-id]");
    const cardById = {};
    for (const c of cards) {
      const bid = String(c.getAttribute("data-bundle-id") || "").trim();
      if (bid) cardById[bid] = c;
    }

    function initPickersForBundle(bundle) {
      try {
        const bid = String((bundle && bundle.id) || "").trim();
        if (!bid) return;
        const card = cardById[bid];
        if (!card) return;
        const kind = String((bundle && bundle.kind) || "").trim();
        const showTiers = !(bundle && bundle.showTiers === false);
        const hasTiers = kind === "quantity_discount" && showTiers && bundle && bundle.offer && Array.isArray(bundle.offer.tiers) && bundle.offer.tiers.length;
        if (hasTiers) ensureVariantPickersForTierCard(card, bundle);
        else ensureVariantPickersForTraditionalCard(card, bundle);
      } catch (e) {}
    }

    const selectedNow = String(selectedBundleId || "").trim();
    if (selectedNow) {
      const selBundle = arr.find((x) => String((x && x.id) || "") === selectedNow) || null;
      if (selBundle) initPickersForBundle(selBundle);
    }

    let idx = 0;
    (function pump() {
      try {
        if (idx >= arr.length) return;
        const b = arr[idx];
        idx += 1;
        initPickersForBundle(b);
      } catch (e) {}
      setTimeout(pump, 0);
    })();
  } catch (e) {}

  const tierEls = root.querySelectorAll(".bundle-app-tier[data-tier-minqty][data-bundle-id]");
  for (const el of tierEls) {
    el.onclick = () => {
      const bid = String(el.getAttribute("data-bundle-id") || "");
      const mq = Number(el.getAttribute("data-tier-minqty"));
      if (bid && Number.isFinite(mq) && mq >= 1) {
        selectedBundleId = bid;
        selectedTierByBundleId[bid] = Math.floor(mq);
        messageByBundleId[bid] = "";
        renderProductBanners(arr);
      }
    };
  }

  const tierChecks = root.querySelectorAll("input.bundle-app-tier-check[data-tier-minqty][data-bundle-id]");
  for (const el of tierChecks) {
    el.onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
    };
    el.onchange = () => {
      const bid = String(el.getAttribute("data-bundle-id") || "");
      const mq = Number(el.getAttribute("data-tier-minqty"));
      if (bid && Number.isFinite(mq) && mq >= 1) {
        selectedBundleId = bid;
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
    const mq = pickMinQty(bundle);
    let baseQty = Math.max(1, Math.floor(Number(getPageQty() || 1)));
    if (Number.isFinite(mq) && mq > baseQty) baseQty = mq;
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
      const qty = isBase ? baseQty : Math.max(1, Math.floor(Number(it.quantity || 1)));
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

    for (const u of units) {
      const list0 = varsByPid[u.productId] || [];
      if (!sel) continue;
      const cur = readTierSelection(sel, mq, u.key);
      if (cur) continue;
      const defVid = String(u.defaultVariantId || "").trim();
      if (defVid) {
        const ok = list0.some((x) => String((x && x.variantId) || "").trim() === defVid);
        if (ok) {
          const sk0 = tierKey(mq, u.key);
          if (sk0) sel[sk0] = defVid;
          continue;
        }
      }
      if (list0.length === 1) {
        const only = list0[0] || {};
        const vid0 = String(only.variantId || "").trim();
        if (vid0) {
          const sk1 = tierKey(mq, u.key);
          if (sk1) sel[sk1] = vid0;
        }
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

      const needUnits = [];
      for (const unit of itemUnits) {
        const variants = varsByPid[unit.productId] || [];
        if (variants.length > 1) needUnits.push(unit);
      }
      if (!needUnits.length) {
        container.innerHTML = "";
        continue;
      }

      let html = '<div class="bundle-app-pickers-title">اختيار الفاريانت</div>';
      for (const unit of needUnits) {
        const pid = unit.productId;
        const key = unit.key;
        const variants = varsByPid[pid] || [];
        if (variants.length <= 1) continue;
        const selectedVariantId = readTierSelection(sel, mq, key);
        const sk = tierKey(mq, key);
        if (!sk) continue;

        html +=
          '<div class="bundle-app-picker-row" data-unit-key-row="' +
          escHtml(sk) +
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
            escHtml(sk) +
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

async function ensureVariantPickersForTierCard(card, bundle) {
  try {
    if (!card || !bundle) return;
    ensurePickerStyles();
    const bid = String(card.getAttribute("data-bundle-id") || "").trim();
    if (!bid) return;

    const tierContainers = card.querySelectorAll('.bundle-app-tier-pickers[data-bundle-id][data-tier-minqty]');
    const open = card.querySelector('.bundle-app-tier-pickers.is-open[data-bundle-id][data-tier-minqty]');
    for (const c of tierContainers) {
      if (c !== open) c.innerHTML = "";
    }

    const variantContainers = card.querySelectorAll(".bundle-app-product-variants[data-bundle-id][data-item-index]");
    for (const c of variantContainers) c.innerHTML = "";

    if (!open) return;

    const mqFromDom = Number(open.getAttribute("data-tier-minqty"));
    const mq = Number.isFinite(mqFromDom) && mqFromDom >= 1 ? Math.floor(mqFromDom) : Math.max(1, Math.floor(Number(pickMinQty(bundle) || 1)));
    let baseQty = Math.max(1, Math.floor(Number(getPageQty() || 1)));
    if (Number.isFinite(mq) && mq > baseQty) baseQty = mq;

    const settings = (bundle && bundle.settings) || {};
    const req = Boolean(settings && settings.selectionRequired === true);
    const pickerVisible = settings && settings.variantPickerVisible !== false;
    if (!pickerVisible) {
      open.innerHTML = "";
      return;
    }

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

    const defIds = Array.isArray(settings && settings.defaultSelectedProductIds) ? settings.defaultSelectedProductIds : [];
    const include = {};
    let includeSize = 0;
    for (let i0 = 0; i0 < defIds.length; i0 += 1) {
      const s0 = String(defIds[i0] || "").trim();
      if (!s0) continue;
      if (!include[s0]) includeSize += 1;
      include[s0] = true;
    }

    const units = [];
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i] || {};
      const v = String(it.variantId || "").trim();
      const isBase = Boolean(it.isBase);
      let pid = String(it.productId || "").trim();
      if (!pid && v && v.indexOf("product:") === 0) pid = String(v).slice("product:".length).trim();
      const on = isBase ? true : hasItemSel ? itemSel && itemSel[String(i)] === true : includeSize ? include[pid] === true : !req;
      if (!on) continue;
      if (!pid) continue;
      const qty = isBase ? baseQty : Math.max(1, Math.floor(Number(it.quantity || 1)));
      const defVid = v && !isProductRef(v) ? v : "";
      for (let u = 0; u < qty; u += 1) {
        units.push({ productId: pid, key: pid + ":" + u, defaultVariantId: defVid });
      }
    }

    if (!units.length) {
      open.innerHTML = "";
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

    for (const u of units) {
      const list0 = varsByPid[u.productId] || [];
      if (!sel) continue;
      const cur = readTierSelection(sel, mq, u.key);
      if (cur) continue;
      const defVid = String(u.defaultVariantId || "").trim();
      if (defVid) {
        const ok = list0.some((x) => String((x && x.variantId) || "").trim() === defVid);
        if (ok) {
          const sk0 = tierKey(mq, u.key);
          if (sk0) sel[sk0] = defVid;
          continue;
        }
      }
      if (list0.length === 1) {
        const only = list0[0] || {};
        const vid0 = String(only.variantId || "").trim();
        if (vid0) {
          const sk1 = tierKey(mq, u.key);
          if (sk1) sel[sk1] = vid0;
        }
      }
    }

    let html =
      '<div class="bundle-app-pickers bundle-app-pickers--inline" data-bundle-id="' +
      escHtml(bid) +
      '">' +
      '<div class="bundle-app-pickers-title">اختيار الفاريانت</div>' +
      '<div class="bundle-app-picker-status" data-role="picker-status"></div>';

    const needUnits = [];
    for (const unit of units) {
      const variants0 = varsByPid[unit.productId] || [];
      if (variants0.length > 1) needUnits.push(unit);
    }
    if (!needUnits.length) {
      open.innerHTML = "";
      return;
    }

    for (const unit of needUnits) {
      const pid = unit.productId;
      const key = unit.key;
      const variants = varsByPid[pid] || [];
      if (variants.length <= 1) continue;
      const selectedVariantId = readTierSelection(sel, mq, key);
      const sk = tierKey(mq, key);
      if (!sk) continue;

      html +=
        '<div class="bundle-app-picker-row" data-unit-key-row="' +
        escHtml(sk) +
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
          escHtml(sk) +
          '" data-variant-id="' +
          escHtml(variantId) +
          '">' +
          (typeof variantOptionInnerHtml === "function" ? variantOptionInnerHtml(v) : "<span>" + escHtml(variantLabel(v)) + "</span>") +
          "</button>";
      }

      html += "</div></div>";
    }

    html += "</div>";
    open.innerHTML = html;
    const pickerBox = open.querySelector('.bundle-app-pickers[data-bundle-id="' + bid + '"]');
    if (pickerBox) {
      bindPickerContainer(pickerBox, bid);
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
