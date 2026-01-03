const axios = require("axios");
const { ApiError } = require("../utils/apiError");

function sallaErrorMessage(operation, status) {
  if (status === 401) return `Salla authorization failed while ${operation}. Reinstall the app to refresh scopes/tokens.`;
  if (status === 403) return `Salla access denied while ${operation}. Ensure your app has products scopes (products.read/products.read_write).`;
  if (status === 404) return `Salla endpoint not found while ${operation}. Check SALLA_API_BASE_URL.`;
  if (status === 422) return `Salla rejected the request while ${operation}. One or more query parameters are invalid.`;
  if (status === 429) return `Salla rate limit reached while ${operation}. Please retry shortly.`;
  return `Failed to ${operation} from Salla`;
}

function createSallaApiClient(sallaConfig, accessToken) {
  return axios.create({
    baseURL: sallaConfig.apiBaseUrl,
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Salla-Sync-Cart": "true",
      "Cache-Control": "no-cache"
    }
  });
}

async function getStoreInfo(sallaConfig, accessToken) {
  try {
    const client = createSallaApiClient(sallaConfig, accessToken);
    const response = await client.get("/admin/v2/store/info");
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 503, "Failed to fetch store info from Salla", { code: "SALLA_STORE_INFO_FAILED", details });
  }
}

async function createCoupon(sallaConfig, accessToken, payload) {
  try {
    const client = createSallaApiClient(sallaConfig, accessToken);
    const response = await client.post("/admin/v2/coupons", payload, {
      headers: { "Content-Type": "application/json" }
    });
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 503, "Failed to create coupon in Salla", { code: "SALLA_COUPON_CREATE_FAILED", details });
  }
}

async function createSpecialOffer(sallaConfig, accessToken, payload) {
  try {
    const client = createSallaApiClient(sallaConfig, accessToken);
    const headers = { "Content-Type": "application/json" };
    const paths = ["/admin/v2/special-offers", "/admin/v2/specialoffers"];
    let lastErr = null;
    for (const p of paths) {
      try {
        const response = await client.post(p, payload, { headers });
        return response.data;
      } catch (error) {
        const status = error?.response?.status;
        if (status === 404) {
          lastErr = error;
          continue;
        }
        const details = error?.response?.data || error?.message;
        throw new ApiError(status || 503, "Failed to create special offer in Salla", { code: "SALLA_SPECIALOFFER_CREATE_FAILED", details });
      }
    }
    const status = lastErr?.response?.status;
    const details = lastErr?.response?.data || lastErr?.message;
    throw new ApiError(status || 503, "Failed to create special offer in Salla", { code: "SALLA_SPECIALOFFER_CREATE_FAILED", details });
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 503, "Failed to create special offer in Salla", { code: "SALLA_SPECIALOFFER_CREATE_FAILED", details });
  }
}

async function updateSpecialOffer(sallaConfig, accessToken, offerId, payload) {
  try {
    const client = createSallaApiClient(sallaConfig, accessToken);
    const headers = { "Content-Type": "application/json" };
    const paths = [
      `/admin/v2/special-offers/${encodeURIComponent(String(offerId))}`,
      `/admin/v2/specialoffers/${encodeURIComponent(String(offerId))}`
    ];
    let lastErr = null;
    for (const p of paths) {
      try {
        const response = await client.put(p, payload, { headers });
        return response.data;
      } catch (error) {
        const status = error?.response?.status;
        if (status === 404) {
          lastErr = error;
          continue;
        }
        const details = error?.response?.data || error?.message;
        throw new ApiError(status || 503, "Failed to update special offer in Salla", { code: "SALLA_SPECIALOFFER_UPDATE_FAILED", details });
      }
    }
    const status = lastErr?.response?.status;
    const details = lastErr?.response?.data || lastErr?.message;
    throw new ApiError(status || 503, "Failed to update special offer in Salla", { code: "SALLA_SPECIALOFFER_UPDATE_FAILED", details });
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 503, "Failed to update special offer in Salla", { code: "SALLA_SPECIALOFFER_UPDATE_FAILED", details });
  }
}

async function changeSpecialOfferStatus(sallaConfig, accessToken, offerId, status) {
  try {
    const client = createSallaApiClient(sallaConfig, accessToken);
    const headers = { "Content-Type": "application/json" };
    const body = { status: String(status || "").trim() };
    const paths = [
      `/admin/v2/special-offers/${encodeURIComponent(String(offerId))}/status`,
      `/admin/v2/specialoffers/${encodeURIComponent(String(offerId))}/status`
    ];
    let lastErr = null;
    for (const p of paths) {
      try {
        const response = await client.put(p, body, { headers });
        return response.data;
      } catch (error) {
        const st = error?.response?.status;
        if (st === 404) {
          lastErr = error;
          continue;
        }
        const details = error?.response?.data || error?.message;
        throw new ApiError(st || 503, "Failed to change special offer status in Salla", { code: "SALLA_SPECIALOFFER_STATUS_FAILED", details });
      }
    }
    const st = lastErr?.response?.status;
    const details = lastErr?.response?.data || lastErr?.message;
    throw new ApiError(st || 503, "Failed to change special offer status in Salla", { code: "SALLA_SPECIALOFFER_STATUS_FAILED", details });
  } catch (error) {
    const st = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(st || 503, "Failed to change special offer status in Salla", { code: "SALLA_SPECIALOFFER_STATUS_FAILED", details });
  }
}

async function deleteSpecialOffer(sallaConfig, accessToken, offerId) {
  try {
    const client = createSallaApiClient(sallaConfig, accessToken);
    const paths = [
      `/admin/v2/special-offers/${encodeURIComponent(String(offerId))}`,
      `/admin/v2/specialoffers/${encodeURIComponent(String(offerId))}`
    ];
    let lastErr = null;
    for (const p of paths) {
      try {
        const response = await client.delete(p);
        return response.data;
      } catch (error) {
        const status = error?.response?.status;
        if (status === 404) {
          lastErr = error;
          continue;
        }
        const details = error?.response?.data || error?.message;
        throw new ApiError(status || 503, "Failed to delete special offer in Salla", { code: "SALLA_SPECIALOFFER_DELETE_FAILED", details });
      }
    }
    const status = lastErr?.response?.status;
    const details = lastErr?.response?.data || lastErr?.message;
    throw new ApiError(status || 503, "Failed to delete special offer in Salla", { code: "SALLA_SPECIALOFFER_DELETE_FAILED", details });
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 503, "Failed to delete special offer in Salla", { code: "SALLA_SPECIALOFFER_DELETE_FAILED", details });
  }
}

async function listProducts(sallaConfig, accessToken, params) {
  try {
    const client = createSallaApiClient(sallaConfig, accessToken);
    const response = await client.get("/admin/v2/products", {
      params: {
        page: params?.page,
        per_page: params?.perPage,
        format: params?.format,
        keyword: params?.search,
        status: params?.status,
        category: params?.category
      }
    });
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 503, sallaErrorMessage("list products", status), { code: "SALLA_PRODUCTS_LIST_FAILED", details });
  }
}

async function getProductById(sallaConfig, accessToken, productId, params) {
  try {
    const client = createSallaApiClient(sallaConfig, accessToken);
    const response = await client.get(`/admin/v2/products/${encodeURIComponent(String(productId))}`, {
      params: {
        format: params?.format
      }
    });
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 503, "Failed to fetch product from Salla", { code: "SALLA_PRODUCT_FETCH_FAILED", details });
  }
}

async function getProductVariant(sallaConfig, accessToken, variantId) {
  try {
    const client = createSallaApiClient(sallaConfig, accessToken);
    const response = await client.get(`/admin/v2/products/variants/${encodeURIComponent(String(variantId))}`);
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 503, "Failed to fetch product variant from Salla", {
      code: "SALLA_PRODUCT_VARIANT_FETCH_FAILED",
      details
    });
  }
}

async function getProductBySku(sallaConfig, accessToken, sku) {
  try {
    const client = createSallaApiClient(sallaConfig, accessToken);
    const response = await client.get(`/admin/v2/products/sku/${encodeURIComponent(String(sku))}`);
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 503, "Failed to fetch product by SKU from Salla", {
      code: "SALLA_PRODUCT_BY_SKU_FETCH_FAILED",
      details
    });
  }
}

async function getOrderById(sallaConfig, accessToken, orderId, params) {
  try {
    const client = createSallaApiClient(sallaConfig, accessToken);
    const response = await client.get(`/admin/v2/orders/${encodeURIComponent(String(orderId))}`, {
      params: {
        reference_id: params?.referenceId,
        format: params?.format
      }
    });
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 503, "Failed to fetch order from Salla", { code: "SALLA_ORDER_FETCH_FAILED", details });
  }
}

module.exports = {
  getStoreInfo,
  createCoupon,
  createSpecialOffer,
  updateSpecialOffer,
  changeSpecialOfferStatus,
  deleteSpecialOffer,
  listProducts,
  getProductById,
  getProductVariant,
  getProductBySku,
  getOrderById
};
