const AnnouncementBanner = require("../models/AnnouncementBanner");
const { ApiError } = require("../utils/apiError");

function nowMs() {
  return Date.now();
}

function isWithinSchedule(banner) {
  const startAt = banner?.scheduling?.startAt ? new Date(banner.scheduling.startAt).getTime() : null;
  const endAt = banner?.scheduling?.endAt ? new Date(banner.scheduling.endAt).getTime() : null;
  const now = nowMs();
  if (Number.isFinite(startAt) && startAt != null && now < startAt) return false;
  if (Number.isFinite(endAt) && endAt != null && now > endAt) return false;
  return true;
}

function normalizeShowOn(value) {
  const s = String(value || "").trim();
  if (s === "cart") return "cart";
  return "all";
}

function sanitizePayload(payload) {
  const p = payload && typeof payload === "object" ? { ...payload } : {};
  delete p.storeId;
  delete p.deletedAt;

  if (p.presentation && typeof p.presentation === "object") {
    const motion = p.presentation.motion && typeof p.presentation.motion === "object" ? { ...p.presentation.motion } : {};
    const durationSec = Number(motion.durationSec);
    p.presentation = {
      ...p.presentation,
      motion: {
        ...motion,
        enabled: motion.enabled === true,
        durationSec: Number.isFinite(durationSec) ? Math.max(6, Math.min(60, durationSec)) : 18
      }
    };
  }

  if (p.targeting && typeof p.targeting === "object") {
    p.targeting = { ...p.targeting, showOn: normalizeShowOn(p.targeting.showOn) };
  }

  if (p.behavior && typeof p.behavior === "object") {
    const ttl = Number(p.behavior.dismissTtlHours);
    const selectable = p.behavior.selectable;
    p.behavior = {
      ...p.behavior,
      selectable: selectable !== false,
      dismissTtlHours: Number.isFinite(ttl) ? Math.max(0, Math.min(24 * 365, ttl)) : 72
    };
  }

  if (p.priority != null) {
    const pr = Number(p.priority);
    p.priority = Number.isFinite(pr) ? Math.max(0, Math.min(9999, Math.floor(pr))) : 100;
  }

  return p;
}

function sortNewestFirst(banners) {
  return (Array.isArray(banners) ? banners : []).slice().sort((a, b) => {
    const ap = Number(a?.priority ?? 100);
    const bp = Number(b?.priority ?? 100);
    if (ap !== bp) return ap - bp;
    const at = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bt = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (bt !== at) return bt - at;
    return String(b?._id || "").localeCompare(String(a?._id || ""));
  });
}

async function createAnnouncementBanner(storeId, payload) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const safe = sanitizePayload(payload);
  return AnnouncementBanner.create({ ...safe, storeId: s, deletedAt: null });
}

async function listAnnouncementBanners(storeId, { status } = {}) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const query = { storeId: s, deletedAt: null };
  const st = String(status || "").trim();
  if (st) query.status = st;
  const banners = await AnnouncementBanner.find(query).sort({ updatedAt: -1, _id: -1 }).lean();
  return sortNewestFirst(banners);
}

async function getAnnouncementBannerById(storeId, bannerId) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const banner = await AnnouncementBanner.findOne({ _id: bannerId, storeId: s, deletedAt: null }).lean();
  if (!banner) throw new ApiError(404, "Banner not found", { code: "BANNER_NOT_FOUND" });
  return banner;
}

async function updateAnnouncementBanner(storeId, bannerId, payload) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const safe = sanitizePayload(payload);
  const banner = await AnnouncementBanner.findOneAndUpdate({ _id: bannerId, storeId: s, deletedAt: null }, safe, {
    new: true,
    runValidators: true
  }).lean();
  if (!banner) throw new ApiError(404, "Banner not found", { code: "BANNER_NOT_FOUND" });
  return banner;
}

async function deleteAnnouncementBanner(storeId, bannerId) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const now = new Date();
  const updated = await AnnouncementBanner.findOneAndUpdate(
    { _id: bannerId, storeId: s, deletedAt: null },
    { $set: { deletedAt: now, status: "paused" } },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, "Banner not found", { code: "BANNER_NOT_FOUND" });
}

async function getActiveAnnouncementBannerForStore(storeId, { page } = {}) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });

  const showOn = normalizeShowOn(page);
  const candidates = await AnnouncementBanner.find({
    storeId: s,
    status: "active",
    deletedAt: null,
    $or: [{ "targeting.showOn": "all" }, { "targeting.showOn": showOn }]
  })
    .sort({ priority: 1, updatedAt: -1, _id: -1 })
    .lean();

  const filtered = candidates.filter((b) => isWithinSchedule(b));
  return filtered.length ? filtered[0] : null;
}

function serializeAnnouncementBannerForStorefront(banner) {
  if (!banner) return null;
  return {
    id: String(banner?._id || ""),
    version: Number(banner?.version || 1),
    status: String(banner?.status || "draft"),
    name: String(banner?.name || ""),
    title: banner?.content?.title != null ? String(banner.content.title) : null,
    message: banner?.content?.message != null ? String(banner.content.message) : null,
    linkUrl: banner?.content?.linkUrl != null ? String(banner.content.linkUrl) : null,
    linkText: banner?.content?.linkText != null ? String(banner.content.linkText) : null,
    backgroundColor: banner?.presentation?.backgroundColor != null ? String(banner.presentation.backgroundColor) : null,
    textColor: banner?.presentation?.textColor != null ? String(banner.presentation.textColor) : null,
    linkColor: banner?.presentation?.linkColor != null ? String(banner.presentation.linkColor) : null,
    accentColor: banner?.presentation?.accentColor != null ? String(banner.presentation.accentColor) : null,
    sticky: banner?.presentation?.sticky !== false,
    motionEnabled: banner?.presentation?.motion?.enabled === true,
    motionDurationSec: Number.isFinite(Number(banner?.presentation?.motion?.durationSec))
      ? Math.max(6, Math.min(60, Number(banner.presentation.motion.durationSec)))
      : 18,
    dismissible: banner?.behavior?.dismissible !== false,
    selectable: banner?.behavior?.selectable !== false,
    dismissTtlHours: Number.isFinite(Number(banner?.behavior?.dismissTtlHours)) ? Number(banner.behavior.dismissTtlHours) : 72,
    showOn: normalizeShowOn(banner?.targeting?.showOn),
    startAt: banner?.scheduling?.startAt ? new Date(banner.scheduling.startAt).toISOString() : null,
    endAt: banner?.scheduling?.endAt ? new Date(banner.scheduling.endAt).toISOString() : null,
    priority: Number.isFinite(Number(banner?.priority)) ? Number(banner.priority) : 100
  };
}

module.exports = {
  createAnnouncementBanner,
  listAnnouncementBanners,
  getAnnouncementBannerById,
  updateAnnouncementBanner,
  deleteAnnouncementBanner,
  getActiveAnnouncementBannerForStore,
  serializeAnnouncementBannerForStorefront
};
