const mountBundle = require("../src/storefront/snippet/features/bundle/bundle.mount");
const { readSnippetCss } = require("../src/storefront/snippet/styles");

describe("storefront bundle snippet", () => {
  test("does not include coupon application logic in snippet", () => {
    const css = readSnippetCss();
    const ctx = {
      parts: [],
      merchantId: "m1",
      token: "t1",
      cssBase: css.cssBase,
      cssPickers: css.cssPickers,
      cssTraditional: css.cssTraditional
    };

    mountBundle(ctx);
    const snippet = ctx.parts.join("");

    expect(snippet).toMatch(/\/api\/proxy\/bundles\/apply/);
    expect(snippet).not.toMatch(/addCoupon\(/);
  });
});
