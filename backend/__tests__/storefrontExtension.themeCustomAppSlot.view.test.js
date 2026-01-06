const { renderThemeCustomAppSlotView } = require("../src/storefront/extensions/themeCustomAppSlot");

describe("storefront extension theme:custom_app_slot", () => {
  test("renders HTML view", () => {
    const html = renderThemeCustomAppSlotView({ merchantId: "m1", storeId: "s1" });
    expect(html).toMatch(/bundle-app-theme-custom-slot/);
    expect(html).toMatch(/theme:custom_app_slot/);
    expect(html).toMatch(/data-store-id="s1"/);
    expect(html).toMatch(/data-merchant-id="m1"/);
  });
});

