import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { parseTurn, PARSED_TURN_JSON_SCHEMA, systemPrompt } from "@/lib/ai/munshi";
import { generateContentOnce } from "@/lib/ai/models";
import { env } from "@/lib/env";
import type { Catalog } from "@/lib/domain/types";

vi.mock("@/lib/ai/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/models")>();
  return { ...actual, generateContentOnce: vi.fn() };
});

const catalog: Catalog = {
  products: [{
    id: "sugar", name: "Cheeni", base_unit: "g", pack_size_base_units: 1_000,
    unit_price_paisa: 16_000, cost_price_paisa: 12_000, stock_base_units: 10_000, aliases: ["sugar"],
  }],
  customers: [],
};

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    intent: "sale",
    transcript: "dhai kilo cheeni cash diya",
    transcript_roman: "dhai kilo cheeni cash diya",
    customer_mention: null,
    items: [{ spoken: "cheeni", quantity_phrase: "dhai kilo", value_phrase: null, value_rupees: null, is_loose: false, confidence: 0.99 }],
    discount_phrase: null,
    discount_rupees: null,
    cash_phrase: null,
    cash_paid_rupees: null,
    payment_mode: "cash",
    payment_amount_phrase: null,
    payment_amount_rupees: null,
    question: null,
    confidence: 0.99,
    ...overrides,
  };
}

function mockJson(value: unknown) {
  const response = { text: JSON.stringify(value) } as unknown as GenerateContentResponse;
  vi.mocked(generateContentOnce).mockResolvedValue({
    response,
    model: env.fastModel(),
    latency_ms: 24,
    usage: { input_tokens: 300, output_tokens: 80, cached_input_tokens: 0, available: true },
    attempts: [{ model: env.fastModel(), ok: true, ms: 24 }],
  });
}

const input = { catalog, shopName: "Test Shop", shopId: "00000000-0000-0000-0000-000000000001" };

describe("Munshi structured extraction", () => {
  beforeEach(() => vi.mocked(generateContentOnce).mockReset());

  it("keeps the prompt concise and separates extraction from catalog matching and arithmetic", () => {
    const prompt = systemPrompt("Test Shop");
    expect(prompt.length).toBeLessThan(1_800);
    expect(prompt).toContain("dhai sau rupay");
    expect(prompt).toContain("Do not calculate line totals or balances");
    expect(prompt).not.toContain("Cheeni");
    expect(PARSED_TURN_JSON_SCHEMA.properties.items.type).toBe("array");
  });

  it("preserves raw quantity evidence and only permits Tier 1 with explicit safe evidence", async () => {
    mockJson(extraction());
    const result = await parseTurn(input);
    expect(result.parsed.items[0]).toMatchObject({ quantity_phrase: "dhai kilo", number_unresolved: false });
    expect(result.parsed.tier1_evidence_verified).toBe(true);
    expect(generateContentOnce).toHaveBeenCalledWith(env.fastModel(), expect.any(Object), expect.any(Number), {
      shopId: input.shopId,
      kind: "voice",
    });
  });

  it("marks missing quantities, value/quantity conflicts, and inconsistent raw values uncertain", async () => {
    mockJson(extraction({ items: [{ spoken: "cheeni", quantity_phrase: null, value_phrase: null, value_rupees: null, is_loose: false, confidence: 1 }] }));
    const missing = await parseTurn(input);
    expect(missing.parsed.number_unresolved).toBe(true);
    expect(missing.parsed.tier1_evidence_verified).toBe(false);

    mockJson(extraction({ items: [{ spoken: "oil", quantity_phrase: "2 kilo", value_phrase: "dhai sau", value_rupees: 300, is_loose: true, confidence: 1 }] }));
    const conflict = await parseTurn(input);
    expect(conflict.parsed.number_unresolved).toBe(true);
    expect(conflict.parsed.items[0]?.value_rupees).toBeNull();
    expect(conflict.parsed.items[0]?.number_unresolved).toBe(true);
  });

  it("preserves Tier 1 cash evidence when transcript uses Urdu script نقد", async () => {
    mockJson(extraction({ transcript: "ڈھائی کلو چینی نقد", transcript_roman: "dhai kilo cheeni naqd" }));
    const result = await parseTurn(input);
    expect(result.parsed.tier1_evidence_verified).toBe(true);
  });

  it("falls back deterministically on typed text, never granting auto-commit authority", async () => {
    // Simulate a model failure: generateContentOnce rejects, parseTurn must fall back to rules.
    // Use mockRejectedValueOnce so Vitest does not intercept the rejection as an unhandled one.
    vi.mocked(generateContentOnce).mockRejectedValueOnce(new Error("provider unavailable"));
    const result = await parseTurn({ ...input, text: "dhai kilo cheeni cash" });
    expect(vi.mocked(generateContentOnce)).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("rules");
    expect(result.parsed.items[0]?.quantity_phrase).toBe("dhai kilo");
    expect(result.parsed.tier1_evidence_verified).not.toBe(true);
  });
});
