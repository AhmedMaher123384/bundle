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
  const app = await getApp();
  return app(req, res);
};

