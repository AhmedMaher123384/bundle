const { renderThemeCustomAppSlotView } = require("./themeCustomAppSlot.view");

const themeCustomAppSlotExtension = {
  key: "theme_custom_app_slot",
  hook: "theme:custom_app_slot",
  method: "GET",
  path: "/api/storefront/extensions/theme-custom-app-slot",
  render: renderThemeCustomAppSlotView
};

module.exports = {
  themeCustomAppSlotExtension
};

