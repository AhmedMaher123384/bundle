const { ApiError } = require("../utils/apiError");
const { getProductVariant, getProductById, getProductBySku } = require("./sallaApi.service");

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function toAmount(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const amount = value?.amount ?? value?.value ?? null;
  if (amount == null) return null;
  const n = Number(amount);
  return Number.isFinite(n) ? n : null;
}

function toNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function normalizeVariantSnapshot(variantId, variantData) {
  const productId =
    String(
      variantData?.product_id ??
        variantData?.productId ??
        variantData?.product?.id ??
        variantData?.product?.product_id ??
        variantData?.product?.productId ??
        variantData?.product?.data?.id ??
        ""
    ).trim() || null;
  const status = String(variantData?.status ?? variantData?.product_status ?? variantData?.state ?? "")
    .trim()
    .toLowerCase();
  const isAvailable = variantData?.is_available === false ? false : true;

  const name = String(variantData?.name ?? variantData?.title ?? "").trim() || null;
  const sku = String(variantData?.sku ?? variantData?.sku_code ?? variantData?.code ?? "").trim() || null;
  const attributesRaw = variantData?.attributes ?? variantData?.options ?? variantData?.values ?? [];
  const attributes = {};
  if (Array.isArray(attributesRaw)) {
    for (const a of attributesRaw) {
      const k = String(a?.name ?? a?.key ?? "").trim().toLowerCase();
      const v = String(a?.value ?? a?.title ?? a?.label ?? "").trim();
      if (!k || !v) continue;
      attributes[k] = v;
    }
  } else if (attributesRaw && typeof attributesRaw === "object") {
    for (const [k0, v0] of Object.entries(attributesRaw)) {
      const k = String(k0 || "").trim().toLowerCase();
      const v = String(v0 || "").trim();
      if (!k || !v) continue;
      attributes[k] = v;
    }
  }
  const images = []
    .concat(variantData?.image)
    .concat(variantData?.images)
    .concat(variantData?.photos)
    .concat(variantData?.media)
    .filter(Boolean);
  let imageUrl = null;
  for (const img of images) {
    if (typeof img === "string") {
      const s = img.trim();
      if (s) {
        imageUrl = s;
        break;
      }
      continue;
    }
    if (img && typeof img === "object") {
      const url = img?.url ?? img?.src ?? img?.original ?? img?.full ?? img?.medium ?? img?.small ?? img?.path ?? null;
      if (url) {
        imageUrl = String(url).trim() || null;
        break;
      }
    }
  }

  const price =
    toAmount(variantData?.price) ??
    toAmount(variantData?.sale_price) ??
    toAmount(variantData?.regular_price) ??
    toAmount(variantData?.base_price) ??
    null;

  const unlimited = variantData?.unlimited_quantity === true;
  const stock = toNumber(variantData?.stock_quantity ?? variantData?.quantity ?? variantData?.stock ?? null, null);
  const outOfStock = unlimited ? false : stock != null ? stock <= 0 : false;

  const visible = !["draft", "hidden", "deleted", "unavailable"].includes(status);
  const isActive = Boolean(isAvailable && visible && !outOfStock);

  return {
    variantId: String(variantId),
    productId,
    name,
    sku,
    attributes,
    imageUrl,
    price,
    stock,
    status: status || null,
    isAvailable,
    outOfStock,
    isActive
  };
}

function normalizeProductSnapshot(productRef, productData) {
  const productId = String(productData?.id ?? productData?.product_id ?? productData?.productId ?? "").trim() || null;
  const status = String(productData?.status ?? productData?.state ?? "").trim().toLowerCase();
  const isAvailable = productData?.is_available === false ? false : true;

  const name = String(productData?.name ?? productData?.title ?? "").trim() || null;
  const sku = String(productData?.sku ?? productData?.sku_code ?? productData?.skuCode ?? "").trim() || null;

  const images = []
    .concat(productData?.image)
    .concat(productData?.images)
    .concat(productData?.photos)
    .concat(productData?.media)
    .filter(Boolean);
  let imageUrl = null;
  for (const img of images) {
    if (typeof img === "string") {
      const s = img.trim();
      if (s) {
        imageUrl = s;
        break;
      }
      continue;
    }
    if (img && typeof img === "object") {
      const url = img?.url ?? img?.src ?? img?.original ?? img?.full ?? img?.medium ?? img?.small ?? img?.path ?? null;
      if (url) {
        imageUrl = String(url).trim() || null;
        break;
      }
    }
  }

  const price =
    toAmount(productData?.price) ??
    toAmount(productData?.sale_price) ??
    toAmount(productData?.regular_price) ??
    toAmount(productData?.base_price) ??
    null;

  const unlimited = productData?.unlimited_quantity === true;
  const stock = toNumber(productData?.stock_quantity ?? productData?.quantity ?? productData?.stock ?? null, null);
  const outOfStock = unlimited ? false : stock != null ? stock <= 0 : false;

  const visible = !["draft", "hidden", "deleted", "unavailable"].includes(status);
  const isActive = Boolean(isAvailable && visible && !outOfStock);

  return {
    variantId: String(productRef),
    productId,
    name,
    sku,
    attributes: {},
    imageUrl,
    price,
    stock,
    status: status || null,
    isAvailable,
    outOfStock,
    isActive
  };
}

function parseProductRef(id) {
  const s = String(id || "").trim();
  if (!s.startsWith("product:")) return null;
  const productId = s.slice("product:".length).trim();
  if (!productId) return null;
  return { productId, ref: s };
}

async function fetchVariantSnapshotWithRetry(sallaConfig, accessToken, variantId, options) {
  const maxAttempts = Math.max(1, Math.min(3, Number(options?.maxAttempts || 3)));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const resp = await getProductVariant(sallaConfig, accessToken, variantId);
      const data = resp?.data ?? null;
      if (!data) throw new ApiError(502, "Empty variant payload from Salla", { code: "SALLA_VARIANT_EMPTY" });
      let snap = normalizeVariantSnapshot(variantId, data);
      if (!snap.productId) {
        const sku = String(data?.sku ?? "").trim();
        if (sku) {
          try {
            const bySku = await getProductBySku(sallaConfig, accessToken, sku);
            const pid = String(bySku?.data?.id ?? "").trim() || null;
            if (pid) snap = { ...snap, productId: pid };
          } catch (err) {
            const statusCode = err instanceof ApiError ? err.statusCode : null;
            if (statusCode != null && statusCode !== 404) throw err;
          }
        }
      }
      return snap;
    } catch (err) {
      const statusCode = err instanceof ApiError ? err.statusCode : null;
      const retryable = statusCode === 429 || (statusCode != null && statusCode >= 500);
      if (!retryable || attempt >= maxAttempts) throw err;
      const backoffMs = Math.min(1500, 150 * 2 ** (attempt - 1));
      await sleep(backoffMs);
    }
  }
  throw new ApiError(502, "Failed to fetch variant from Salla", { code: "SALLA_VARIANT_FETCH_FAILED" });
}

async function fetchProductSnapshotWithRetry(sallaConfig, accessToken, productRef, options) {
  const parsed = parseProductRef(productRef);
  if (!parsed) throw new ApiError(400, "Invalid product ref", { code: "PRODUCT_REF_INVALID" });
  const maxAttempts = Math.max(1, Math.min(3, Number(options?.maxAttempts || 3)));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const resp = await getProductById(sallaConfig, accessToken, parsed.productId, {});
      const data = resp?.data ?? null;
      if (!data) throw new ApiError(502, "Empty product payload from Salla", { code: "SALLA_PRODUCT_EMPTY" });
      return normalizeProductSnapshot(parsed.ref, data);
    } catch (err) {
      const statusCode = err instanceof ApiError ? err.statusCode : null;
      const retryable = statusCode === 429 || (statusCode != null && statusCode >= 500);
      if (!retryable || attempt >= maxAttempts) throw err;
      const backoffMs = Math.min(1500, 150 * 2 ** (attempt - 1));
      await sleep(backoffMs);
    }
  }
  throw new ApiError(502, "Failed to fetch product from Salla", { code: "SALLA_PRODUCT_FETCH_FAILED" });
}

async function fetchVariantsSnapshotMap(sallaConfig, accessToken, variantIds, options) {
  const unique = Array.from(new Set((Array.isArray(variantIds) ? variantIds : []).map((v) => String(v || "").trim()).filter(Boolean)));
  const concurrency = Math.max(1, Math.min(10, Number(options?.concurrency || 5)));

  const results = new Map();
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, unique.length) }).map(async () => {
    while (idx < unique.length) {
      const current = unique[idx];
      idx += 1;
      const parsed = parseProductRef(current);
      const snap = parsed
        ? await fetchProductSnapshotWithRetry(sallaConfig, accessToken, current, options)
        : await fetchVariantSnapshotWithRetry(sallaConfig, accessToken, current, options);
      results.set(String(current), snap);
    }
  });

  await Promise.all(workers);
  return results;
}

async function fetchVariantsSnapshotReport(sallaConfig, accessToken, variantIds, options) {
  const unique = Array.from(new Set((Array.isArray(variantIds) ? variantIds : []).map((v) => String(v || "").trim()).filter(Boolean)));
  const concurrency = Math.max(1, Math.min(10, Number(options?.concurrency || 5)));

  const results = new Map();
  const missing = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, unique.length) }).map(async () => {
    while (idx < unique.length) {
      const current = unique[idx];
      idx += 1;
      try {
        const parsed = parseProductRef(current);
        const snap = parsed
          ? await fetchProductSnapshotWithRetry(sallaConfig, accessToken, current, options)
          : await fetchVariantSnapshotWithRetry(sallaConfig, accessToken, current, options);
        results.set(String(current), snap);
      } catch (err) {
        const statusCode = err instanceof ApiError ? err.statusCode : null;
        const code = err instanceof ApiError ? err.code : null;
        const fatal = statusCode === 429 || (statusCode != null && statusCode >= 500);
        if (fatal) throw err;
        missing.push({
          variantId: String(current),
          statusCode: statusCode ?? null,
          code: code ?? null,
          message: String(err?.message || "Failed to fetch variant")
        });
      }
    }
  });

  await Promise.all(workers);
  return { snapshots: results, missing };
}

async function validateVariantsActive(sallaConfig, accessToken, variantIds, options) {
  const snapshots = await fetchVariantsSnapshotMap(sallaConfig, accessToken, variantIds, options);
  const invalid = [];
  for (const variantId of variantIds || []) {
    const id = String(variantId || "").trim();
    if (!id) continue;
    const snap = snapshots.get(id);
    if (snap && !snap.isActive) {
      invalid.push({ variantId: id, reason: "inactive", status: snap.status, outOfStock: snap.outOfStock });
    }
  }

  if (invalid.length) {
    throw new ApiError(400, "Bundle contains invalid variants", { code: "BUNDLE_VARIANTS_INVALID", details: { invalid } });
  }
  return snapshots;
}

module.exports = {
  fetchVariantsSnapshotMap,
  fetchVariantsSnapshotReport,
  validateVariantsActive
};
