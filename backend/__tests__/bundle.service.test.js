jest.mock("../src/models/Bundle", () => ({
  find: jest.fn()
}));

jest.mock("../src/models/Log", () => ({
  create: jest.fn()
}));

const Bundle = require("../src/models/Bundle");
const Log = require("../src/models/Log");

describe("bundle.service.evaluateBundles", () => {
  beforeEach(() => {
    Bundle.find.mockReset();
    Log.create.mockReset();
  });

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

  test("supports product refs (product:ID) to match any variant of the product", async () => {
    const bundleDoc = {
      _id: "b_product_ref",
      merchantId: "m1",
      status: "active",
      name: "Product Ref Bundle",
      components: [
        { variantId: "product:p1", quantity: 1, group: "A" },
        { variantId: "product:p2", quantity: 1, group: "B" }
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
      ["v1_red", { variantId: "v1_red", productId: "p1", price: 100, isActive: true }],
      ["v2", { variantId: "v2", productId: "p2", price: 50, isActive: true }]
    ]);

    const { evaluateBundles } = require("../src/services/bundle.service");

    const result = await evaluateBundles(
      { _id: "merchantObjectId", merchantId: "m1" },
      [
        { variantId: "v1_red", quantity: 1 },
        { variantId: "v2", quantity: 1 }
      ],
      variantSnapshotById
    );

    expect(result.applied.totalDiscount).toBe(15);
    expect(result.applied.matchedProductIds.sort()).toEqual(["p1", "p2"]);
    expect(result.applied.bundles).toHaveLength(1);
  });

  test("product ref allocates discount to highest priced variants first", async () => {
    const bundleDoc = {
      _id: "b_product_ref_price",
      merchantId: "m1",
      status: "active",
      name: "Product Ref (price)",
      components: [{ variantId: "product:p1", quantity: 1, group: "A" }],
      rules: {
        type: "percentage",
        value: 10,
        eligibility: { mustIncludeAllGroups: true, minCartQty: 1 },
        limits: { maxUsesPerOrder: 1 }
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
      ["v1_cheap", { variantId: "v1_cheap", productId: "p1", price: 10, isActive: true }],
      ["v1_exp", { variantId: "v1_exp", productId: "p1", price: 100, isActive: true }]
    ]);

    const { evaluateBundles } = require("../src/services/bundle.service");

    const result = await evaluateBundles(
      { _id: "merchantObjectId", merchantId: "m1" },
      [
        { variantId: "v1_cheap", quantity: 1 },
        { variantId: "v1_exp", quantity: 1 }
      ],
      variantSnapshotById
    );

    expect(result.applied.totalDiscount).toBe(10);
    expect(result.applied.matchedProductIds.sort()).toEqual(["p1"]);
    expect(result.applied.bundles).toHaveLength(1);
    expect(result.applied.bundles[0].matchedVariants).toEqual(["v1_exp"]);
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

  test("applies multiple bundles for the same trigger product id", async () => {
    const bundleA = {
      _id: "b_a",
      merchantId: "m1",
      status: "active",
      triggerProductId: "p_trigger",
      name: "A",
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

    const bundleB = {
      _id: "b_b",
      merchantId: "m1",
      status: "active",
      triggerProductId: "p_trigger",
      name: "B",
      components: [
        { variantId: "v1", quantity: 1, group: "A" },
        { variantId: "v2", quantity: 1, group: "B" }
      ],
      rules: {
        type: "fixed",
        value: 20,
        eligibility: { mustIncludeAllGroups: true, minCartQty: 2 },
        limits: { maxUsesPerOrder: 10 }
      },
      toObject() {
        return { ...this };
      }
    };

    Bundle.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([bundleA, bundleB])
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

    expect(result.applied.totalDiscount).toBe(35);
    expect(result.applied.bundles).toHaveLength(2);
    expect(result.applied.bundles.map((b) => b.bundleId).sort()).toEqual(["b_a", "b_b"]);
    expect(Log.create).toHaveBeenCalledTimes(2);
  });
});
