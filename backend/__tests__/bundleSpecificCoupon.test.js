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

describe("cartCoupon.service.issueOrReuseBundleSpecificCoupons", () => {
  beforeEach(() => {
    CartCoupon.findOne.mockReset();
    CartCoupon.findOneAndUpdate.mockReset();
    CartCoupon.updateMany.mockReset();
    CartCoupon.create.mockReset();
    createCoupon.mockReset();
  });

  test("creates separate coupons for each bundle", async () => {
    // Mock no existing coupons
    CartCoupon.findOne.mockResolvedValue(null);
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    
    // Mock successful coupon creation
    createCoupon.mockResolvedValue({ data: { id: 123, code: "BUNDLE123" } });
    
    // Mock coupon record creation
    CartCoupon.create.mockImplementation(async (doc) => ({
      _id: "cc1",
      merchantId: doc.merchantId,
      cartHash: doc.cartHash,
      code: doc.code,
      sallaCouponId: doc.sallaCouponId,
      discountAmount: doc.discountAmount,
      discountType: doc.discountType,
      discountValue: doc.discountValue,
      includeProductIds: doc.includeProductIds,
      bundleId: doc.bundleId,
      status: doc.status
    }));

    const { issueOrReuseBundleSpecificCoupons } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };

    // Mock evaluation result with multiple bundles
    const evaluationResult = {
      applied: {
        totalDiscount: 40,
        bundles: [
          {
            bundleId: "bundle1",
            discountAmount: 30,
            matchedProductIds: ["101", "102"],
            appliedRules: [{ type: "percentage", value: 30 }]
          },
          {
            bundleId: "bundle2", 
            discountAmount: 10,
            matchedProductIds: ["201", "202"],
            appliedRules: [{ type: "percentage", value: 10 }]
          }
        ]
      }
    };

    const cartItems = [
      { variantId: "v1", quantity: 2 },
      { variantId: "v2", quantity: 1 }
    ];

    const bundleCoupons = await issueOrReuseBundleSpecificCoupons(
      config,
      merchant,
      "accessToken",
      cartItems,
      evaluationResult,
      { ttlHours: 24 }
    );

    // Verify two separate coupons were created
    expect(bundleCoupons).toHaveLength(2);
    expect(bundleCoupons[0].bundleId).toBe("bundle1");
    expect(bundleCoupons[0].coupon.discountAmount).toBe(30);
    expect(bundleCoupons[1].bundleId).toBe("bundle2");
    expect(bundleCoupons[1].coupon.discountAmount).toBe(10);

    // Verify coupons were created with correct product IDs
    expect(CartCoupon.create).toHaveBeenCalledTimes(2);
    expect(createCoupon).toHaveBeenCalledTimes(2);
  });

  test("handles existing coupons by reusing them", async () => {
    // Mock existing coupon for bundle1
    const existingCoupon = {
      _id: "existing1",
      code: "EXISTING123",
      discountAmount: 30,
      save: jest.fn().mockResolvedValue(true)
    };
    
    CartCoupon.findOne.mockResolvedValue(existingCoupon);
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const { issueOrReuseBundleSpecificCoupons } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };

    const evaluationResult = {
      applied: {
        totalDiscount: 30,
        bundles: [
          {
            bundleId: "bundle1",
            discountAmount: 30,
            matchedProductIds: ["101", "102"],
            appliedRules: [{ type: "percentage", value: 30 }]
          }
        ]
      }
    };

    const cartItems = [{ variantId: "v1", quantity: 2 }];

    const bundleCoupons = await issueOrReuseBundleSpecificCoupons(
      config,
      merchant,
      "accessToken",
      cartItems,
      evaluationResult,
      { ttlHours: 24 }
    );

    // Verify existing coupon was reused
    expect(bundleCoupons).toHaveLength(1);
    expect(bundleCoupons[0].bundleId).toBe("bundle1");
    expect(bundleCoupons[0].reused).toBe(true);
    expect(bundleCoupons[0].coupon.code).toBe("EXISTING123");

    // Verify no new coupon was created
    expect(createCoupon).not.toHaveBeenCalled();
    expect(CartCoupon.create).not.toHaveBeenCalled();
  });

  test("skips bundles with zero discount", async () => {
    CartCoupon.findOne.mockResolvedValue(null);
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    createCoupon.mockResolvedValue({ data: { id: 123, code: "BUNDLE123" } });
    CartCoupon.create.mockImplementation(async (doc) => ({
      _id: "cc1",
      merchantId: doc.merchantId,
      cartHash: doc.cartHash,
      code: doc.code,
      sallaCouponId: doc.sallaCouponId,
      discountAmount: doc.discountAmount,
      discountType: doc.discountType,
      discountValue: doc.discountValue,
      includeProductIds: doc.includeProductIds,
      bundleId: doc.bundleId,
      status: doc.status
    }));

    const { issueOrReuseBundleSpecificCoupons } = require("../src/services/cartCoupon.service");

    const config = { salla: {}, security: {} };
    const merchant = { _id: "mongoMerchantId", merchantId: "storeMerchantId" };

    const evaluationResult = {
      applied: {
        totalDiscount: 30,
        bundles: [
          {
            bundleId: "bundle1",
            discountAmount: 30,
            matchedProductIds: ["101", "102"],
            appliedRules: [{ type: "percentage", value: 30 }]
          },
          {
            bundleId: "bundle2",
            discountAmount: 0, // Zero discount
            matchedProductIds: ["201", "202"],
            appliedRules: [{ type: "percentage", value: 0 }]
          }
        ]
      }
    };

    const cartItems = [{ variantId: "v1", quantity: 2 }];

    const bundleCoupons = await issueOrReuseBundleSpecificCoupons(
      config,
      merchant,
      "accessToken",
      cartItems,
      evaluationResult,
      { ttlHours: 24 }
    );

    // Verify only one coupon was created (for bundle1)
    expect(bundleCoupons).toHaveLength(1);
    expect(bundleCoupons[0].bundleId).toBe("bundle1");
    expect(bundleCoupons[0].coupon.discountAmount).toBe(30);

    // Verify only one coupon creation attempt
    expect(CartCoupon.create).toHaveBeenCalledTimes(1);
    expect(createCoupon).toHaveBeenCalledTimes(1);
  });
});