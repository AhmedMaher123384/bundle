const { ApiError } = require("../utils/apiError");

function createRateLimiter(options) {
  const windowMs = Math.max(1000, Number(options?.windowMs || 60_000));
  const maxRequests = Math.max(1, Number(options?.maxRequests || 60));
  const keyPrefix = String(options?.keyPrefix || "rl:");

  const buckets = new Map();

  function cleanup(now) {
    for (const [k, v] of buckets.entries()) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }

  return function rateLimitMiddleware(req, _res, next) {
    const now = Date.now();
    if (buckets.size > 10_000) cleanup(now);

    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const key = `${keyPrefix}${ip}`;

    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    existing.count += 1;
    if (existing.count > maxRequests) {
      return next(new ApiError(429, "Too many requests", { code: "RATE_LIMITED" }));
    }

    return next();
  };
}

module.exports = {
  createRateLimiter
};

