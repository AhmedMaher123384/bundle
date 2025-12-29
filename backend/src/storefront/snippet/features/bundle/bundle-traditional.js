// Traditional Bundle UI Functions

function ensureTraditionalStyles() {
  if (document.getElementById('bundle-traditional-styles')) return;
  
  var link = document.createElement('link');
  link.id = 'bundle-traditional-styles';
  link.rel = 'stylesheet';
  link.href = '/api/storefront/snippet/features/bundle/bundle-traditional.css';
  document.head.appendChild(link);
}

function renderTraditionalBundleCard(bundle, bid, cardStyle, labelStyle, btnStyle, items, tiersHtml, priceText, msg, btnLabel, checked) {
  var html = '<div class="bundle-app-traditional">';
  
  // Header with title and label
  html += '<div class="bundle-app-header">';
  html += '<div class="bundle-app-title-section">';
  html += '<div class="bundle-app-title">' + escHtml(normalizeTitle(bundle.title)) + '</div>';
  if (bundle.subtitle) {
    html += '<div class="bundle-app-subtitle">' + escHtml(bundle.subtitle) + '</div>';
  }
  if (bundle.labelSub) {
    html += '<div class="bundle-app-label-sub">' + escHtml(bundle.labelSub) + '</div>';
  }
  html += '</div>';
  if (bundle.label) {
    html += '<div class="bundle-app-label" style="' + labelStyle + '">' + escHtml(bundle.label) + '</div>';
  }
  html += '</div>';
  
  // Items summary
  if (items && items.length) {
    var itemsText = buildItemsText(items);
    if (itemsText) {
      html += '<div class="bundle-app-items-summary">' + escHtml(itemsText) + '</div>';
    }
  }
  
  // Products section with individual items and checkboxes
  html += '<div class="bundle-app-products-section">';
  if (items && items.length) {
    for (var j = 0; j < items.length; j++) {
      var item = items[j] || {};
      var itemChecked = checked; // Use bundle selection state
      
      html += '<div class="bundle-app-product-item" data-item-index="' + j + '">';
      html += '<div class="bundle-app-product-header">';
      
      // Individual product checkbox (per-item selection)
      html += '<label class="bundle-app-product-checkwrap">';
      html += '<input class="bundle-app-product-check" type="checkbox" ';
      html += 'data-bundle-id="' + escHtml(bid) + '" ';
      html += 'data-item-index="' + j + '" ';
      html += (itemChecked ? 'checked' : '') + ' />';
      html += '<span class="bundle-app-checkmark"></span>';
      html += '</label>';
      
      // Product info
      html += '<div class="bundle-app-product-info">';
      html += '<div class="bundle-app-product-name">منتج ' + (j + 1) + '</div>';
      html += '<div class="bundle-app-product-qty">الكمية: ' + fmtNum(item.quantity || 1) + '</div>';
      html += '</div>';
      html += '</div>';
      
      // Variant picker container (under each product)
      html += '<div class="bundle-app-product-variants" ';
      html += 'data-bundle-id="' + escHtml(bid) + '" ';
      html += 'data-item-index="' + j + '">';
      html += '</div>';
      
      html += '</div>';
    }
  }
  html += '</div>';
  
  // Price display
  if (priceText) {
    html += '<div class="bundle-app-price">' + escHtml(priceText) + '</div>';
  }
  
  // Tiers
  if (tiersHtml) {
    html += '<div class="bundle-app-tiers">' + tiersHtml + '</div>';
  }
  
  // Message
  if (msg) {
    html += '<div class="bundle-app-msg">' + escHtml(msg) + '</div>';
  }
  
  // Footer with add button at the bottom
  html += '<div class="bundle-app-footer">';
  html += '<button class="bundle-app-btn" type="button" ';
  html += 'data-action="apply-one" ';
  html += 'data-bundle-id="' + escHtml(bid) + '" ';
  html += (applying ? 'disabled' : '') + ' ';
  if (btnStyle) {
    html += 'style="' + btnStyle + '" ';
  }
  html += '>' + escHtml(btnLabel) + '</button>';
  html += '</div>';
  
  html += '</div>';
  
  return html;
}

function bindTraditionalEvents(root, arr) {
  // Bind per-product checkbox events
  var productChecks = root.querySelectorAll('input.bundle-app-product-check[data-bundle-id][data-item-index]');
  for (var c = 0; c < productChecks.length; c++) {
    (function(el) {
      el.onchange = function() {
        var bid = String(el.getAttribute('data-bundle-id') || "");
        var itemIndex = String(el.getAttribute('data-item-index') || "");
        
        if (!bid || itemIndex === "") return;
        
        // When a product is checked, select the bundle and uncheck other bundles
        if (el.checked) {
          selectedBundleId = bid;
          messageByBundleId[bid] = '';
          
          // Uncheck other bundles
          var otherChecks = root.querySelectorAll('input.bundle-app-product-check[data-bundle-id]:not([data-bundle-id="' + bid + '"])');
          for (var o = 0; o < otherChecks.length; o++) {
            otherChecks[o].checked = false;
          }
        } else {
          // If unchecking the last item in a bundle, deselect the bundle
          var bundleChecks = root.querySelectorAll('input.bundle-app-product-check[data-bundle-id="' + bid + '"]');
          var anyChecked = false;
          for (var b = 0; b < bundleChecks.length; b++) {
            if (bundleChecks[b].checked) {
              anyChecked = true;
              break;
            }
          }
          if (!anyChecked && String(selectedBundleId || "") === bid) {
            selectedBundleId = null;
          }
        }
        
        renderProductBanners(arr);
      };
    })(productChecks[c]);
  }
  
  // Bind add button events
  var btns = root.querySelectorAll('button.bundle-app-btn[data-action="apply-one"][data-bundle-id]');
  for (var k = 0; k < btns.length; k++) {
    (function(btn) {
      btn.onclick = function() {
        var bid = String(btn.getAttribute('data-bundle-id') || "");
        if (!bid || applying) return;
        
        // Check if any product in this bundle is selected
        var bundleChecks = root.querySelectorAll('input.bundle-app-product-check[data-bundle-id="' + bid + '"]');
        var anyChecked = false;
        for (var b = 0; b < bundleChecks.length; b++) {
          if (bundleChecks[b].checked) {
            anyChecked = true;
            break;
          }
        }
        
        if (!anyChecked) {
          messageByBundleId[bid] = 'يرجى اختيار منتج واحد على الأقل من الباقة';
          renderProductBanners(arr);
          return;
        }
        
        selectedBundleId = bid;
        var bundle = null;
        for (var i = 0; i < arr.length; i++) {
          if (String(arr[i] && arr[i].id || "") === bid) {
            bundle = arr[i];
            break;
          }
        }
        if (!bundle) return;
        applyBundleSelection(bundle);
      };
    })(btns[k]);
  }
}

function ensureVariantPickersForTraditionalCard(card, bundle) {
  try {
    if (!card || !bundle) return;
    ensurePickerStyles();
    var bid = String(card.getAttribute('data-bundle-id') || "").trim();
    if (!bid) return;
    
    // Find all product variant containers
    var variantContainers = card.querySelectorAll('.bundle-app-product-variants[data-bundle-id][data-item-index]');
    
    var units = bundleVariantUnits(bundle);
    var sel = getBundleVariantSelectionMap(bid);
    if (!units.length) return;
    
    pruneBundleSelections(sel, units);
    
    // Group units by item index
    var unitsByItem = {};
    for (var i = 0; i < units.length; i++) {
      var unit = units[i];
      var itemIndex = Math.floor(i); // Simple mapping, adjust as needed
      if (!unitsByItem[itemIndex]) unitsByItem[itemIndex] = [];
      unitsByItem[itemIndex].push(unit);
    }
    
    // Process each variant container
    for (var j = 0; j < variantContainers.length; j++) {
      var container = variantContainers[j];
      var itemIndex = String(container.getAttribute('data-item-index') || "");
      var itemUnits = unitsByItem[itemIndex] || [];
      
      if (!itemUnits.length) {
        container.innerHTML = '';
        continue;
      }
      
      // Build variant picker for this specific item
      var itemHtml = '<div class="bundle-app-pickers-title">اختيار الفاريانت</div>';
      
      for (var k = 0; k < itemUnits.length; k++) {
        var unit = itemUnits[k];
        var productId = unit.productId;
        var unitKey = unit.key;
        
        // Get variants for this product
        getCachedVariants(productId).then(function(variants) {
          if (!variants || !variants.length) return;
          
          var selectedVariantId = sel[unitKey] || '';
          var variantHtml = '<div class="bundle-app-variant-row" data-unit-key-row="' + escHtml(unitKey) + '">';
          
          for (var v = 0; v < variants.length; v++) {
            var variant = variants[v];
            if (!variant || !variant.isActive) continue;
            
            var variantId = String(variant.variantId || "").trim();
            var isSelected = selectedVariantId === variantId;
            
            variantHtml += '<button type="button" ';
            variantHtml += 'data-action="pick-variant" ';
            variantHtml += 'data-unit-key="' + escHtml(unitKey) + '" ';
            variantHtml += 'data-variant-id="' + escHtml(variantId) + '" ';
            variantHtml += 'class="bundle-app-variant-btn' + (isSelected ? ' is-selected' : '') + '" ';
            variantHtml += 'aria-pressed="' + (isSelected ? 'true' : 'false') + '">';
            
            if (variant.imageUrl) {
              variantHtml += '<img src="' + escHtml(variant.imageUrl) + '" alt="" style="width:32px;height:32px;border-radius:4px;margin-left:8px;">';
            }
            
            variantHtml += '<span>' + escHtml(variantLabel(variant)) + '</span>';
            variantHtml += '</button>';
          }
          
          variantHtml += '</div>';
          container.innerHTML = variantHtml;
          
          // Bind events for this container
          bindPickerContainer(container, bid);
        });
      }
    }
    
  } catch (e) {
    console.error('Error in ensureVariantPickersForTraditionalCard:', e);
  }
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ensureTraditionalStyles: ensureTraditionalStyles,
    renderTraditionalBundleCard: renderTraditionalBundleCard,
    bindTraditionalEvents: bindTraditionalEvents,
    ensureVariantPickersForTraditionalCard: ensureVariantPickersForTraditionalCard
  };
}