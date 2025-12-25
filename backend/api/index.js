const { loadConfig } = require("../src/config/env");
const { connectToMongo } = require("../src/config/db");
const { createApp } = require("../src/app");

let appPromise = null;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const config = loadConfig();
      await connectToMongo(config);
      return createApp(config);
    })();
  }
  return appPromise;
}

module.exports = async (req, res) => {
  try {
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    appPromise = null;
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ message: "Internal server error", code: "INTERNAL_ERROR" }));
  }
};