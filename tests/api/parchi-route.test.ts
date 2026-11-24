import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { ApiError } from "@/lib/api/http";
import { generateContentOnce } from "@/lib/ai/models";
import { requireShopContext } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { loadCatalog } from "@/lib/api/shop";
import { env } from "@/lib/env";
import { POST } from "@/app/api/parchi/parse/route";
import { demoCatalog } from "../helpers/catalog";

vi.mock("@/lib/server/auth", () => ({ requireShopContext: vi.fn() }));
vi.mock("@/lib/server/ratelimit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/api/shop", () => ({ loadCatalog: vi.fn() }));
vi.mock("@/lib/ai/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/models")>();
  return { ...actual, generateContentOnce: vi.fn() };
});

const catalog = demoCatalog();
const shopId = "00000000-0000-0000-0000-000000000001";

function jpegBytes(extraLen = 16): Uint8Array {
  const bytes = new Uint8Array(3 + extraLen);
  bytes.set([0xff, 0xd8, 0xff], 0);
  return bytes;
}

describe("POST /api/parchi/parse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireShopContext).mockResolvedValue({ sb: {} as never, shopId, userId: "user-1", token: "tok" });
    vi.mocked(enforceRateLimit).mockResolvedValue({ allowed: true, remaining: 4, retry_after: 0 });
    vi.mocked(loadCatalog).mockResolvedValue({ state: {} as never, catalog });
  });

  it("validates JPEG magic bytes, runs zero-tool OCR, and passes shopId for quota", async () => {
    vi.mocked(generateContentOnce).mockResolvedValueOnce({
      response: {
        text: JSON.stringify({
          supplier_name: "Al-Noor Traders",
          bill_date: "2026-11-24",
          lines: [{ name_raw: "Cheeni", quantity_raw: "dhai", unit_raw: "kg", rate_raw: "160", line_total_raw: "400", confidence: 0.95 }],
          bill_total_raw: "400",
          legibility: "good",
        }),
      } as unknown as GenerateContentResponse,
      model: env.fastModel(),
      latency_ms: 35,
      usage: { input_tokens: 1_200, output_tokens: 180, cached_input_tokens: 0, available: true },
      attempts: [{ model: env.fastModel(), ok: true, ms: 35 }],
    });

    const form = new FormData();
    form.set("image", new File([Buffer.from(jpegBytes())], "parchi.jpg", { type: "image/jpeg" }));
    const res = await POST(new Request("http://localhost:3000/api/parchi/parse", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.write_tools_bound).toBe(0);
    expect(json.math_check.passed).toBe(true);
    expect(json.lines[0].qty_base_units).toBe(2500);
    expect(json.lines[0].line_total_paisa).toBe(40_000);
    expect(generateContentOnce).toHaveBeenCalledWith(env.fastModel(), expect.objectContaining({
      config: expect.not.objectContaining({ tools: expect.anything() }),
    }), expect.any(Number), { shopId, kind: "parchi" });
  });

  it("rejects SVG, mismatched image bytes, and empty files", async () => {
    const svgForm = new FormData();
    svgForm.set("image", new File(["<svg></svg>"], "evil.svg", { type: "image/svg+xml" }));
    const resSvg = await POST(new Request("http://localhost:3000/api/parchi/parse", { method: "POST", body: svgForm }));
    expect(resSvg.status).toBe(415);

    const fakeJpg = new FormData();
    fakeJpg.set("image", new File(["<svg></svg>"], "evil.jpg", { type: "image/jpeg" }));
    const resFake = await POST(new Request("http://localhost:3000/api/parchi/parse", { method: "POST", body: fakeJpg }));
    expect(resFake.status).toBe(415);

    const emptyForm = new FormData();
    emptyForm.set("image", new File([], "empty.jpg", { type: "image/jpeg" }));
    const resEmpty = await POST(new Request("http://localhost:3000/api/parchi/parse", { method: "POST", body: emptyForm }));
    expect(resEmpty.status).toBe(400);
  });

  it("rejects oversized parchi uploads with 413 IMAGE_TOO_LARGE", async () => {
    const req = new Request("http://localhost:3000/api/parchi/parse", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=abc",
        "content-length": String(6 * 1024 * 1024),
      },
      body: "ignored",
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("IMAGE_TOO_LARGE");
  });

  it("returns 503/504/429 cleanly on invalid JSON, Gemini timeout, or quota exceeded", async () => {
    vi.mocked(generateContentOnce).mockResolvedValueOnce({
      response: { text: "{broken" } as unknown as GenerateContentResponse,
      model: env.fastModel(),
      latency_ms: 15,
      usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 0, available: true },
      attempts: [{ model: env.fastModel(), ok: true, ms: 15 }],
    });
    const f1 = new FormData();
    f1.set("image", new File([Buffer.from(jpegBytes())], "p.jpg", { type: "image/jpeg" }));
    expect((await POST(new Request("http://localhost:3000/api/parchi/parse", { method: "POST", body: f1 }))).status).toBe(503);

    vi.mocked(generateContentOnce).mockRejectedValueOnce(new ApiError("AI_TIMEOUT", "AI request timed out"));
    const f2 = new FormData();
    f2.set("image", new File([Buffer.from(jpegBytes())], "p.jpg", { type: "image/jpeg" }));
    expect((await POST(new Request("http://localhost:3000/api/parchi/parse", { method: "POST", body: f2 }))).status).toBe(504);

    vi.mocked(generateContentOnce).mockRejectedValueOnce(new ApiError("RATE_LIMITED", "Daily AI usage limit reached"));
    const f3 = new FormData();
    f3.set("image", new File([Buffer.from(jpegBytes())], "p.jpg", { type: "image/jpeg" }));
    expect((await POST(new Request("http://localhost:3000/api/parchi/parse", { method: "POST", body: f3 }))).status).toBe(429);
  });
});
