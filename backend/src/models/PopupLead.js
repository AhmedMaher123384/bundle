const mongoose = require("mongoose");

const PopupLeadSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true, index: true },
    popupId: { type: String, required: true, index: true },
    customer: {
      name: { type: String, default: null },
      email: { type: String, default: null },
      phone: { type: String, default: null }
    },
    consent: { type: Boolean, default: false },
    meta: {
      pageUrl: { type: String, default: null },
      userAgent: { type: String, default: null },
      lang: { type: String, default: null },
      dir: { type: String, default: null }
    }
  },
  { timestamps: true, collection: "popup_leads" }
);

PopupLeadSchema.index({ storeId: 1, popupId: 1, createdAt: -1 });

module.exports = mongoose.model("PopupLead", PopupLeadSchema);

