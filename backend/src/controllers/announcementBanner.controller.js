const { asyncHandler } = require("../utils/asyncHandler");
const announcementBannerService = require("../services/announcementBanner.service");

function createAnnouncementBannerController(_config) {
  const createAnnouncementBanner = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    const banner = await announcementBannerService.createAnnouncementBanner(storeId, req.body);
    res.status(201).json({ banner });
  });

  const listAnnouncementBanners = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    const banners = await announcementBannerService.listAnnouncementBanners(storeId, { status: req.query?.status });
    res.json({ banners });
  });

  const updateAnnouncementBanner = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    const banner = await announcementBannerService.updateAnnouncementBanner(storeId, req.params.id, req.body);
    res.json({ banner });
  });

  const deleteAnnouncementBanner = asyncHandler(async (req, res) => {
    const storeId = String(req.merchant?.merchantId || "").trim();
    await announcementBannerService.deleteAnnouncementBanner(storeId, req.params.id);
    res.status(204).send();
  });

  return {
    createAnnouncementBanner,
    listAnnouncementBanners,
    updateAnnouncementBanner,
    deleteAnnouncementBanner
  };
}

module.exports = {
  createAnnouncementBannerController
};

