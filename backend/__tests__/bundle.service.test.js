jest.mock("../src/models/Bundle", () => ({
  find: jest.fn()
}));

jest.mock("../src/models/Log", () => ({
  create: jest.fn()
}));

const Bundle = require("../src/models/Bundle");
const Log = require("../src/models/Log");

describe("bundle.service.evaluateBundles", () => {
  test("applies percentage discount and returns matched product ids", async () => {
    const bundleDoc = {
      _id: "b1",
      merchantId: "m1",
      status: "active",
      name: "B1",
      components: [
        { variantId: "v1", quantity: 1, group: "A" },
        { variantId: "v2", quantity: 1, group: "B" }
      ],
      rules: {
        type: "percentage",
        value: 10,
        eligibility: { mustIncludeAllGroups: true, minCartQty: 2 },
        limits: { maxUsesPerOrder: 10 }
      },
      toObject() {
        return { ...this };
      }
    };

    Bundle.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([bundleDoc])
      })
    });

    Log.create.mockResolvedValue({});

    const variantSnapshotById = new Map([
      ["v1", { variantId: "v1", productId: "p1", price: 100, isActive: true }],
      ["v2", { variantId: "v2", productId: "p2", price: 50, isActive: true }]
    ]);

    const { evaluateBundles } = require("../src/services/bundle.service");

    const result = await evaluateBundles(
      { _id: "merchantObjectId", merchantId: "m1" },
      [
        { variantId: "v1", quantity: 1 },
        { variantId: "v2", quantity: 1 }
      ],
      variantSnapshotById
    );

    expect(result.applied.totalDiscount).toBe(15);
    expect(result.applied.matchedProductIds.sort()).toEqual(["p1", "p2"]);
    expect(result.applied.bundles).toHaveLength(1);
    expect(Log.create).toHaveBeenCalledTimes(1);
  });

  test("supports tiered quantity discount in a single bundle", async () => {
    const bundleDoc = {
      _id: "b_qty",
      merchantId: "m1",
      status: "active",
      name: "Tiered Qty",
      components: [{ variantId: "v1", quantity: 1, group: "A" }],
      presentation: { coverVariantId: "v1" },
      rules: {
        type: "percentage",
        value: 0,
        tiers: [
          { minQty: 2, type: "percentage", value: 10 },
          { minQty: 3, type: "percentage", value: 30 }
        ],
        eligibility: { mustIncludeAllGroups: true, minCartQty: 1 },
        limits: { maxUsesPerOrder: 10 }
      },
      toObject() {
        return { ...this };
      }
    };

    Bundle.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([bundleDoc])
      })
    });

    Log.create.mockResolvedValue({});

    const variantSnapshotById = new Map([["v1", { variantId: "v1", productId: "p1", price: 100, isActive: true }]]);

    const { evaluateBundles } = require("../src/services/bundle.service");

    const result = await evaluateBundles(
      { _id: "merchantObjectId", merchantId: "m1" },
      [{ variantId: "v1", quantity: 5 }],
      variantSnapshotById
    );

    expect(result.applied.totalDiscount).toBe(110);
    expect(result.applied.matchedProductIds.sort()).toEqual(["p1"]);
    expect(result.applied.bundles).toHaveLength(1);
  });

  test("tiered discount uses a component as base when coverVariantId isn't a component", async () => {
    const bundleDoc = {
      _id: "b_qty_cover_mismatch",
      merchantId: "m1",
      status: "active",
      name: "Tiered Qty (cover mismatch)",
      components: [{ variantId: "v1", quantity: 1, group: "A" }],
      presentation: { coverVariantId: "v_missing" },
      rules: {
        type: "percentage",
        value: 0,
        tiers: [
          { minQty: 2, type: "percentage", value: 10 },
          { minQty: 3, type: "percentage", value: 30 }
        ],
        eligibility: { mustIncludeAllGroups: true, minCartQty: 1 },
        limits: { maxUsesPerOrder: 10 }
      },
      toObject() {
        return { ...this };
      }
    };

    Bundle.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([bundleDoc])
      })
    });

    Log.create.mockResolvedValue({});

    const variantSnapshotById = new Map([["v1", { variantId: "v1", productId: "p1", price: 100, isActive: true }]]);

    const { evaluateBundles } = require("../src/services/bundle.service");

    const result = await evaluateBundles(
      { _id: "merchantObjectId", merchantId: "m1" },
      [{ variantId: "v1", quantity: 5 }],
      variantSnapshotById
    );

    expect(result.applied.totalDiscount).toBe(110);
    expect(result.applied.matchedProductIds.sort()).toEqual(["p1"]);
    expect(result.applied.bundles).toHaveLength(1);
  });

  test("supports bundle_price discount type", async () => {
    const bundleDoc = {
      _id: "b_price",
      merchantId: "m1",
      status: "active",
      name: "Fixed Bundle Price",
      components: [
        { variantId: "v1", quantity: 1, group: "A" },
        { variantId: "v2", quantity: 1, group: "B" }
      ],
      rules: {
        type: "bundle_price",
        value: 120,
        eligibility: { mustIncludeAllGroups: true, minCartQty: 2 },
        limits: { maxUsesPerOrder: 10 }
      },
      toObject() {
        return { ...this };
      }
    };

    Bundle.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([bundleDoc])
      })
    });

    Log.create.mockResolvedValue({});

    const variantSnapshotById = new Map([
      ["v1", { variantId: "v1", productId: "p1", price: 100, isActive: true }],
      ["v2", { variantId: "v2", productId: "p2", price: 50, isActive: true }]
    ]);

    const { evaluateBundles } = require("../src/services/bundle.service");

    const result = await evaluateBundles(
      { _id: "merchantObjectId", merchantId: "m1" },
      [
        { variantId: "v1", quantity: 1 },
        { variantId: "v2", quantity: 1 }
      ],
      variantSnapshotById
    );

    expect(result.applied.totalDiscount).toBe(30);
    expect(result.applied.matchedProductIds.sort()).toEqual(["p1", "p2"]);
    expect(result.applied.bundles).toHaveLength(1);
  });
});
