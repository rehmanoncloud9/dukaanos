import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { ApiError } from "@/lib/api/http";
import { generateContentOnce } from "@/lib/ai/models";
import { requireShopContext } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { loadCatalog } from "@/lib/api/shop";
import { rpc } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { POST } from "@/app/api/munshi/turn/route";
import { demoCatalog } from "../helpers/catalog";

vi.mock("@/lib/server/auth", () => ({ requireShopContext: vi.fn() }));
vi.mock("@/lib/server/ratelimit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/lib/api/shop", () => ({
  loadCatalog: vi.fn(),
  numify: <T,>(v: T): T => v,
}));
vi.mock("@/lib/supabase/server", () => ({ rpc: vi.fn() }));
vi.mock("@/lib/ai/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/models")>();
  return { ...actual, generateContentOnce: vi.fn() };
});

const catalog = demoCatalog();
const shopId = "00000000-0000-0000-0000-000000000001";

function mockModelTurn(overrides: Record<string, unknown> = {}) {
  const body = {
    intent: "sale",
    transcript: "ek kilo cheeni cash",
    transcript_roman: "ek kilo cheeni cash",
    customer_mention: null,
    items: [{ spoken: "cheeni", quantity_phrase: "ek kilo", value_phrase: null, value_rupees: null, is_loose: false, confidence: 0.96 }],
    discount_phrase: null,
    discount_rupees: null,
    cash_phrase: null,
    cash_paid_rupees: null,
    payment_mode: "cash",
    payment_amount_phrase: null,
    payment_amount_rupees: null,
    question: null,
    confidence: 0.96,
    ...overrides,
  };
  vi.mocked(generateContentOnce).mockResolvedValueOnce({
    response: { text: JSON.stringify(body) } as unknown as GenerateContentResponse,
    model: env.fastModel(),
    latency_ms: 18,
    usage: { input_tokens: 250, output_tokens: 70, cached_input_tokens: 0, available: true },
    attempts: [{ model: env.fastModel(), ok: true, ms: 18 }],
  });
}

function webmBytes(extraLen = 16): Uint8Array {
  const bytes = new Uint8Array(4 + extraLen);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  return bytes;
}

describe("POST /api/munshi/turn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireShopContext).mockResolvedValue({ sb: {} as never, shopId, userId: "user-1", token: "tok" });
    vi.mocked(enforceRateLimit).mockResolvedValue({ allowed: true, remaining: 29, retry_after: 0 });
    vi.mocked(loadCatalog).mockResolvedValue({
      state: { shop: { id: shopId, name: "Bismillah Kiryana" }, feed: [] } as never,
      catalog,
    });
  });

  it("handles valid WebM audio upload and passes shopId for quota accounting", async () => {
    mockModelTurn();
    const form = new FormData();
    form.set("audio", new File([Buffer.from(webmBytes())], "clip.webm", { type: "audio/webm;codecs=opus" }));
    const req = new Request("http://localhost:3000/api/munshi/turn", { method: "POST", body: form });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.kind).toBe("sale");
    expect(json.proposal.tier).toBe(1);
    expect(json.proposal.total_paisa).toBe(16_000);
    expect(generateContentOnce).toHaveBeenCalledWith(env.fastModel(), expect.any(Object), expect.any(Number), {
      shopId,
      kind: "voice",
    });
  });

  it("uses SQL fast path for typed pulse utterances without calling Gemini", async () => {
    vi.mocked(rpc).mockResolvedValueOnce({ galla: { cash_in_galla_paisa: 1000 }, overdue: { count: 0 }, stockout: { count: 0 } });
    const req = new Request("http://localhost:3000/api/munshi/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Subah ka hisaab batao" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.kind).toBe("pulse");
    expect(json.trace.source).toBe("regex");
    expect(generateContentOnce).not.toHaveBeenCalled();
  });

  it("rejects mismatched audio magic bytes, empty audio, and unsupported MIME types", async () => {
    const disguisedForm = new FormData();
    disguisedForm.set("audio", new File(["<html>bad</html>"], "clip.webm", { type: "audio/webm" }));
    const resFake = await POST(new Request("http://localhost:3000/api/munshi/turn", { method: "POST", body: disguisedForm }));
    expect(resFake.status).toBe(415);

    const emptyForm = new FormData();
    emptyForm.set("audio", new File([], "empty.webm", { type: "audio/webm" }));
    const resEmpty = await POST(new Request("http://localhost:3000/api/munshi/turn", { method: "POST", body: emptyForm }));
    expect(resEmpty.status).toBe(400);

    const badMimeForm = new FormData();
    badMimeForm.set("audio", new File(["data"], "clip.txt", { type: "text/plain" }));
    const resMime = await POST(new Request("http://localhost:3000/api/munshi/turn", { method: "POST", body: badMimeForm }));
    expect(resMime.status).toBe(415);
  });

  it("rejects oversized audio uploads with 413 AUDIO_TOO_LARGE", async () => {
    const req = new Request("http://localhost:3000/api/munshi/turn", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=xyz",
        "content-length": String(5 * 1024 * 1024),
      },
      body: "ignored",
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("AUDIO_TOO_LARGE");
  });

  it("propagates AI_TIMEOUT and RATE_LIMITED on audio turns so offline queue preserves the clip", async () => {
    vi.mocked(generateContentOnce).mockRejectedValueOnce(new ApiError("AI_TIMEOUT", "AI request timed out"));
    const form1 = new FormData();
    form1.set("audio", new File([Buffer.from(webmBytes())], "clip.webm", { type: "audio/webm" }));
    const resTimeout = await POST(new Request("http://localhost:3000/api/munshi/turn", { method: "POST", body: form1 }));
    expect(resTimeout.status).toBe(504);

    vi.mocked(generateContentOnce).mockRejectedValueOnce(new ApiError("RATE_LIMITED", "Daily AI usage limit reached", { retry_after: 60 }));
    const form2 = new FormData();
    form2.set("audio", new File([Buffer.from(webmBytes())], "clip.webm", { type: "audio/webm" }));
    const resQuota = await POST(new Request("http://localhost:3000/api/munshi/turn", { method: "POST", body: form2 }));
    expect(resQuota.status).toBe(429);
  });

  it("falls back to rules for typed text when Gemini returns invalid JSON or 5xx", async () => {
    vi.mocked(generateContentOnce).mockResolvedValueOnce({
      response: { text: "not-json" } as unknown as GenerateContentResponse,
      model: env.fastModel(),
      latency_ms: 10,
      usage: { input_tokens: 50, output_tokens: 10, cached_input_tokens: 0, available: true },
      attempts: [{ model: env.fastModel(), ok: true, ms: 10 }],
    });
    const req = new Request("http://localhost:3000/api/munshi/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "dhai kilo cheeni cash" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.trace.source).toBe("rules");
    expect(json.proposal.tier).toBe(2);
    expect(json.proposal.lines[0].qty_base_units).toBe(2500);
  });
});
