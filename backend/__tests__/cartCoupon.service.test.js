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
    expect(record.includeProductIds.sort()).toEqual(["101", "202"]);
    expect(createCoupon).toHaveBeenCalledTimes(1);
    expect(createCoupon).toHaveBeenCalledWith(
      config.salla,
      "accessToken",
      expect.objectContaining({ include_product_ids: ["101", "202"] })
    );
    expect(CartCoupon.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
