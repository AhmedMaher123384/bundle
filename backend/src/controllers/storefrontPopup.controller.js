const { asyncHandler } = require("../utils/asyncHandler");
const storefrontPopupService = require("../services/storefrontPopup.service");

function createStorefrontPopupController(_config) {
  const createStorefrontPopup = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    const popup = await storefrontPopupService.createStorefrontPopup(storeId, req.body);
    res.status(201).json({ popup });
  });

  const listStorefrontPopups = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    const popups = await storefrontPopupService.listStorefrontPopups(storeId, { status: req.query?.status });
    res.json({ popups });
  });

  const updateStorefrontPopup = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    const popup = await storefrontPopupService.updateStorefrontPopup(storeId, req.params.id, req.body);
    res.json({ popup });
  });

  const deleteStorefrontPopup = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    await storefrontPopupService.deleteStorefrontPopup(storeId, req.params.id);
    res.status(204).send();
  });

  const listPopupLeads = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    const leads = await storefrontPopupService.listPopupLeads(storeId, req.params.id, { limit: req.query?.limit });
    res.json({ leads });
  });

  return {
    createStorefrontPopup,
    listStorefrontPopups,
    updateStorefrontPopup,
    deleteStorefrontPopup,
    listPopupLeads
  };
}

module.exports = {
  createStorefrontPopupController
};
