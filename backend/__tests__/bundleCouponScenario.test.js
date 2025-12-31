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

describe("Bundle-Specific Coupon Logic - Real Scenario", () => {
  beforeEach(() => {
    CartCoupon.findOne.mockReset();
    CartCoupon.findOneAndUpdate.mockReset();
    CartCoupon.updateMany.mockReset();
    CartCoupon.create.mockReset();
    createCoupon.mockReset();
  });

  test("prevents 30% coupon from being replaced by 10% coupon when adding second bundle", async () => {
    // Mock no existing coupons (fresh cart)
    CartCoupon.findOne.mockResolvedValue(null);
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    
    // Mock successful coupon creation
    createCoupon
      .mockResolvedValueOnce({ data: { id: 123, code: "BUNDLE30" } })
      .mockResolvedValueOnce({ data: { id: 124, code: "BUNDLE10" } });
    
    // Mock coupon record creation
    CartCoupon.create.mockImplementation(async (doc) => ({
      _id: `cc_${doc.bundleId}`,
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

    // Scenario: Two bundles with different discounts
    const evaluationResult = {
      applied: {
        totalDiscount: 40,
        bundles: [
          {
            bundleId: "bundle1",
            discountAmount: 30,
            matchedProductIds: ["101", "102"], // First bundle products
            appliedRules: [{ type: "percentage", value: 30 }]
          },
          {
            bundleId: "bundle2", 
            discountAmount: 10,
            matchedProductIds: ["201", "202"], // Second bundle products
            appliedRules: [{ type: "percentage", value: 10 }]
          }
        ]
      }
    };

    const cartItems = [
      { variantId: "v1", quantity: 1 }, // Product 101
      { variantId: "v2", quantity: 1 }, // Product 102
      { variantId: "v3", quantity: 1 }, // Product 201
      { variantId: "v4", quantity: 1 }  // Product 202
    ];

    const bundleCoupons = await issueOrReuseBundleSpecificCoupons(
      config,
      merchant,
      "accessToken",
      cartItems,
      evaluationResult,
      { ttlHours: 24 }
    );

    // Verify both coupons are created (no replacement)
    expect(bundleCoupons).toHaveLength(2);
    expect(bundleCoupons[0].bundleId).toBe("bundle1");
    expect(bundleCoupons[0].coupon.discountAmount).toBe(30);
    expect(bundleCoupons[1].bundleId).toBe("bundle2");
    expect(bundleCoupons[1].coupon.discountAmount).toBe(10);

    // Verify both coupons have separate product scopes
    expect(bundleCoupons[0].coupon.includeProductIds).toEqual(["101", "102"]);
    expect(bundleCoupons[1].coupon.includeProductIds).toEqual(["201", "202"]);

    // Verify no overlap in product IDs
    const bundle1Products = new Set(bundleCoupons[0].coupon.includeProductIds);
    const bundle2Products = new Set(bundleCoupons[1].coupon.includeProductIds);
    const overlap = [...bundle1Products].filter(id => bundle2Products.has(id));
    expect(overlap).toHaveLength(0);

    // Verify both coupons were created (not replaced)
    expect(CartCoupon.create).toHaveBeenCalledTimes(2);
    expect(createCoupon).toHaveBeenCalledTimes(2);
  });

  test("each coupon only applies to its specific bundle products, not entire cart", async () => {
    CartCoupon.findOne.mockResolvedValue(null);
    CartCoupon.updateMany.mockResolvedValue({ modifiedCount: 0 });
    createCoupon.mockResolvedValue({ data: { id: 125, code: "BUNDLE25" } });
    
    CartCoupon.create.mockImplementation(async (doc) => ({
      _id: `cc_${doc.bundleId}`,
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

    // Scenario: Bundle with regular products mixed in cart
    const evaluationResult = {
      applied: {
        totalDiscount: 25,
        bundles: [
          {
            bundleId: "bundle1",
            discountAmount: 25,
            matchedProductIds: ["101", "102"], // Only bundle products
            appliedRules: [{ type: "percentage", value: 25 }]
          }
        ]
      }
    };

    // Cart contains both bundle products and regular products
    const cartItems = [
      { variantId: "v1", quantity: 1 }, // Product 101 - bundle product
      { variantId: "v2", quantity: 1 }, // Product 102 - bundle product
      { variantId: "v3", quantity: 1 }, // Product 301 - regular product (no discount)
      { variantId: "v4", quantity: 1 }  // Product 401 - regular product (no discount)
    ];

    const bundleCoupons = await issueOrReuseBundleSpecificCoupons(
      config,
      merchant,
      "accessToken",
      cartItems,
      evaluationResult,
      { ttlHours: 24 }
    );

    expect(bundleCoupons).toHaveLength(1);
    const coupon = bundleCoupons[0].coupon;
    
    // Verify coupon only includes bundle products, not entire cart
    expect(coupon.includeProductIds).toEqual(["101", "102"]);
    expect(coupon.includeProductIds).not.toContain("301");
    expect(coupon.includeProductIds).not.toContain("401");
    
    // Verify discount only applies to bundle amount
    expect(coupon.discountAmount).toBe(25);
  });

  test("reuses existing coupons instead of creating duplicates", async () => {
    // Mock existing coupon for bundle1
    const existingCoupon = {
      _id: "existing1",
      code: "EXISTING30",
      discountAmount: 30,
      includeProductIds: ["101", "102"],
      bundleId: "bundle1",
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

    const cartItems = [{ variantId: "v1", quantity: 1 }];

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
    expect(bundleCoupons[0].coupon.code).toBe("EXISTING30");

    // Verify no new coupon was created
    expect(createCoupon).not.toHaveBeenCalled();
    expect(CartCoupon.create).not.toHaveBeenCalled();
  });
});