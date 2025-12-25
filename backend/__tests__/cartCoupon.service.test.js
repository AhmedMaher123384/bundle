jest.mock("../src/models/CartCoupon", () => ({
  findOne: jest.fn(),
  create: jest.fn(),
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
    CartCoupon.create.mockReset();
    CartCoupon.updateMany.mockReset();
    createCoupon.mockReset();
  });

  test("creates coupon when evaluation has discount and matched products", async () => {
    CartCoupon.findOne.mockResolvedValueOnce(null);
    CartCoupon.findOne.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) });
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    createCoupon.mockResolvedValue({ data: { id: 123 } });
    CartCoupon.create.mockImplementation(async (doc) => doc);

    const { issueOrReuseCouponForCart } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };

    const evaluationResult = {
      applied: {
        totalDiscount: 10,
        matchedProductIds: ["p1", "p2"]
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

    expect(record.code.startsWith("BNDL")).toBe(true);
    expect(record.status).toBe("issued");
    expect(record.discountAmount).toBe(10);
    expect(record.includeProductIds.sort()).toEqual(["p1", "p2"]);
    expect(createCoupon).toHaveBeenCalledTimes(1);
    expect(CartCoupon.create).toHaveBeenCalledTimes(1);
  });
});
