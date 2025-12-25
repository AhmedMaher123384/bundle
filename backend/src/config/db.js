const mongoose = require("mongoose");

/**
 * Connects to MongoDB using Mongoose.
 * @param {{ mongodbUri?: string, mongodbDbName: string }} config
 * @returns {Promise<void>}
 */
async function connectToMongo(config) {
  if (!config.mongodbUri) {
    throw new Error("MONGODB_URI is required. Set it in your environment variables.");
  }

  await mongoose.connect(config.mongodbUri, {
    dbName: config.mongodbDbName
  });
}

module.exports = {
  connectToMongo
};

