const axios = require("axios");
const { ApiError } = require("../utils/apiError");

async function exchangeAuthorizationCodeForToken(sallaConfig, code) {
  if (!sallaConfig.clientId || !sallaConfig.clientSecret) {
    throw new ApiError(500, "OAuth is not configured. Set SALLA_CLIENT_ID and SALLA_CLIENT_SECRET.", {
      code: "SALLA_OAUTH_NOT_CONFIGURED"
    });
  }
  if (!sallaConfig.redirectUri) {
    throw new ApiError(500, "OAuth redirect URI is missing. Set SALLA_REDIRECT_URI.", { code: "SALLA_REDIRECT_URI_MISSING" });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", sallaConfig.redirectUri);
  body.set("client_id", sallaConfig.clientId);
  body.set("client_secret", sallaConfig.clientSecret);

  try {
    const response = await axios.post(sallaConfig.oauthTokenUrl, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });

    const accessToken = response.data?.access_token;
    const refreshToken = response.data?.refresh_token;
    const expiresIn = Number(response.data?.expires_in || 0);

    if (!accessToken || !refreshToken || !expiresIn) {
      throw new ApiError(502, "Invalid token response from Salla", {
        code: "SALLA_OAUTH_INVALID_RESPONSE",
        details: response.data
      });
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    return { accessToken, refreshToken, expiresAt };
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 502, "Failed to exchange authorization code", {
      code: "SALLA_OAUTH_CODE_EXCHANGE_FAILED",
      details
    });
  }
}

async function fetchOAuthUserInfo(sallaConfig, accessToken) {
  try {
    const response = await axios.get(sallaConfig.oauthUserInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000
    });
    const merchantId = String(response.data?.data?.merchant?.id || "");
    if (!merchantId) {
      throw new ApiError(502, "Invalid user info response from Salla", {
        code: "SALLA_OAUTH_INVALID_USER_INFO",
        details: response.data
      });
    }
    return { merchantId, raw: response.data };
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 502, "Failed to fetch OAuth user info", { code: "SALLA_OAUTH_USERINFO_FAILED", details });
  }
}

/**
 * Refreshes Salla access token using refresh_token grant.
 * Requires `SALLA_CLIENT_ID` and `SALLA_CLIENT_SECRET`.
 * @param {{ oauthTokenUrl: string, clientId?: string, clientSecret?: string }} sallaConfig
 * @param {import("mongoose").Document & any} merchant
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: Date }>}
 */
async function refreshAccessToken(sallaConfig, merchant) {
  if (!sallaConfig.clientId || !sallaConfig.clientSecret) {
    throw new ApiError(
      500,
      "Token refresh is not configured. Set SALLA_CLIENT_ID and SALLA_CLIENT_SECRET.",
      { code: "SALLA_OAUTH_NOT_CONFIGURED" }
    );
  }

  if (!merchant.refreshToken) {
    throw new ApiError(400, "Merchant refresh token is missing", { code: "REFRESH_TOKEN_MISSING" });
  }

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", merchant.refreshToken);
  body.set("client_id", sallaConfig.clientId);
  body.set("client_secret", sallaConfig.clientSecret);

  try {
    const response = await axios.post(sallaConfig.oauthTokenUrl, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000
    });

    const accessToken = response.data?.access_token;
    const refreshToken = response.data?.refresh_token || merchant.refreshToken;
    const expiresIn = Number(response.data?.expires_in || 0);

    if (!accessToken || !expiresIn) {
      throw new ApiError(502, "Invalid token refresh response from Salla", {
        code: "SALLA_OAUTH_INVALID_RESPONSE",
        details: response.data
      });
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    merchant.accessToken = accessToken;
    merchant.refreshToken = refreshToken;
    merchant.tokenExpiresAt = expiresAt;
    await merchant.save();

    return { accessToken, refreshToken, expiresAt };
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message;
    throw new ApiError(status || 502, "Failed to refresh Salla access token", {
      code: "SALLA_OAUTH_REFRESH_FAILED",
      details
    });
  }
}

module.exports = {
  exchangeAuthorizationCodeForToken,
  fetchOAuthUserInfo,
  refreshAccessToken
};
