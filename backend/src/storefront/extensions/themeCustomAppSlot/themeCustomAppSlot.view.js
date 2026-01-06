function renderThemeCustomAppSlotView(input) {
  const merchantId = String(input?.merchantId || "").trim();
  const storeId = String(input?.storeId || "").trim();

  const mid = merchantId || "unknown";
  const sid = storeId || mid;

  return `
<div class="bundle-app-theme-custom-slot" data-app="bundles-app" data-store-id="${escapeHtmlAttr(sid)}" data-merchant-id="${escapeHtmlAttr(mid)}" dir="rtl">
  <div style="padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff">
    <div style="font-weight:700;font-size:14px;line-height:1.2">تم تفعيل تطبيق Bundles</div>
    <div style="margin-top:6px;font-size:13px;line-height:1.5;color:#374151">ده محتوى HTML متحقن داخل hook: theme:custom_app_slot</div>
  </div>
</div>
`.trim();
}

function escapeHtmlAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

module.exports = {
  renderThemeCustomAppSlotView
};

