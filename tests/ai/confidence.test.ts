import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { parseTurn } from "@/lib/ai/munshi";
import { generateContentOnce } from "@/lib/ai/models";
import { buildSaleProposal, TIER1_CONFIDENCE } from "@/lib/domain/bill";
import { parseFallback } from "@/lib/domain/fallback-parser";
import { env } from "@/lib/env";
import { demoCatalog } from "../helpers/catalog";

vi.mock("@/lib/ai/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/models")>();
  return { ...actual, generateContentOnce: vi.fn() };
});

const catalog = demoCatalog();

function mockExtraction(overrides: Record<string, unknown> = {}) {
  const payload = {
    intent: "sale",
    transcript: "ek kilo cheeni cash",
    transcript_roman: "ek kilo cheeni cash",
    customer_mention: null,
    items: [{ spoken: "cheeni", quantity_phrase: "ek kilo", value_phrase: null, value_rupees: null, is_loose: false, confidence: 0.97 }],
    discount_phrase: null,
    discount_rupees: null,
    cash_phrase: null,
    cash_paid_rupees: null,
    payment_mode: "cash",
    payment_amount_phrase: null,
    payment_amount_rupees: null,
    question: null,
    confidence: 0.97,
    ...overrides,
  };
  vi.mocked(generateContentOnce).mockResolvedValueOnce({
    response: { text: JSON.stringify(payload) } as unknown as GenerateContentResponse,
    model: env.fastModel(),
    latency_ms: 20,
    usage: { input_tokens: 200, output_tokens: 60, cached_input_tokens: 0, available: true },
    attempts: [{ model: env.fastModel(), ok: true, ms: 20 }],
  });
}

describe("Confidence and Tier-1 / Tier-2 safety gates", () => {
  beforeEach(() => vi.mocked(generateContentOnce).mockReset());

  it("allows Tier 1 only when cash is explicit, zero discount/udhaar, high confidence, and unambiguous", async () => {
    mockExtraction();
    const turn = await parseTurn({ catalog, shopName: "Test Shop" });
    const proposal = buildSaleProposal(turn.parsed, catalog);
    expect(proposal.tier).toBe(1);
    expect(proposal.tier_reasons).toEqual([]);
  });

  it("blocks Tier 1 when model claims payment_mode=cash without explicit cash/naqd word in transcript", async () => {
    mockExtraction({ transcript: "ek kilo cheeni", transcript_roman: "ek kilo cheeni", payment_mode: "cash" });
    const turn = await parseTurn({ catalog, shopName: "Test Shop" });
    const proposal = buildSaleProposal(turn.parsed, catalog);
    expect(turn.parsed.tier1_evidence_verified).toBe(false);
    expect(proposal.tier).toBe(2);
    expect(proposal.tier_reasons).toContain("UNVERIFIED_EXTRACTION");
  });

  it("blocks Tier 1 when confidence is just below threshold", async () => {
    mockExtraction({ confidence: TIER1_CONFIDENCE - 0.01 });
    const turn = await parseTurn({ catalog, shopName: "Test Shop" });
    const proposal = buildSaleProposal(turn.parsed, catalog);
    expect(proposal.tier).toBe(2);
    expect(proposal.tier_reasons).toContain("LOW_CONFIDENCE");
  });

  it("blocks Tier 1 when discount, udhaar, ambiguous customer, or new SKU is present", async () => {
    mockExtraction({
      transcript: "Chhote Ali ko ek kilo cheeni 10 rupay chhor do cash",
      transcript_roman: "Chhote Ali ko ek kilo cheeni 10 rupay chhor do cash",
      customer_mention: "Ali",
      discount_phrase: "10 rupay chhor do",
      discount_rupees: 10,
    });
    const turn = await parseTurn({ catalog, shopName: "Test Shop" });
    const proposal = buildSaleProposal(turn.parsed, catalog);
    expect(proposal.tier).toBe(2);
    expect(proposal.tier_reasons).toEqual(expect.arrayContaining(["DISCOUNT", "AMBIGUOUS_CUSTOMER"]));
  });

  it("blocks Tier 1 when an item has both quantity_phrase and value_phrase", async () => {
    mockExtraction({
      items: [{ spoken: "cheeni", quantity_phrase: "1 kg", value_phrase: "160", value_rupees: 160, is_loose: false, confidence: 0.99 }],
    });
    const turn = await parseTurn({ catalog, shopName: "Test Shop" });
    const proposal = buildSaleProposal(turn.parsed, catalog);
    expect(turn.parsed.number_unresolved).toBe(true);
    expect(proposal.tier).toBe(2);
    expect(proposal.tier_reasons).toContain("UNRESOLVED_NUMBER");
  });

  it("never grants Tier 1 to fallback rules regardless of utterance clarity", () => {
    const parsed = parseFallback("ek kilo cheeni cash");
    const proposal = buildSaleProposal(parsed, catalog);
    expect(proposal.tier).toBe(2);
    expect(proposal.tier_reasons).toContain("UNVERIFIED_EXTRACTION");
  });
});
