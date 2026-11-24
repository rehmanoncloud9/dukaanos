import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError, errorResponse } from "@/lib/api/http";
import { clearAuthCacheForTests, requireUser } from "@/lib/server/auth";

const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    adminClient: () => ({
      auth: {
        getUser: mockGetUser,
      },
    }),
  };
});

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

describe("requireUser JWT validation", () => {
  beforeEach(() => {
    clearAuthCacheForTests();
    mockGetUser.mockReset();
  });

  it("rejects missing Authorization header with 401 AUTH_REQUIRED", async () => {
    const req = new Request("http://localhost:3000/api/shop/state");
    await expect(requireUser(req)).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
  });

  it("rejects expired JWT locally before hitting Supabase", async () => {
    const expired = makeJwt({ sub: "u1", exp: Math.floor(Date.now() / 1000) - 60 });
    const req = new Request("http://localhost:3000/api/shop/state", {
      headers: { authorization: `Bearer ${expired}` },
    });
    await expect(requireUser(req)).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("rejects forged token when Supabase getUser returns error", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "invalid JWT" } });
    const forged = makeJwt({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 3600 });
    const req = new Request("http://localhost:3000/api/shop/state", {
      headers: { authorization: `Bearer ${forged}` },
    });
    await expect(requireUser(req)).rejects.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
  });

  it("caches valid user for <= 60s", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const valid = makeJwt({ sub: "user-123", iat, exp: iat + 3600 });
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-123" } }, error: null });
    const req = new Request("http://localhost:3000/api/shop/state", {
      headers: { authorization: `Bearer ${valid}` },
    });

    const u1 = await requireUser(req);
    const u2 = await requireUser(req);
    expect(u1.userId).toBe("user-123");
    expect(u2.userId).toBe("user-123");
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });
});

describe("errorResponse production hygiene", () => {
  it("strips internal details in production", async () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      const res = errorResponse(new ApiError("DB_ERROR", "relation public.secret_table does not exist", "hint", 500), "req-1");
      expect(res.status).toBe(500);
      expect(res.headers.get("x-request-id")).toBe("req-1");
      const json = (await res.json()) as { error: { code: string; message: string; details: unknown } };
      expect(json.error.code).toBe("DB_ERROR");
      expect(json.error.message).not.toContain("secret_table");
      expect(json.error.details).toBeNull();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
  });
});
