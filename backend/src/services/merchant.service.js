const Merchant = require("../models/Merchant");
const { ApiError } = require("../utils/apiError");
const { sha256Hex } = require("../utils/hash");

async function findMerchantByAccessToken(accessToken) {
  const accessTokenHash = sha256Hex(accessToken);
  const merchant = await Merchant.findOne({
    $or: [{ accessTokenHash }, { accessTokenHashPrevious: accessTokenHash }]
  }).select("+accessToken +refreshToken");
  if (!merchant) {
    throw new ApiError(401, "Unauthorized", { code: "UNAUTHORIZED" });
  }
  if (merchant.appStatus !== "installed") {
    throw new ApiError(403, "Merchant is not active", { code: "MERCHANT_INACTIVE" });
  }
  return merchant;
}

async function findMerchantByMerchantId(merchantId) {
  return Merchant.findOne({ merchantId }).select("+accessToken +refreshToken");
}

async function upsertInstalledMerchant(input) {
  const existing = await Merchant.findOne({ merchantId: input.merchantId }).select("+accessToken +refreshToken");
  if (existing) {
    existing.accessToken = input.accessToken;
    existing.refreshToken = input.refreshToken;
    existing.tokenExpiresAt = input.tokenExpiresAt;
    existing.appStatus = "installed";
    await existing.save();
    return existing;
  }

  return Merchant.create({
    merchantId: input.merchantId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    tokenExpiresAt: input.tokenExpiresAt,
    appStatus: "installed"
  });
}

async function markMerchantUninstalled(merchantId) {
  const merchant = await Merchant.findOne({ merchantId }).select("+accessToken +refreshToken");
  if (!merchant) return;
  merchant.appStatus = "uninstalled";
  const nonce = `${Date.now()}:${Math.random()}`;
  merchant.accessToken = `revoked:${merchantId}:${nonce}`;
  merchant.refreshToken = `revoked:${merchantId}:${nonce}`;
  merchant.tokenExpiresAt = new Date(0);
  await merchant.save();
}

async function listInstalledMerchants() {
  return Merchant.find({ appStatus: "installed" }).select("+accessToken +refreshToken");
}

module.exports = {
  findMerchantByAccessToken,
  findMerchantByMerchantId,
  upsertInstalledMerchant,
  markMerchantUninstalled,
  listInstalledMerchants
};
