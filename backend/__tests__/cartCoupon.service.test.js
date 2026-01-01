jest.mock("../src/models/CartCoupon", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateMany: jest.fn(),
  create: jest.fn()
}));

jest.mock("../src/services/sallaApi.service", () => ({
  createCoupon: jest.fn()
}));

const CartCoupon = require("../src/models/CartCoupon");
const { createCoupon } = require("../src/services/sallaApi.service");

describe("cartCoupon.service.issueOrReuseCouponForCart", () => {
  beforeEach(() => {
    CartCoupon.findOne.mockReset();
    CartCoupon.findOneAndUpdate.mockReset();
    CartCoupon.updateMany.mockReset();
    CartCoupon.create.mockReset();
    createCoupon.mockReset();
  });

  test("creates coupon when evaluation has discount and matched products", async () => {
    CartCoupon.findOne.mockReturnValueOnce({ sort: jest.fn().mockResolvedValue(null) });
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    createCoupon.mockResolvedValue({ data: { id: 123 } });
    CartCoupon.create.mockImplementation(async (doc) => ({ _id: "cc1", ...doc }));

    const { issueOrReuseCouponForCart } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };

    const evaluationResult = {
      applied: {
        matchedProductIds: ["101", "202"],
        bundles: [{ bundleId: "b-1", discountAmount: 10 }]
      }
    };

    const record = await issueOrReuseCouponForCart(
      config,
      merchant,
      "accessToken",
      [
        { variantId: "v1", quantity: 1 },
        { variantId: "v2", quantity: 2 }
      ],
      evaluationResult,
      { ttlHours: 24 }
    );

    expect(record.code.startsWith("B")).toBe(true);
    expect(record.code.length).toBe(11);
    expect(record.status).toBe("issued");
    expect(record.discountAmount).toBe(10);
    expect(record.includeProductIds.sort()).toEqual(["101", "202"]);
    expect(createCoupon).toHaveBeenCalledTimes(1);
    const payload = createCoupon.mock.calls[0]?.[2] || null;
    expect(payload && payload.include_product_ids).toEqual(["101", "202"]);
    expect(CartCoupon.create).toHaveBeenCalledTimes(1);
  });

  test("uses fixed coupon even when applied rule is percentage", async () => {
    CartCoupon.findOne.mockReturnValueOnce({ sort: jest.fn().mockResolvedValue(null) });
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    createCoupon.mockResolvedValue({ data: { id: 123 } });
    CartCoupon.create.mockImplementation(async (doc) => ({ _id: "cc1", ...doc }));

    const { issueOrReuseCouponForCart } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };

    const evaluationResult = {
      applied: {
        matchedProductIds: ["101", "202"],
        rule: { type: "percentage", value: 20 },
        bundles: [{ bundleId: "b-1", discountAmount: 25.5 }]
      }
    };

    const record = await issueOrReuseCouponForCart(config, merchant, "accessToken", [{ variantId: "v1", quantity: 1 }], evaluationResult, {
      ttlHours: 24
    });

    expect(record.status).toBe("issued");
    const payload = createCoupon.mock.calls[0]?.[2] || null;
    expect(payload && payload.type).toBe("fixed");
  });

  test("reuses existing coupon when applied bundles match", async () => {
    const existing = {
      _id: "cc-existing",
      code: "BEXISTINGCODE000",
      status: "issued",
      sallaType: "fixed",
      discountAmount: 10,
      appliedBundleIds: ["b-1"],
      includeProductIds: ["101", "202"],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined)
    };
    CartCoupon.findOne.mockReturnValueOnce({ sort: jest.fn().mockResolvedValue(existing) });
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });

    const { issueOrReuseCouponForCart } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };
    const evaluationResult = {
      applied: { matchedProductIds: ["101", "202"], rule: { type: "percentage", value: 20 }, bundles: [{ bundleId: "b-1", discountAmount: 10 }] }
    };

    const record = await issueOrReuseCouponForCart(config, merchant, "accessToken", [{ variantId: "v1", quantity: 1 }], evaluationResult, {
      ttlHours: 24,
      cartKey: "ck-1"
    });

    expect(record).toBe(existing);
    expect(createCoupon).toHaveBeenCalledTimes(0);
    expect(CartCoupon.create).toHaveBeenCalledTimes(0);
  });

  test("reissues coupon when new bundle is added", async () => {
    const existing = {
      _id: "cc-existing",
      code: "BEXISTINGCODE000",
      status: "issued",
      discountAmount: 10,
      includeProductIds: ["101", "202"],
      appliedBundleIds: ["b-1"],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined)
    };
    CartCoupon.findOne.mockReturnValueOnce({ sort: jest.fn().mockResolvedValue(existing) });
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    createCoupon.mockResolvedValue({ data: { id: 123 } });
    CartCoupon.create.mockImplementation(async (doc) => ({ _id: "cc1", ...doc }));

    const { issueOrReuseCouponForCart } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };
    const evaluationResult = { applied: { matchedProductIds: ["101", "202"], bundles: [{ bundleId: "b-1", discountAmount: 10 }, { bundleId: "b-2", discountAmount: 5 }] } };

    const record = await issueOrReuseCouponForCart(config, merchant, "accessToken", [{ variantId: "v1", quantity: 1 }], evaluationResult, {
      ttlHours: 24,
      cartKey: "ck-1"
    });

    expect(record.status).toBe("issued");
    expect(createCoupon).toHaveBeenCalledTimes(1);
    const payload = createCoupon.mock.calls[0]?.[2] || null;
    expect(payload && payload.type).toBe("fixed");
    expect(record.discountAmount).toBe(15);
  });
});
