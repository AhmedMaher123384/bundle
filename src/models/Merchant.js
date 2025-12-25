const mongoose = require("mongoose");
const { sha256Hex } = require("../utils/hash");

const MerchantSchema = new mongoose.Schema(
  {
    merchantId: { type: String, required: true, unique: true, index: true },
    accessToken: { type: String, required: true, select: false },
    accessTokenHash: { type: String, required: true, unique: true, index: true },
    accessTokenHashPrevious: { type: String, index: true },
    refreshToken: { type: String, required: true, select: false },
    tokenExpiresAt: { type: Date, required: true, index: true },
    appStatus: {
      type: String,
      required: true,
      enum: ["installed", "uninstalled", "suspended"],
      default: "installed",
      index: true
    }
  },
  { timestamps: true, collection: "merchants" }
);

MerchantSchema.pre("validate", function preValidate(next) {
  if (this.isModified("accessToken")) {
    if (this.accessTokenHash) {
      this.accessTokenHashPrevious = this.accessTokenHash;
    }
    this.accessTokenHash = sha256Hex(this.accessToken);
  }
  next();
});

MerchantSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.accessToken;
    delete ret.accessTokenHash;
    delete ret.refreshToken;
    return ret;
  }
});

module.exports = mongoose.model("Merchant", MerchantSchema);
