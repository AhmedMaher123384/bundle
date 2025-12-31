const mountBundle = require("../src/storefront/snippet/features/bundle/bundle.mount");
const { readSnippetCss } = require("../src/storefront/snippet/styles");

describe("storefront bundle snippet", () => {
  test("tries applying coupon using object payloads for addCoupon", () => {
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

    expect(snippet).toMatch(/addCoupon\(\{\s*code\s*:\s*c\s*\}\)/);
    expect(snippet).toMatch(/addCoupon\(\{\s*coupon_code\s*:\s*c\s*\}\)/);
    expect(snippet).toMatch(/\/api\/proxy\/cart\/banner/);
  });
});
