const { loadConfig } = require("./config/env");
const { connectToMongo } = require("./config/db");
const { createApp } = require("./app");
const { expireOldCoupons } = require("./services/cartCoupon.service");

function ensureIntervalMs(value, fallbackMs, minMs, maxMs) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallbackMs;
  return Math.max(minMs, Math.min(maxMs, n));
}

function startBackgroundJobs(_config) {
  const couponCleanupIntervalMs = ensureIntervalMs(
    process.env.COUPON_CLEANUP_INTERVAL_MS,
    24 * 60 * 60 * 1000,
    10 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000
  );

  const runCouponCleanup = async () => {
    try {
      await expireOldCoupons();
    } catch (err) {
      console.error(err);
    }
  };

  globalThis.setTimeout(runCouponCleanup, 10_000).unref?.();
  globalThis.setInterval(runCouponCleanup, couponCleanupIntervalMs).unref?.();
}

async function bootstrap() {
  const config = loadConfig();

  await connectToMongo(config);
  const app = createApp(config);

  app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });

  startBackgroundJobs(config);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
