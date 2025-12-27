jest.mock("../src/models/AnnouncementBanner", () => ({
  find: jest.fn()
}));

const AnnouncementBanner = require("../src/models/AnnouncementBanner");

describe("announcementBanner.service.getActiveAnnouncementBannerForStore", () => {
  beforeEach(() => {
    AnnouncementBanner.find.mockReset();
  });

  test("returns null when no candidates exist", async () => {
    AnnouncementBanner.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([])
      })
    });

    const { getActiveAnnouncementBannerForStore } = require("../src/services/announcementBanner.service");
    const res = await getActiveAnnouncementBannerForStore("s1", { page: "all" });
    expect(res).toBeNull();
  });

  test("filters out banners outside schedule window", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const now = new Date();
    AnnouncementBanner.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: "b1", storeId: "s1", status: "active", scheduling: { startAt: future }, priority: 1, updatedAt: now },
          { _id: "b2", storeId: "s1", status: "active", scheduling: { startAt: null }, priority: 2, updatedAt: now }
        ])
      })
    });

    const { getActiveAnnouncementBannerForStore } = require("../src/services/announcementBanner.service");
    const res = await getActiveAnnouncementBannerForStore("s1", { page: "all" });
    expect(res?._id).toBe("b2");
  });

  test("queries storeId and allows showOn all + page target", async () => {
    AnnouncementBanner.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([])
      })
    });

    const { getActiveAnnouncementBannerForStore } = require("../src/services/announcementBanner.service");
    await getActiveAnnouncementBannerForStore("s_store", { page: "cart" });
    expect(AnnouncementBanner.find).toHaveBeenCalledTimes(1);
    expect(AnnouncementBanner.find.mock.calls[0][0]).toMatchObject({
      storeId: "s_store",
      status: "active",
      deletedAt: null
    });
    expect(AnnouncementBanner.find.mock.calls[0][0].$or).toEqual([{ "targeting.showOn": "all" }, { "targeting.showOn": "cart" }]);
  });
});

