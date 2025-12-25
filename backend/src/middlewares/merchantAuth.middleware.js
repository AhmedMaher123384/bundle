const { ApiError } = require("../utils/apiError");
const { refreshAccessToken } = require("../services/sallaOAuth.service");
const { findMerchantByAccessToken } = require("../services/merchant.service");

function merchantAuth(config) {
  return async function merchantAuthMiddleware(req, _res, next) {
    try {
      const auth = String(req.headers.authorization || "");
      const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
      if (!token) {
        throw new ApiError(401, "Unauthorized", { code: "UNAUTHORIZED" });
      }

      const merchant = await findMerchantByAccessToken(token);

      const skewMs = Math.max(0, Number(config.security.tokenRefreshSkewSeconds || 0)) * 1000;
      const expiresAtMs = merchant.tokenExpiresAt ? new Date(merchant.tokenExpiresAt).getTime() : 0;
      const shouldRefresh = !expiresAtMs || expiresAtMs <= Date.now() + skewMs;

      if (shouldRefresh) {
        await refreshAccessToken(config.salla, merchant);
      }

      req.merchant = merchant;
      req.merchantAccessToken = merchant.accessToken;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  merchantAuth
};

