const { ApiError } = require("../utils/apiError");
const { sha256Hex } = require("../utils/hash");
const { exchangeAuthorizationCodeForToken, fetchOAuthUserInfo } = require("../services/sallaOAuth.service");
const { upsertInstalledMerchant } = require("../services/merchant.service");
const { URL } = require("url");

function createStateStore() {
  const stateMap = new Map();
  const ttlMs = 10 * 60 * 1000;

  function issue() {
    const state = sha256Hex(`${Date.now()}:${Math.random()}`);
    stateMap.set(state, Date.now() + ttlMs);
    return state;
  }

  function consume(state) {
    const expiresAt = stateMap.get(state);
    stateMap.delete(state);
    if (!expiresAt) return false;
    return expiresAt > Date.now();
  }

  return { issue, consume };
}

const stateStore = createStateStore();

function createOAuthController(config) {
  async function install(_req, res) {
    if (!config.salla.clientId || !config.salla.redirectUri) {
      throw new ApiError(500, "OAuth is not configured", { code: "SALLA_OAUTH_NOT_CONFIGURED" });
    }

    const state = stateStore.issue();
    const url = new URL(config.salla.oauthAuthorizeUrl);
    url.searchParams.set("client_id", config.salla.clientId);
    url.searchParams.set("redirect_uri", config.salla.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "offline_access products.read_write coupons.write orders.read_write specialoffers.read_write");
    url.searchParams.set("state", state);

    return res.redirect(url.toString());
  }

  async function callback(req, res) {
    const state = String(req.query.state || "");
    if (!stateStore.consume(state)) {
      throw new ApiError(400, "Invalid OAuth state", { code: "SALLA_OAUTH_INVALID_STATE" });
    }

    const code = String(req.query.code || "");
    const token = await exchangeAuthorizationCodeForToken(config.salla, code);
    const userInfo = await fetchOAuthUserInfo(config.salla, token.accessToken);

    await upsertInstalledMerchant({
      merchantId: userInfo.merchantId,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      tokenExpiresAt: token.expiresAt
    });

    return res.json({ ok: true, merchantId: userInfo.merchantId });
  }

  return { install, callback };
}

module.exports = {
  createOAuthController
};
