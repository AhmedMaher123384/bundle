jest.mock("../src/models/WebhookLog", () => ({
  findOne: jest.fn(),
  create: jest.fn()
}));

jest.mock("../src/models/AuditSnapshot", () => ({
  create: jest.fn()
}));

jest.mock("../src/services/merchant.service", () => ({
  findMerchantByMerchantId: jest.fn(),
  markMerchantUninstalled: jest.fn(),
  upsertInstalledMerchant: jest.fn()
}));

jest.mock("../src/services/cartCoupon.service", () => ({
  issueOrReuseCouponForCart: jest.fn(),
  extractCouponCodeFromOrderPayload: jest.fn(),
  extractOrderId: jest.fn(),
  markCouponRedeemed: jest.fn()
}));

jest.mock("../src/services/sallaApi.service", () => ({
  getOrderById: jest.fn()
}));

jest.mock("../src/services/sallaOAuth.service", () => ({
  refreshAccessToken: jest.fn()
}));

const WebhookLog = require("../src/models/WebhookLog");
const AuditSnapshot = require("../src/models/AuditSnapshot");
const { findMerchantByMerchantId } = require("../src/services/merchant.service");
const { extractCouponCodeFromOrderPayload, extractOrderId, markCouponRedeemed } = require("../src/services/cartCoupon.service");
const { getOrderById } = require("../src/services/sallaApi.service");
const { Buffer } = require("buffer");

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

describe("webhook.controller order.created", () => {
  beforeEach(() => {
    WebhookLog.findOne.mockReset();
    WebhookLog.create.mockReset();
    AuditSnapshot.create.mockReset();
    findMerchantByMerchantId.mockReset();
    extractCouponCodeFromOrderPayload.mockReset();
    extractOrderId.mockReset();
    markCouponRedeemed.mockReset();
    getOrderById.mockReset();

    WebhookLog.create.mockImplementation(async () => ({}));
    AuditSnapshot.create.mockImplementation(async () => ({}));
  });

  test("dedupes by deliveryId and audits coupon mismatch using live order details", async () => {
    const { createWebhookController } = require("../src/controllers/webhook.controller");

    const config = {
      salla: { webhookSecret: "secret", apiBaseUrl: "https://api.salla.dev" },
      security: { tokenRefreshSkewSeconds: 30 }
    };

    const controller = createWebhookController(config);

    WebhookLog.findOne.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) });

    findMerchantByMerchantId.mockResolvedValue({
      _id: "merchantObjectId",
      merchantId: "m-1",
      accessToken: "access",
      refreshToken: "refresh",
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      appStatus: "installed"
    });

    extractCouponCodeFromOrderPayload.mockReturnValue("BNDLTEST");
    extractOrderId.mockReturnValue("O-1");

    markCouponRedeemed.mockResolvedValue({
      code: "BNDLTEST",
      cartHash: "hash",
      discountAmount: 10,
      includeProductIds: ["p1"]
    });

    getOrderById.mockResolvedValue({
      data: {
        amounts: { discounts: [{ code: "BNDLTEST", discount: "5.00" }] },
        items: [{ product: { id: "p2" } }]
      }
    });

    const rawBody = Buffer.from(JSON.stringify({ event: "order.created", merchant: "m-1" }), "utf8");

    const req1 = {
      headers: {
        "x-salla-event": "order.created",
        "x-salla-delivery-id": "d-1",
        "x-salla-security-strategy": "token",
        authorization: "Bearer secret"
      },
      body: rawBody
    };
    const res1 = makeRes();

    await controller.sallaWebhook(req1, res1);

    expect(res1.statusCode).toBe(200);
    expect(res1.body).toEqual({ ok: true });
    expect(markCouponRedeemed).toHaveBeenCalledTimes(1);
    expect(getOrderById).toHaveBeenCalledTimes(1);
    expect(AuditSnapshot.create).toHaveBeenCalled();

    WebhookLog.findOne.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue({ _id: "processedLog" }) });

    const req2 = { ...req1 };
    const res2 = makeRes();
    await controller.sallaWebhook(req2, res2);

    expect(res2.statusCode).toBe(200);
    expect(res2.body).toEqual({ ok: true });
    expect(markCouponRedeemed).toHaveBeenCalledTimes(1);
  });
});
