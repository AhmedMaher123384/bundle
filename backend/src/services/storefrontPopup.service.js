const StorefrontPopup = require("../models/StorefrontPopup");
const PopupLead = require("../models/PopupLead");
const { ApiError } = require("../utils/apiError");

function nowMs() {
  return Date.now();
}

function isWithinSchedule(popup) {
  const startAt = popup?.scheduling?.startAt ? new Date(popup.scheduling.startAt).getTime() : null;
  const endAt = popup?.scheduling?.endAt ? new Date(popup.scheduling.endAt).getTime() : null;
  const now = nowMs();
  if (Number.isFinite(startAt) && startAt != null && now < startAt) return false;
  if (Number.isFinite(endAt) && endAt != null && now > endAt) return false;
  return true;
}

function normalizeShowOn(value) {
  const s = String(value || "").trim();
  if (s === "home") return "home";
  if (s === "cart") return "cart";
  return "all";
}

function clampNum(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

function sanitizeHighlights(input) {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  for (const raw of arr) {
    const s = String(raw || "").trim();
    if (!s) continue;
    out.push(s.slice(0, 120));
    if (out.length >= 4) break;
  }
  return out;
}

function sanitizePayload(payload) {
  const p = payload && typeof payload === "object" ? { ...payload } : {};
  delete p.storeId;
  delete p.deletedAt;

  if (p.content && typeof p.content === "object") {
    p.content = {
      ...p.content,
      title: p.content.title != null ? String(p.content.title).trim() || null : null,
      subtitle: p.content.subtitle != null ? String(p.content.subtitle).trim() || null : null,
      highlights: sanitizeHighlights(p.content.highlights),
      imageUrl: p.content.imageUrl != null ? String(p.content.imageUrl).trim() || null : null
    };
  }

  if (p.presentation && typeof p.presentation === "object") {
    const pres = { ...p.presentation };
    const shapeRaw = pres.shape && typeof pres.shape === "object" ? { ...pres.shape } : {};
    const radiusPx = clampNum(shapeRaw.radiusPx, 0, 40, 18);
    const widthPx = clampNum(shapeRaw.widthPx, 280, 560, 420);
    const overlayOpacity = clampNum(pres.overlayOpacity, 0, 0.9, 0.55);
    const fontFamily = pres.fontFamily == null ? null : String(pres.fontFamily).trim() || null;
    const layout = String(pres.layout || "center").trim();
    const enterAnimation = String(pres.enterAnimation || "pop").trim();

    p.presentation = {
      ...pres,
      backgroundColor: pres.backgroundColor != null ? String(pres.backgroundColor).trim() || null : null,
      textColor: pres.textColor != null ? String(pres.textColor).trim() || null : null,
      accentColor: pres.accentColor != null ? String(pres.accentColor).trim() || null : null,
      overlayColor: pres.overlayColor != null ? String(pres.overlayColor).trim() || null : null,
      overlayOpacity,
      fontFamily,
      shape: { radiusPx, widthPx },
      layout: ["center", "bottom_left", "bottom_right"].includes(layout) ? layout : "center",
      glass: pres.glass !== false,
      enterAnimation: ["none", "slide", "fade", "pop"].includes(enterAnimation) ? enterAnimation : "pop"
    };
  }

  if (p.form && typeof p.form === "object") {
    const f = { ...p.form };
    const fields = f.fields && typeof f.fields === "object" ? { ...f.fields } : {};
    const name = fields.name !== false;
    const email = fields.email !== false;
    const phone = fields.phone === true;
    p.form = {
      ...f,
      enabled: f.enabled !== false,
      fields: { name, email, phone },
      consentText: f.consentText != null ? String(f.consentText).trim() || null : null,
      submitText: f.submitText != null ? String(f.submitText).trim() || null : null,
      successTitle: f.successTitle != null ? String(f.successTitle).trim() || null : null,
      successMessage: f.successMessage != null ? String(f.successMessage).trim() || null : null,
      couponCode: f.couponCode != null ? String(f.couponCode).trim() || null : null,
      redirectUrl: f.redirectUrl != null ? String(f.redirectUrl).trim() || null : null
    };
  }

  if (p.behavior && typeof p.behavior === "object") {
    const b = { ...p.behavior };
    p.behavior = {
      ...b,
      dismissible: b.dismissible !== false,
      closeOnOverlay: b.closeOnOverlay !== false,
      dismissTtlHours: clampNum(b.dismissTtlHours, 0, 24 * 365, 72),
      showDelayMs: clampNum(b.showDelayMs, 0, 20000, 800),
      frequency: ["once_per_ttl", "every_pageview", "once_per_session"].includes(String(b.frequency || "once_per_ttl"))
        ? String(b.frequency)
        : "once_per_ttl"
    };
  }

  if (p.targeting && typeof p.targeting === "object") {
    p.targeting = { ...p.targeting, showOn: normalizeShowOn(p.targeting.showOn) };
  }

  if (p.priority != null) {
    const pr = Number(p.priority);
    p.priority = Number.isFinite(pr) ? Math.max(0, Math.min(9999, Math.floor(pr))) : 100;
  }

  return p;
}

function sortNewestFirst(items) {
  return (Array.isArray(items) ? items : []).slice().sort((a, b) => {
    const ap = Number(a?.priority ?? 100);
    const bp = Number(b?.priority ?? 100);
    if (ap !== bp) return ap - bp;
    const at = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bt = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (bt !== at) return bt - at;
    return String(b?._id || "").localeCompare(String(a?._id || ""));
  });
}

async function createStorefrontPopup(storeId, payload) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const safe = sanitizePayload(payload);
  return StorefrontPopup.create({ ...safe, storeId: s, deletedAt: null });
}

async function listStorefrontPopups(storeId, { status } = {}) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const query = { storeId: s, deletedAt: null };
  const st = String(status || "").trim();
  if (st) query.status = st;
  const popups = await StorefrontPopup.find(query).sort({ updatedAt: -1, _id: -1 }).lean();
  return sortNewestFirst(popups);
}

async function updateStorefrontPopup(storeId, popupId, payload) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const safe = sanitizePayload(payload);
  const popup = await StorefrontPopup.findOneAndUpdate({ _id: popupId, storeId: s, deletedAt: null }, safe, {
    new: true,
    runValidators: true
  }).lean();
  if (!popup) throw new ApiError(404, "Popup not found", { code: "POPUP_NOT_FOUND" });
  return popup;
}

async function getStorefrontPopupById(storeId, popupId) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const pid = String(popupId || "").trim();
  if (!pid) throw new ApiError(400, "Invalid popupId", { code: "INVALID_POPUP_ID" });
  const popup = await StorefrontPopup.findOne({ _id: pid, storeId: s, deletedAt: null }).lean();
  if (!popup) throw new ApiError(404, "Popup not found", { code: "POPUP_NOT_FOUND" });
  return popup;
}

async function deleteStorefrontPopup(storeId, popupId) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const now = new Date();
  const updated = await StorefrontPopup.findOneAndUpdate(
    { _id: popupId, storeId: s, deletedAt: null },
    { $set: { deletedAt: now, status: "paused" } },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, "Popup not found", { code: "POPUP_NOT_FOUND" });
}

async function getActiveStorefrontPopupForStore(storeId, { page } = {}) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });

  const showOn = normalizeShowOn(page);
  const candidates = await StorefrontPopup.find({
    storeId: s,
    status: "active",
    deletedAt: null,
    $or: [{ "targeting.showOn": "all" }, { "targeting.showOn": showOn }]
  })
    .sort({ priority: 1, updatedAt: -1, _id: -1 })
    .lean();

  const filtered = candidates.filter((p) => isWithinSchedule(p));
  return filtered.length ? filtered[0] : null;
}

function serializeStorefrontPopupForStorefront(popup) {
  if (!popup) return null;
  return {
    id: String(popup?._id || ""),
    version: Number(popup?.version || 1),
    status: String(popup?.status || "draft"),
    name: String(popup?.name || ""),
    title: popup?.content?.title != null ? String(popup.content.title) : null,
    subtitle: popup?.content?.subtitle != null ? String(popup.content.subtitle) : null,
    highlights: Array.isArray(popup?.content?.highlights) ? popup.content.highlights.map((h) => String(h)) : [],
    imageUrl: popup?.content?.imageUrl != null ? String(popup.content.imageUrl) : null,
    backgroundColor: popup?.presentation?.backgroundColor != null ? String(popup.presentation.backgroundColor) : null,
    textColor: popup?.presentation?.textColor != null ? String(popup.presentation.textColor) : null,
    accentColor: popup?.presentation?.accentColor != null ? String(popup.presentation.accentColor) : null,
    overlayColor: popup?.presentation?.overlayColor != null ? String(popup.presentation.overlayColor) : null,
    overlayOpacity: clampNum(popup?.presentation?.overlayOpacity, 0, 0.9, 0.55),
    fontFamily: popup?.presentation?.fontFamily != null ? String(popup.presentation.fontFamily) : null,
    shapeRadiusPx: clampNum(popup?.presentation?.shape?.radiusPx, 0, 40, 18),
    shapeWidthPx: clampNum(popup?.presentation?.shape?.widthPx, 280, 560, 420),
    layout: ["center", "bottom_left", "bottom_right"].includes(String(popup?.presentation?.layout || "center"))
      ? String(popup.presentation.layout)
      : "center",
    glass: popup?.presentation?.glass !== false,
    enterAnimation: popup?.presentation?.enterAnimation != null ? String(popup.presentation.enterAnimation) : "pop",
    formEnabled: popup?.form?.enabled !== false,
    fieldName: popup?.form?.fields?.name !== false,
    fieldEmail: popup?.form?.fields?.email !== false,
    fieldPhone: popup?.form?.fields?.phone === true,
    consentText: popup?.form?.consentText != null ? String(popup.form.consentText) : null,
    submitText: popup?.form?.submitText != null ? String(popup.form.submitText) : null,
    successTitle: popup?.form?.successTitle != null ? String(popup.form.successTitle) : null,
    successMessage: popup?.form?.successMessage != null ? String(popup.form.successMessage) : null,
    couponCode: popup?.form?.couponCode != null ? String(popup.form.couponCode) : null,
    redirectUrl: popup?.form?.redirectUrl != null ? String(popup.form.redirectUrl) : null,
    dismissible: popup?.behavior?.dismissible !== false,
    closeOnOverlay: popup?.behavior?.closeOnOverlay !== false,
    dismissTtlHours: clampNum(popup?.behavior?.dismissTtlHours, 0, 24 * 365, 72),
    showDelayMs: clampNum(popup?.behavior?.showDelayMs, 0, 20000, 800),
    frequency: ["once_per_ttl", "every_pageview", "once_per_session"].includes(String(popup?.behavior?.frequency || "once_per_ttl"))
      ? String(popup.behavior.frequency)
      : "once_per_ttl",
    showOn: normalizeShowOn(popup?.targeting?.showOn),
    startAt: popup?.scheduling?.startAt ? new Date(popup.scheduling.startAt).toISOString() : null,
    endAt: popup?.scheduling?.endAt ? new Date(popup.scheduling.endAt).toISOString() : null,
    priority: Number.isFinite(Number(popup?.priority)) ? Number(popup.priority) : 100
  };
}

function sanitizeLeadField(value, maxLen) {
  const s = String(value || "").trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

async function recordPopupLead(storeId, popupId, payload, meta) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const pid = String(popupId || "").trim();
  if (!pid) throw new ApiError(400, "Invalid popupId", { code: "INVALID_POPUP_ID" });

  const customer = payload && typeof payload === "object" ? payload : {};
  const metaObj = meta && typeof meta === "object" ? meta : {};

  const lead = await PopupLead.create({
    storeId: s,
    popupId: pid,
    customer: {
      name: sanitizeLeadField(customer.name, 120),
      email: sanitizeLeadField(customer.email, 200),
      phone: sanitizeLeadField(customer.phone, 40)
    },
    consent: customer.consent === true,
    meta: {
      pageUrl: sanitizeLeadField(metaObj.pageUrl, 500),
      userAgent: sanitizeLeadField(metaObj.userAgent, 300),
      lang: sanitizeLeadField(metaObj.lang, 40),
      dir: sanitizeLeadField(metaObj.dir, 8)
    }
  });

  return lead;
}

async function listPopupLeads(storeId, popupId, { limit } = {}) {
  const s = String(storeId || "").trim();
  if (!s) throw new ApiError(400, "Invalid storeId", { code: "INVALID_STORE_ID" });
  const pid = String(popupId || "").trim();
  if (!pid) throw new ApiError(400, "Invalid popupId", { code: "INVALID_POPUP_ID" });

  const lim = clampNum(limit, 1, 200, 50);
  const leads = await PopupLead.find({ storeId: s, popupId: pid }).sort({ createdAt: -1, _id: -1 }).limit(lim).lean();
  return Array.isArray(leads) ? leads : [];
}

module.exports = {
  createStorefrontPopup,
  listStorefrontPopups,
  updateStorefrontPopup,
  getStorefrontPopupById,
  deleteStorefrontPopup,
  getActiveStorefrontPopupForStore,
  serializeStorefrontPopupForStorefront,
  recordPopupLead,
  listPopupLeads
};
