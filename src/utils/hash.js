const crypto = require("crypto");
const { Buffer } = require("buffer");

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input || ""), "utf8").digest("hex");
}

function hmacSha256(secret, payload, encoding) {
  const enc = encoding || "hex";
  return crypto.createHmac("sha256", String(secret || "")).update(payload).digest(enc);
}

function hmacSha256Hex(secret, payload) {
  return hmacSha256(secret, payload, "hex");
}

function timingSafeEqualHex(a, b) {
  const aBuf = Buffer.from(String(a || ""), "utf8");
  const bBuf = Buffer.from(String(b || ""), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

module.exports = {
  sha256Hex,
  hmacSha256,
  hmacSha256Hex,
  timingSafeEqualHex
};
