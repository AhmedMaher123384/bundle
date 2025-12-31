jest.mock("../src/models/CartCoupon", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateMany: jest.fn()
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
    createCoupon.mockReset();
  });

  test("creates coupon when evaluation has discount and matched products", async () => {
    CartCoupon.findOne.mockResolvedValueOnce(null);
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    createCoupon.mockResolvedValue({ data: { id: 123 } });
    CartCoupon.findOneAndUpdate.mockImplementation(async (_q, doc) => ({
      _id: "cc1",
      couponId: String(doc?.$set?.couponId || ""),
      code: String(doc?.$set?.code || ""),
      status: String(doc?.$set?.status || ""),
      sallaType: String(doc?.$set?.sallaType || ""),
      discountAmount: Number(doc?.$set?.discountAmount || 0),
      includeProductIds: doc?.$set?.includeProductIds || []
    }));

    const { issueOrReuseCouponForCart } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };

    const evaluationResult = {
      applied: {
        totalDiscount: 10,
        matchedProductIds: ["101", "202"]
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
    expect(record.code.length).toBeLessThanOrEqual(16);
    expect(record.status).toBe("issued");
    expect(record.discountAmount).toBe(10);
    expect(record.includeProductIds).toEqual([]);
    expect(createCoupon).toHaveBeenCalledTimes(1);
    const payload = createCoupon.mock.calls[0]?.[2] || null;
    expect(payload && payload.include_product_ids).toBeUndefined();
    expect(CartCoupon.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test("uses percentage coupon when applied rule is percentage", async () => {
    CartCoupon.findOne.mockResolvedValueOnce(null);
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    createCoupon.mockResolvedValue({ data: { id: 123 } });
    CartCoupon.findOneAndUpdate.mockImplementation(async (_q, doc) => ({
      _id: "cc1",
      couponId: String(doc?.$set?.couponId || ""),
      code: String(doc?.$set?.code || ""),
      status: String(doc?.$set?.status || ""),
      sallaType: String(doc?.$set?.sallaType || ""),
      discountAmount: Number(doc?.$set?.discountAmount || 0),
      includeProductIds: doc?.$set?.includeProductIds || []
    }));

    const { issueOrReuseCouponForCart } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };

    const evaluationResult = {
      applied: {
        totalDiscount: 25.5,
        matchedProductIds: ["101", "202"],
        rule: { type: "percentage", value: 20 }
      }
    };

    const record = await issueOrReuseCouponForCart(config, merchant, "accessToken", [{ variantId: "v1", quantity: 1 }], evaluationResult, {
      ttlHours: 24
    });

    expect(record.status).toBe("issued");
    const payload = createCoupon.mock.calls[0]?.[2] || null;
    expect(payload && payload.type).toBe("fixed");
    expect(payload && payload.amount).toBe(25.5);
    expect(payload && payload.include_product_ids).toBeUndefined();
  });

  test("reissues when existing coupon scope differs from desired scope", async () => {
    const existing = {
      _id: "cc-existing",
      code: "BEXISTINGCODE000",
      status: "issued",
      sallaType: "fixed",
      discountAmount: 10,
      includeProductIds: ["101", "202"],
      save: jest.fn().mockResolvedValue(undefined)
    };
    CartCoupon.findOne.mockResolvedValueOnce(existing);
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    createCoupon.mockResolvedValue({ data: { id: 123 } });
    CartCoupon.findOneAndUpdate.mockImplementation(async (_q, doc) => ({
      _id: "cc1",
      couponId: String(doc?.$set?.couponId || ""),
      code: String(doc?.$set?.code || ""),
      status: String(doc?.$set?.status || ""),
      sallaType: String(doc?.$set?.sallaType || ""),
      discountAmount: Number(doc?.$set?.discountAmount || 0),
      includeProductIds: doc?.$set?.includeProductIds || []
    }));

    const { issueOrReuseCouponForCart } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };
    const evaluationResult = {
      applied: { totalDiscount: 10, matchedProductIds: ["101", "202"], rule: { type: "percentage", value: 20 } }
    };

    const record = await issueOrReuseCouponForCart(config, merchant, "accessToken", [{ variantId: "v1", quantity: 1 }], evaluationResult, {
      ttlHours: 24
    });

    expect(record).not.toBe(existing);
    expect(createCoupon).toHaveBeenCalledTimes(1);
    const payload = createCoupon.mock.calls[0]?.[2] || null;
    expect(payload && payload.type).toBe("fixed");
  });

  test("reissues when existing coupon type differs from desired type", async () => {
    const existing = {
      _id: "cc-existing",
      code: "BEXISTINGCODE000",
      status: "issued",
      sallaType: "percentage",
      discountAmount: 25.5,
      includeProductIds: ["101", "202"],
      save: jest.fn().mockResolvedValue(undefined)
    };
    CartCoupon.findOne.mockResolvedValueOnce(existing);
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    createCoupon.mockResolvedValue({ data: { id: 123 } });
    CartCoupon.findOneAndUpdate.mockImplementation(async (_q, doc) => ({
      _id: "cc1",
      couponId: String(doc?.$set?.couponId || ""),
      code: String(doc?.$set?.code || ""),
      status: String(doc?.$set?.status || ""),
      sallaType: String(doc?.$set?.sallaType || ""),
      discountAmount: Number(doc?.$set?.discountAmount || 0),
      includeProductIds: doc?.$set?.includeProductIds || []
    }));

    const { issueOrReuseCouponForCart } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };
    const evaluationResult = {
      applied: { totalDiscount: 25.5, matchedProductIds: ["101", "202"], rule: { type: "percentage", value: 20 } }
    };

    const record = await issueOrReuseCouponForCart(config, merchant, "accessToken", [{ variantId: "v1", quantity: 1 }], evaluationResult, {
      ttlHours: 24
    });

    expect(record).not.toBe(existing);
    expect(createCoupon).toHaveBeenCalledTimes(1);
    const payload = createCoupon.mock.calls[0]?.[2] || null;
    expect(payload && payload.type).toBe("fixed");
  });

  test("reissues coupon when existing coupon is missing sallaType", async () => {
    const existing = {
      _id: "cc-existing",
      code: "BEXISTINGCODE000",
      status: "issued",
      discountAmount: 10,
      includeProductIds: ["101", "202"],
      save: jest.fn().mockResolvedValue(undefined)
    };
    CartCoupon.findOne.mockResolvedValueOnce(existing);
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    createCoupon.mockResolvedValue({ data: { id: 123 } });
    CartCoupon.findOneAndUpdate.mockImplementation(async (_q, doc) => ({
      _id: "cc1",
      couponId: String(doc?.$set?.couponId || ""),
      code: String(doc?.$set?.code || ""),
      status: String(doc?.$set?.status || ""),
      sallaType: String(doc?.$set?.sallaType || ""),
      discountAmount: Number(doc?.$set?.discountAmount || 0),
      includeProductIds: doc?.$set?.includeProductIds || []
    }));

    const { issueOrReuseCouponForCart } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };
    const evaluationResult = { applied: { totalDiscount: 10, matchedProductIds: ["101", "202"] } };

    const record = await issueOrReuseCouponForCart(config, merchant, "accessToken", [{ variantId: "v1", quantity: 1 }], evaluationResult, {
      ttlHours: 24
    });

    expect(record.status).toBe("issued");
    expect(createCoupon).toHaveBeenCalledTimes(1);
    const payload = createCoupon.mock.calls[0]?.[2] || null;
    expect(payload && payload.type).toBe("fixed");
  });
});
