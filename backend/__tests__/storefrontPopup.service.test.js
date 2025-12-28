jest.mock("../src/models/StorefrontPopup", () => ({
  find: jest.fn()
}));

const StorefrontPopup = require("../src/models/StorefrontPopup");

describe("storefrontPopup.service.getActiveStorefrontPopupForStore", () => {
  beforeEach(() => {
    StorefrontPopup.find.mockReset();
  });

  test("returns null when no candidates exist", async () => {
    StorefrontPopup.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([])
      })
    });

    const { getActiveStorefrontPopupForStore } = require("../src/services/storefrontPopup.service");
    const res = await getActiveStorefrontPopupForStore("s1", { page: "all" });
    expect(res).toBeNull();
  });

  test("filters out popups outside schedule window", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const now = new Date();
    StorefrontPopup.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: "p1", storeId: "s1", status: "active", scheduling: { startAt: future }, priority: 1, updatedAt: now },
          { _id: "p2", storeId: "s1", status: "active", scheduling: { startAt: null }, priority: 2, updatedAt: now }
        ])
      })
    });

    const { getActiveStorefrontPopupForStore } = require("../src/services/storefrontPopup.service");
    const res = await getActiveStorefrontPopupForStore("s1", { page: "all" });
    expect(res?._id).toBe("p2");
  });

  test("queries storeId and allows showOn all + page target", async () => {
    StorefrontPopup.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([])
      })
    });

    const { getActiveStorefrontPopupForStore } = require("../src/services/storefrontPopup.service");
    await getActiveStorefrontPopupForStore("s_store", { page: "home" });
    expect(StorefrontPopup.find).toHaveBeenCalledTimes(1);
    expect(StorefrontPopup.find.mock.calls[0][0]).toMatchObject({
      storeId: "s_store",
      status: "active",
      deletedAt: null
    });
    expect(StorefrontPopup.find.mock.calls[0][0].$or).toEqual([{ "targeting.showOn": "all" }, { "targeting.showOn": "home" }]);
  });
});

