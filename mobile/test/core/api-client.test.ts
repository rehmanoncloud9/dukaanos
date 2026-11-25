const mockGetAccessToken = jest.fn<Promise<string | null>, []>(async () => "tok-initial");
const mockRefreshSession = jest.fn();

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

jest.mock("@/core/config", () => ({
  configStatus: {
    configured: true,
    config: {
      apiUrl: "https://api.dukaanos.test",
      supabaseUrl: "https://sb.dukaanos.test",
      supabaseAnonKey: "anon-key-123456",
      ed25519PublicKey: "a".repeat(64),
    },
    errors: [],
  },
}));

jest.mock("@/core/auth/supabase", () => ({
  supabaseConfigured: () => true,
  getAccessToken: () => mockGetAccessToken(),
  mobileSupabase: () => ({
    auth: {
      refreshSession: mockRefreshSession,
    },
  }),
}));

import {
  ApiError,
  apiClient,
  friendlyApiError,
  registerApiAuthHandlers,
  setApiOfflineDetector,
  setApiShopId,
} from "@/core/api/client";

describe("mobile API client", () => {
  const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");

  beforeEach(() => {
    setApiShopId("shop-123");
    setApiOfflineDetector(() => false);
    registerApiAuthHandlers({});
    mockGetAccessToken.mockResolvedValue("tok-initial");
    mockRefreshSession.mockReset();
    Object.defineProperty(globalThis, "fetch", {
      value: jest.fn(),
      writable: true,
      configurable: true,
    });
  });

  afterAll(() => {
    if (originalFetchDescriptor) {
      Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
    }
  });

  it("sends x-client, Authorization, and x-shop-id headers", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await apiClient.chain();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.dukaanos.test/api/shop/chain");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-client"]).toBe("dukaanos-mobile/1.0.0 (android)");
    expect(headers.authorization).toBe("Bearer tok-initial");
    expect(headers["x-shop-id"]).toBe("shop-123");
  });

  it("maps error envelopes to ApiError and does not automatically retry failed POST writes", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "UDHAAR_REQUIRES_CUSTOMER",
            message: "Customer is required for udhaar",
          },
        }),
        { status: 422 },
      ),
    );

    let caught: unknown;
    try {
      await apiClient.commit({
        idempotency_key: "sale-key-1",
        customer_id: null,
        lines: [],
        discount_paisa: 0,
        cash_paid_paisa: 0,
        audit_meta: {},
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("UDHAAR_REQUIRES_CUSTOMER");
    expect((caught as ApiError).status).toBe(422);
    expect(friendlyApiError(caught)).toContain("Udhaar ke liye customer chunein");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes the session once on 401 and replays the request, or triggers onAuthExpired", async () => {
    mockRefreshSession.mockResolvedValueOnce({
      data: { session: { access_token: "tok-fresh" } },
      error: null,
    });
    mockGetAccessToken
      .mockResolvedValueOnce("tok-expired")
      .mockResolvedValueOnce("tok-fresh");

    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Expired" } }), { status: 401 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await apiClient.shops();
    expect(res).toEqual({ ok: true });
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const onExpired = jest.fn();
    registerApiAuthHandlers({ onAuthExpired: onExpired });
    mockRefreshSession.mockResolvedValueOnce({ data: { session: null }, error: new Error("invalid") });
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Bad" } }), { status: 401 }),
    );

    await expect(apiClient.shops()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("fails immediately with OFFLINE without calling fetch when offline detector is true", async () => {
    setApiOfflineDetector(() => true);
    await expect(apiClient.pulse()).rejects.toMatchObject({ code: "OFFLINE", network: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
