const Bundle = require("../models/Bundle");
const Log = require("../models/Log");
const { ApiError } = require("../utils/apiError");
const { sha256Hex } = require("../utils/hash");

function normalizeCartItems(items) {
  const map = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const variantId = String(it?.variantId || "").trim();
    const qty = Number(it?.quantity || 0);
    if (!variantId || !Number.isFinite(qty) || qty <= 0) continue;
    map.set(variantId, (map.get(variantId) || 0) + Math.floor(qty));
  }
  return Array.from(map.entries())
    .map(([variantId, quantity]) => ({ variantId, quantity }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
}

function calcDiscountAmount(rules, subtotal) {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  const type = String(rules?.type || "").trim();
  const value = Number(rules?.value || 0);
  if (type === "percentage") {
    const pct = Math.max(0, Math.min(100, value));
    return (subtotal * pct) / 100;
  }
  if (type === "fixed") {
    const amt = Math.max(0, value);
    return Math.min(subtotal, amt);
  }
  if (type === "bundle_price") {
    const price = Math.max(0, value);
    return Math.max(0, Math.min(subtotal, subtotal - price));
  }
  return 0;
}

function normalizeRuleType(value) {
  const raw = String(value || "").trim();
  if (raw === "fixed" || raw === "percentage" || raw === "bundle_price") return raw;
  return "fixed";
}

function normalizeTiers(input) {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  for (const t of arr) {
    const minQty = Math.max(1, Math.floor(Number(t?.minQty ?? t?.minCartQty ?? t?.qty ?? 1)));
    const type = normalizeRuleType(t?.type);
    const value = Number(t?.value ?? 0);
    if (!Number.isFinite(value) || value < 0) continue;
    out.push({ minQty, type, value: Number(value) });
  }
  const byMinQtyDesc = (a, b) => b.minQty - a.minQty;
  out.sort(byMinQtyDesc);
  const seen = new Set();
  const unique = [];
  for (const t of out) {
    if (seen.has(t.minQty)) continue;
    seen.add(t.minQty);
    unique.push(t);
  }
  return unique;
}

function normalizeRules(input) {
  const type = normalizeRuleType(input?.type);
  const value = Number(input?.value || 0);
  const eligibility = {
    mustIncludeAllGroups: input?.eligibility?.mustIncludeAllGroups !== false,
    minCartQty: Math.max(1, Math.floor(Number(input?.eligibility?.minCartQty || 1)))
  };
  const limits = {
    maxUsesPerOrder: Math.max(1, Math.min(50, Math.floor(Number(input?.limits?.maxUsesPerOrder || 1))))
  };
  const tiers = normalizeTiers(input?.tiers);
  return { type, value: Number.isFinite(value) && value >= 0 ? Number(value) : 0, eligibility, limits, tiers };
}

function normalizeComponents(components) {
  const arr = Array.isArray(components) ? components : [];
  const out = [];
  for (const c of arr) {
    const variantId = String(c?.variantId || "").trim();
    const group = String(c?.group || "").trim().slice(0, 50);
    const quantity = Math.max(1, Math.floor(Number(c?.quantity || 1)));
    if (!variantId || !group) continue;
    out.push({ variantId, group, quantity });
  }
  return out;
}

function buildCartVariantLines(normalizedCart, variantSnapshotById) {
  const lines = [];
  for (const it of Array.isArray(normalizedCart) ? normalizedCart : []) {
    const variantId = String(it?.variantId || "").trim();
    const quantity = Math.floor(Number(it?.quantity || 0));
    if (!variantId || quantity <= 0) continue;

    const snap = variantSnapshotById?.get ? variantSnapshotById.get(variantId) : null;
    if (!snap || snap.isActive !== true) continue;

    const productId = String(snap?.productId || "").trim() || null;
    const unitPrice = Number(snap?.price);
    if (!productId || !Number.isFinite(unitPrice) || unitPrice < 0) continue;

    lines.push({ variantId, productId, quantity, unitPrice });
  }
  return lines;
}

function buildAvailableQtyByVariant(normalizedCart) {
  return new Map((Array.isArray(normalizedCart) ? normalizedCart : []).map((i) => [String(i.variantId), Number(i.quantity)]));
}

function pickBestOptionForGroup(groupOptions, availableQtyByVariant, cartLineByVariantId) {
  let best = null;
  for (const opt of Array.isArray(groupOptions) ? groupOptions : []) {
    const variantId = String(opt?.variantId || "").trim();
    const quantity = Math.max(1, Math.floor(Number(opt?.quantity || 1)));
    if (!variantId) continue;
    const have = Math.max(0, Math.floor(Number(availableQtyByVariant.get(variantId) || 0)));
    if (have < quantity) continue;
    const line = cartLineByVariantId.get(variantId);
    if (!line) continue;
    const unitPrice = Number(line.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) continue;
    const cost = unitPrice * quantity;
    if (!best || cost < best.cost) {
      best = {
        variantId,
        quantity,
        productId: String(line.productId),
        unitPrice,
        cost
      };
    }
  }
  return best;
}

function computeSelectionForUse(groupMap, rules, availableQtyByVariant, cartLineByVariantId) {
  const mustIncludeAllGroups = rules.eligibility.mustIncludeAllGroups !== false;
  const entries = Array.from(groupMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return null;

  if (!mustIncludeAllGroups) {
    let bestGroup = null;
    for (const [, options] of entries) {
      const best = pickBestOptionForGroup(options, availableQtyByVariant, cartLineByVariantId);
      if (!best) continue;
      if (!bestGroup || best.cost < bestGroup.cost) bestGroup = best;
    }
    if (!bestGroup) return null;
    return [bestGroup];
  }

  const selection = [];
  for (const [, options] of entries) {
    const best = pickBestOptionForGroup(options, availableQtyByVariant, cartLineByVariantId);
    if (!best) return null;
    selection.push(best);
    availableQtyByVariant.set(best.variantId, Math.max(0, Math.floor(Number(availableQtyByVariant.get(best.variantId) || 0))) - best.quantity);
  }
  return selection;
}

function resolveBaseVariantId(bundle, components) {
  const cover = String(bundle?.presentation?.coverVariantId || "").trim();
  const componentVariantIds = new Set((Array.isArray(components) ? components : []).map((c) => String(c?.variantId || "").trim()).filter(Boolean));
  if (cover && componentVariantIds.has(cover)) return cover;
  const first = (Array.isArray(components) ? components : []).map((c) => String(c?.variantId || "").trim()).find(Boolean);
  return first || null;
}

function buildGroupMapForComponents(components, overridesByVariantId) {
  const groupMap = new Map();
  for (const c of Array.isArray(components) ? components : []) {
    const g = String(c.group).trim();
    const overrideQty = overridesByVariantId ? overridesByVariantId.get(String(c.variantId)) : null;
    const quantity = overrideQty != null ? Math.max(1, Math.floor(Number(overrideQty))) : c.quantity;
    const arr = groupMap.get(g) || [];
    arr.push({ variantId: c.variantId, quantity });
    groupMap.set(g, arr);
  }
  return groupMap;
}

function computeBundleApplications(bundle, normalizedCart, variantSnapshotById) {
  const components = normalizeComponents(bundle?.components);
  const rules = normalizeRules(bundle?.rules);
  if (!components.length) return [];

  const totalQty = (Array.isArray(normalizedCart) ? normalizedCart : []).reduce((acc, it) => acc + Math.max(0, Math.floor(Number(it?.quantity || 0))), 0);
  if (rules?.tiers?.length) {
    const minTierQty = Math.min(...rules.tiers.map((t) => t.minQty));
    if (totalQty < minTierQty) return [];
  } else if (totalQty < rules.eligibility.minCartQty) return [];

  const cartLines = buildCartVariantLines(normalizedCart, variantSnapshotById);
  const cartLineByVariantId = new Map(cartLines.map((l) => [String(l.variantId), l]));
  const baseAvailable = buildAvailableQtyByVariant(normalizedCart);

  const maxUses = Math.max(1, Math.min(50, Math.floor(Number(rules?.limits?.maxUsesPerOrder || 1))));
  const applications = [];
  const availableQtyByVariant = new Map(baseAvailable);

  if (!rules?.tiers?.length) {
    const groupMap = buildGroupMapForComponents(components, null);
    for (let use = 0; use < maxUses; use += 1) {
      const availableForUse = new Map(availableQtyByVariant);
      const selection = computeSelectionForUse(groupMap, rules, availableForUse, cartLineByVariantId);
      if (!selection || !selection.length) break;

      availableQtyByVariant.clear();
      for (const [k, v] of availableForUse.entries()) availableQtyByVariant.set(k, v);

      const subtotal = selection.reduce((acc, s) => acc + Number(s.unitPrice) * Number(s.quantity), 0);
      const discountAmount = calcDiscountAmount(rules, subtotal);

      const matchedVariants = Array.from(new Set(selection.map((s) => String(s.variantId)).filter(Boolean)));
      const matchedProductIds = Array.from(new Set(selection.map((s) => String(s.productId)).filter(Boolean)));

      applications.push({
        appliedRule: { type: rules.type, value: rules.value, minQty: rules.eligibility.minCartQty },
        selection: selection.map((s) => ({ variantId: String(s.variantId), quantity: s.quantity, productId: String(s.productId) })),
        matchedVariants,
        matchedProductIds,
        subtotal,
        discountAmount
      });
    }
    return applications;
  }

  const baseVariantId = resolveBaseVariantId(bundle, components);
  for (let use = 0; use < maxUses; use += 1) {
    let best = null;

    for (const tier of rules.tiers) {
      const availableForUse = new Map(availableQtyByVariant);
      const overrides = new Map();
      if (baseVariantId) overrides.set(String(baseVariantId), tier.minQty);
      const groupMap = buildGroupMapForComponents(components, overrides);

      const tierRules = {
        ...rules,
        type: tier.type,
        value: tier.value,
        eligibility: { ...rules.eligibility, minCartQty: Math.max(1, tier.minQty) }
      };

      const selection = computeSelectionForUse(groupMap, tierRules, availableForUse, cartLineByVariantId);
      if (!selection || !selection.length) continue;

      const subtotal = selection.reduce((acc, s) => acc + Number(s.unitPrice) * Number(s.quantity), 0);
      const discountAmount = calcDiscountAmount(tierRules, subtotal);

      if (!best || discountAmount > best.discountAmount) {
        best = { tier, selection, availableForUse, subtotal, discountAmount };
      }
    }

    if (!best) break;

    availableQtyByVariant.clear();
    for (const [k, v] of best.availableForUse.entries()) availableQtyByVariant.set(k, v);

    const matchedVariants = Array.from(new Set(best.selection.map((s) => String(s.variantId)).filter(Boolean)));
    const matchedProductIds = Array.from(new Set(best.selection.map((s) => String(s.productId)).filter(Boolean)));

            applications.push({
              tier: { minQty: best.tier.minQty, type: best.tier.type, value: best.tier.value },
              appliedRule: { type: best.tier.type, value: best.tier.value, minQty: best.tier.minQty },
              selection: best.selection.map((s) => ({ variantId: String(s.variantId), quantity: s.quantity, productId: String(s.productId) })),
              matchedVariants,
              matchedProductIds,
              subtotal: best.subtotal,
              discountAmount: best.discountAmount
            });
  }

  return applications;
}

async function listBundles(storeId, filters) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const query = { storeId: s, deletedAt: null };
  if (filters?.status) query.status = String(filters.status).trim();
  if (filters?.triggerProductId) query.triggerProductId = String(filters.triggerProductId).trim();
  return Bundle.find(query).sort({ updatedAt: -1, _id: -1 }).lean();
}

async function getBundlesForProduct(storeId, productId) {
  const s = String(storeId || "").trim();
  const p = String(productId || "").trim();
  if (!s || !p) throw new ApiError(400, "Invalid storeId or productId", { code: "INVALID_IDS" });
  return Bundle.find({
    storeId: s,
    triggerProductId: p,
    status: "active",
    deletedAt: null
  })
    .sort({ updatedAt: -1, _id: -1 })
    .lean();
}

async function getBundleById(storeId, bundleId) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const bundle = await Bundle.findOne({ _id: bundleId, storeId: s, deletedAt: null }).lean();
  if (!bundle) throw new ApiError(404, "Bundle not found", { code: "BUNDLE_NOT_FOUND" });
  return bundle;
}

async function createBundle(storeId, payload) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const safePayload = { ...(payload || {}) };
  delete safePayload.storeId;
  delete safePayload.deletedAt;
  return Bundle.create({ ...safePayload, storeId: s, deletedAt: null });
}

async function updateBundle(storeId, bundleId, payload) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const safePayload = { ...(payload || {}) };
  delete safePayload.storeId;
  delete safePayload.deletedAt;
  const bundle = await Bundle.findOneAndUpdate({ _id: bundleId, storeId: s, deletedAt: null }, safePayload, {
    new: true,
    runValidators: true
  }).lean();
  if (!bundle) throw new ApiError(404, "Bundle not found", { code: "BUNDLE_NOT_FOUND" });
  return bundle;
}

async function deleteBundle(storeId, bundleId) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const now = new Date();
  const updated = await Bundle.findOneAndUpdate(
    { _id: bundleId, storeId: s, deletedAt: null },
    { $set: { deletedAt: now, status: "paused" } },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, "Bundle not found", { code: "BUNDLE_NOT_FOUND" });
}

async function loadActiveBundlesForStore(storeId) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  return Bundle.find({
    storeId: s,
    status: "active",
    deletedAt: null,
    triggerProductId: { $nin: [null, ""] }
  })
    .sort({ updatedAt: -1, _id: -1 })
    .lean();
}

async function evaluateBundles(merchant, cartItems, variantSnapshotById) {
  if (!merchant?._id) throw new ApiError(400, "Invalid merchant", { code: "INVALID_MERCHANT" });
  const storeId = String(merchant?.merchantId || "").trim();
  if (!storeId) throw new ApiError(400, "Invalid merchant storeId", { code: "INVALID_STORE_ID" });

  const normalized = normalizeCartItems(cartItems);
  const bundles = await loadActiveBundlesForStore(storeId);

  const cartSnapshotHash = sha256Hex(JSON.stringify(normalized));

  const evaluations = [];
  const appliedBundles = [];
  let totalDiscount = 0;
  const appliedProductIds = new Set();

  for (const bundle of bundles) {
    const applications = computeBundleApplications(bundle, normalized, variantSnapshotById);
    const matched = applications.length > 0;
    const discountAmount = applications.reduce((acc, a) => acc + Number(a.discountAmount || 0), 0);

    const matchedVariants = Array.from(new Set(applications.flatMap((a) => a.matchedVariants || []))).filter(Boolean);
    const matchedProductIds = Array.from(new Set(applications.flatMap((a) => a.matchedProductIds || []))).filter(Boolean);
    for (const pid of matchedProductIds) appliedProductIds.add(pid);

    const appliedRules = [];
    const appliedRuleKeys = new Set();
    for (const app of applications) {
      const r = app?.appliedRule;
      if (!r) continue;
      const type = String(r.type || "").trim();
      const value = Number(r.value);
      const minQty = Math.max(1, Math.floor(Number(r.minQty || 1)));
      if (!type || !Number.isFinite(value) || value < 0) continue;
      const key = `${type}:${value}:${minQty}`;
      if (appliedRuleKeys.has(key)) continue;
      appliedRuleKeys.add(key);
      appliedRules.push({ type, value, minQty });
    }

    const applied = matched && discountAmount > 0;
    if (applied) {
      appliedBundles.push({
        bundleId: String(bundle._id),
        uses: applications.length,
        discountAmount: Number(discountAmount.toFixed(2)),
        matchedVariants,
        matchedProductIds,
        appliedRules
      });
      totalDiscount += discountAmount;

      await Log.create({
        merchantId: merchant._id,
        bundleId: bundle._id,
        matchedVariants,
        cartSnapshotHash,
        createdAt: new Date()
      });
    }

    evaluations.push({
      bundle,
      matched,
      applied,
      uses: applications.length,
      discountAmount: applied ? Number(discountAmount.toFixed(2)) : 0,
      matchedVariants,
      matchedProductIds
    });
  }

  return {
    cart: normalized,
    cartSnapshotHash,
    bundles: evaluations,
    applied: {
      bundles: appliedBundles,
      matchedProductIds: Array.from(appliedProductIds),
      totalDiscount: appliedBundles.length ? Number(totalDiscount.toFixed(2)) : 0,
      rule: (() => {
        const rules = [];
        const keys = new Set();
        for (const b of appliedBundles) {
          for (const r of Array.isArray(b?.appliedRules) ? b.appliedRules : []) {
            const type = String(r?.type || "").trim();
            const value = Number(r?.value);
            if (!type || !Number.isFinite(value) || value < 0) continue;
            const key = `${type}:${value}`;
            if (keys.has(key)) continue;
            keys.add(key);
            rules.push({ type, value });
          }
        }
        return rules.length === 1 ? rules[0] : null;
      })()
    }
  };
}

function evaluateBundleDraft(bundleLike, cartItems, variantSnapshotById) {
  const normalized = normalizeCartItems(cartItems);
  const applications = computeBundleApplications(bundleLike, normalized, variantSnapshotById);
  const matched = applications.length > 0;
  const discountAmount = applications.reduce((acc, a) => acc + Number(a.discountAmount || 0), 0);
  const matchedVariants = Array.from(new Set(applications.flatMap((a) => a.matchedVariants || []))).filter(Boolean);
  const matchedProductIds = Array.from(new Set(applications.flatMap((a) => a.matchedProductIds || []))).filter(Boolean);
  const applied = matched && discountAmount > 0;

  return {
    cart: normalized,
    matched,
    applied,
    uses: applications.length,
    discountAmount: applied ? Number(discountAmount.toFixed(2)) : 0,
    matchedVariants,
    matchedProductIds,
    applications
  };
}

module.exports = {
  listBundles,
  getBundlesForProduct,
  getBundleById,
  createBundle,
  updateBundle,
  deleteBundle,
  evaluateBundles,
  evaluateBundleDraft
};
