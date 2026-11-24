import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import fixtures from "../fixtures/ai/voice/golden-voice-fixtures.json";
import { buildPaymentProposal, buildSaleProposal } from "@/lib/domain/bill";
import { parseFallback } from "@/lib/domain/fallback-parser";
import { parseTurn } from "@/lib/ai/munshi";
import { generateContentOnce } from "@/lib/ai/models";
import { env } from "@/lib/env";
import { demoCatalog } from "../helpers/catalog";

vi.mock("@/lib/ai/models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/models")>();
  return { ...actual, generateContentOnce: vi.fn() };
});

const catalog = demoCatalog();

interface ExpectedVoiceItem {
  product_id?: string;
  kind?: string;
  qty_base_units?: number;
  line_total_paisa?: number;
}

interface VoiceFixture {
  id: string;
  category: string;
  utterance: string;
  test_fallback?: boolean;
  mock_extraction: Record<string, unknown>;
  expected: {
    intent: string;
    customer_id?: string;
    tier?: 1 | 2;
    must_require_review?: boolean;
    discount_paisa?: number;
    cash_paid_paisa?: number;
    credit_paisa?: number;
    payment_amount_paisa?: number;
    tier_reasons_include?: string[];
    items?: ExpectedVoiceItem[];
  };
}

const typedFixtures = fixtures as VoiceFixture[];

describe("Synthetic voice golden fixture evaluation", () => {
  beforeEach(() => vi.mocked(generateContentOnce).mockReset());

  it.each(typedFixtures)("evaluates $id ($category) through parseTurn + deterministic proposal", async (fixture) => {
    vi.mocked(generateContentOnce).mockResolvedValueOnce({
      response: { text: JSON.stringify(fixture.mock_extraction) } as unknown as GenerateContentResponse,
      model: env.fastModel(),
      latency_ms: 15,
      usage: { input_tokens: 300, output_tokens: 90, cached_input_tokens: 0, available: true },
      attempts: [{ model: env.fastModel(), ok: true, ms: 15 }],
    });

    const turn = await parseTurn({
      audio: { base64: "ZHVtbXk=", mimeType: "audio/webm" },
      catalog,
      shopName: "Bismillah Kiryana",
    });
    expect(turn.parsed.intent).toBe(fixture.expected.intent);

    if (fixture.expected.intent === "sale") {
      const proposal = buildSaleProposal(turn.parsed, catalog);

      if (fixture.id === "v05-paune-do-kilo-atta") console.log("DEBUG v05 tier_reasons:", JSON.stringify(proposal.tier_reasons), "tier1_ev:", turn.parsed.tier1_evidence_verified, "conf:", turn.parsed.confidence, "line_conf:", proposal.lines[0]?.confidence);
      if (fixture.expected.tier !== undefined) expect(proposal.tier).toBe(fixture.expected.tier);
      if (fixture.expected.must_require_review) expect(proposal.tier).toBe(2);
      if (fixture.expected.customer_id) expect(proposal.customer.selected_id).toBe(fixture.expected.customer_id);
      if (fixture.expected.discount_paisa !== undefined) expect(proposal.discount_paisa).toBe(fixture.expected.discount_paisa);
      if (fixture.expected.cash_paid_paisa !== undefined) expect(proposal.cash_paid_paisa).toBe(fixture.expected.cash_paid_paisa);
      if (fixture.expected.credit_paisa !== undefined) expect(proposal.credit_paisa).toBe(fixture.expected.credit_paisa);
      if (fixture.expected.tier_reasons_include) {
        for (const reason of fixture.expected.tier_reasons_include) {
          expect(proposal.tier_reasons).toContain(reason);
        }
      }
      if (fixture.expected.items) {
        expect(proposal.lines).toHaveLength(fixture.expected.items.length);
        fixture.expected.items.forEach((exp, idx) => {
          const line = proposal.lines[idx];
          if (exp.product_id) expect(line?.product_id).toBe(exp.product_id);
          if (exp.kind) expect(line?.kind).toBe(exp.kind);
          if (exp.qty_base_units !== undefined) expect(line?.qty_base_units).toBe(exp.qty_base_units);
          if (exp.line_total_paisa !== undefined) expect(line?.line_total_paisa).toBe(exp.line_total_paisa);
        });
      }
    } else if (fixture.expected.intent === "payment") {
      const payment = buildPaymentProposal(turn.parsed, catalog.customers);
      expect(payment.tier).toBe(2);
      if (fixture.expected.customer_id) expect(payment.customer.selected_id).toBe(fixture.expected.customer_id);
      if (fixture.expected.payment_amount_paisa !== undefined) expect(payment.amount_paisa).toBe(fixture.expected.payment_amount_paisa);
    }

    if (fixture.test_fallback) {
      const fb = parseFallback(fixture.utterance);
      expect(fb.intent).toBe(fixture.expected.intent);
      if (fb.intent === "sale") {
        const fbProposal = buildSaleProposal(fb, catalog);
        expect(fbProposal.tier).toBe(2);
      }
    }
  });
});
