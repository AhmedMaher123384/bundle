const { asyncHandler } = require("../utils/asyncHandler");
const bundleService = require("../services/bundle.service");
const { issueOrReuseSpecialOfferForCartVerbose } = require("../services/cartCoupon.service");
const { fetchVariantsSnapshotReport } = require("../services/sallaCatalog.service");
const { ApiError } = require("../utils/apiError");

function uniqStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((v) => String(v || "").trim()).filter(Boolean)));
}

function componentsVariantIds(components) {
  return uniqStrings((Array.isArray(components) ? components : []).map((c) => c?.variantId));
}

function isProductRef(value) {
  return String(value || "").trim().startsWith("product:");
}

function parseProductIdFromRef(value) {
  const s = String(value || "").trim();
  if (!s.startsWith("product:")) return null;
  const pid = s.slice("product:".length).trim();
  return pid || null;
}

function resolveCoverVariantId(components, presentation) {
  const cover = String(presentation?.coverVariantId || "").trim();
  if (cover) return cover;
  const first = (Array.isArray(components) ? components : []).map((c) => String(c?.variantId || "").trim()).find(Boolean);
  return first || null;
}

function computeInvalidComponentVariantIds(report, componentVariantIds) {
  const componentSet = new Set(componentVariantIds);
  const missing = uniqStrings((report?.missing || []).map((m) => m?.variantId)).filter((id) => componentSet.has(id) && !isProductRef(id));
  const inactive = uniqStrings(
    componentVariantIds.filter((id) => {
      if (isProductRef(id)) return false;
      const snap = report?.snapshots?.get ? report.snapshots.get(String(id)) : null;
      return !snap || snap?.isActive !== true;
    })
  );
  return uniqStrings([...missing, ...inactive]);
}

function resolveTriggerProductIdFromReport(report, coverVariantId) {
  const cover = String(coverVariantId || "").trim();
  if (!cover) return null;
  const fromRef = parseProductIdFromRef(cover);
  if (fromRef) return fromRef;
  const snap = report?.snapshots?.get ? report.snapshots.get(cover) : null;
  const productId = String(snap?.productId || "").trim();
  return productId || null;
}

function createBundleController(config) {
  const createBundle = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    const componentIds = componentsVariantIds(req.body?.components);
    const coverVariantId = resolveCoverVariantId(req.body?.components, req.body?.presentation);
    const idsToValidate = uniqStrings([...componentIds, coverVariantId]);
    if (idsToValidate.length) {
      const report = await fetchVariantsSnapshotReport(config.salla, req.merchantAccessToken, idsToValidate, { concurrency: 5, maxAttempts: 3 });
      const invalid = computeInvalidComponentVariantIds(report, componentIds);
      if (invalid.length) {
        throw new ApiError(400, "Bundle contains invalid variants", { code: "BUNDLE_VARIANTS_INVALID", details: { invalid } });
      }

      const kind = String(req.body?.kind || "").trim();
      const triggerProductId = kind === "popup" ? null : resolveTriggerProductIdFromReport(report, coverVariantId);
      const bundle = await bundleService.createBundle(storeId, { ...req.body, triggerProductId });
      return res.status(201).json({ bundle });
    }

    const bundle = await bundleService.createBundle(storeId, { ...req.body, triggerProductId: null });
    res.status(201).json({ bundle });
  });

  const listBundles = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    const bundles = await bundleService.listBundles(storeId, { status: req.query?.status });
    res.json({ bundles });
  });

  const updateBundle = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    const current = await bundleService.getBundleById(storeId, req.params.id);
    const nextComponents = req.body?.components ?? current.components ?? [];
    const nextPresentation = req.body?.presentation ?? current.presentation ?? {};
    const nextStatus = req.body?.status ?? current.status;
    const nextKind = String(req.body?.kind ?? current.kind ?? "").trim();

    if (nextStatus === "active") {
      const componentIds = componentsVariantIds(nextComponents);
      const coverVariantId = resolveCoverVariantId(nextComponents, nextPresentation);
      const idsToValidate = uniqStrings([...componentIds, coverVariantId]);
      const report = await fetchVariantsSnapshotReport(config.salla, req.merchantAccessToken, idsToValidate, { concurrency: 5, maxAttempts: 3 });
      const invalid = computeInvalidComponentVariantIds(report, componentIds);
      if (invalid.length) {
        throw new ApiError(400, "Bundle contains invalid variants", { code: "BUNDLE_VARIANTS_INVALID", details: { invalid } });
      }
      const triggerProductId = nextKind === "popup" ? null : resolveTriggerProductIdFromReport(report, coverVariantId);
      const bundle = await bundleService.updateBundle(storeId, req.params.id, { ...req.body, triggerProductId });
      return res.json({ bundle });
    }

    const bundle = await bundleService.updateBundle(storeId, req.params.id, req.body);
    res.json({ bundle });
  });

  const deleteBundle = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    await bundleService.deleteBundle(storeId, req.params.id);
    res.status(204).send();
  });

  const evaluateBundles = asyncHandler(async (req, res) => {
    const variantIds = Array.from(
      new Set((req.body?.items || []).map((i) => String(i?.variantId || "").trim()).filter(Boolean))
    );
    const report = await fetchVariantsSnapshotReport(config.salla, req.merchantAccessToken, variantIds, { concurrency: 5, maxAttempts: 3 });
    const inactive = Array.from(report.snapshots.values()).filter((s) => s?.isActive !== true).map((s) => s.variantId);
    const result = await bundleService.evaluateBundles(req.merchant, req.body.items, report.snapshots);
    const shouldCreateOffer = Boolean(req.query?.createOffer ?? req.query?.createCoupon);
    if (!shouldCreateOffer) return res.json({ ...result, validation: { missing: report.missing || [], inactive } });

    const issued = await issueOrReuseSpecialOfferForCartVerbose(
      config,
      req.merchant,
      req.merchantAccessToken,
      req.body.items,
      result,
      { ttlHours: 24 }
    );

    return res.json({
      ...result,
      validation: { missing: report.missing || [], inactive },
      offer: issued?.offer?.offerId
        ? { id: String(issued.offer.offerId), status: issued.offer.status, action: issued.action || null }
        : null,
      offerIssueFailed: Boolean(issued?.failure),
      offerIssueDetails: issued?.failure || null
    });
  });

  const previewBundle = asyncHandler(async (req, res) => {
    const bundleLike = {
      name: String(req.body?.name || "Preview").trim() || "Preview",
      version: 1,
      status: "draft",
      kind: req.body?.kind,
      components: req.body?.components || [],
      rules: req.body?.rules || {},
      settings: req.body?.settings || {},
      presentation: req.body?.presentation || {},
      popupTriggers: req.body?.popupTriggers,
      popupSettings: req.body?.popupSettings
    };

    const cartVariantIds = uniqStrings((req.body?.items || []).map((i) => i?.variantId));
    const componentIds = componentsVariantIds(bundleLike.components);
    const coverVariantId = resolveCoverVariantId(bundleLike.components, bundleLike.presentation);
    const variantIds = uniqStrings([...cartVariantIds, ...componentIds, coverVariantId]);

    const report = await fetchVariantsSnapshotReport(config.salla, req.merchantAccessToken, variantIds, { concurrency: 5, maxAttempts: 3 });
    const invalid = computeInvalidComponentVariantIds(report, componentIds);
    if (invalid.length) {
      throw new ApiError(400, "Bundle contains invalid variants", { code: "BUNDLE_VARIANTS_INVALID", details: { invalid } });
    }

    const inactive = Array.from(report.snapshots.values()).filter((s) => s?.isActive !== true).map((s) => s.variantId);
    const evaluation = bundleService.evaluateBundleDraft(bundleLike, req.body.items, report.snapshots);

    return res.json({
      evaluation,
      variants: Array.from(report.snapshots.values()),
      validation: { missing: report.missing || [], inactive }
    });
  });

  const cartBanner = asyncHandler(async (req, res) => {
    const variantIds = Array.from(
      new Set((req.body?.items || []).map((i) => String(i?.variantId || "").trim()).filter(Boolean))
    );
    const report = await fetchVariantsSnapshotReport(config.salla, req.merchantAccessToken, variantIds, { concurrency: 5, maxAttempts: 3 });
    const evaluation = await bundleService.evaluateBundles(req.merchant, req.body.items, report.snapshots);
    const issued = await issueOrReuseSpecialOfferForCartVerbose(
      config,
      req.merchant,
      req.merchantAccessToken,
      req.body.items,
      evaluation,
      { ttlHours: 24 }
    );

    const discountAmount = Number.isFinite(evaluation?.applied?.totalDiscount) ? Number(evaluation.applied.totalDiscount) : 0;
    const offerId = String(issued?.offer?.offerId || "").trim() || null;
    const hasDiscount = Boolean(offerId && discountAmount > 0);
    const inactive = Array.from(report.snapshots.values()).filter((s) => s?.isActive !== true).map((s) => s.variantId);

    return res.json({
      validation: { missing: report.missing || [], inactive },
      hasDiscount,
      discountAmount: hasDiscount ? Number(discountAmount.toFixed(2)) : 0,
      offerId: hasDiscount ? offerId : null,
      banner: hasDiscount
        ? {
            title: "خصم الباقة جاهز",
            offerId,
            autoApply: true
          }
        : null
    });
  });

  return {
    createBundle,
    listBundles,
    updateBundle,
    deleteBundle,
    evaluateBundles,
    previewBundle,
    cartBanner
  };
}

module.exports = {
  createBundleController
};
