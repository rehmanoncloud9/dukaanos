import {
  buildPaymentProposal,
  buildSaleProposal,
  recalcNewSkuLine,
  resettle,
  setLineQty,
  toCommitInput,
} from "@domain/bill";
import { parseFallback } from "@domain/fallback-parser";
import type { Catalog, ParsedTurn } from "@domain/types";
import {
  b64urlDecode,
  b64urlEncode,
  canonicalJson,
  generateKeypairHex,
  signPassport,
  toPayload,
  verifyPassport,
  type TradeSummary,
} from "@passport";
import { classifyTurnResponse, deferredFlushOutcome } from "@/features/munshi/turnEngine";

const GOLDEN_CATALOG: Catalog = {
  products: [
    {
      id: "prod-cheeni",
      name: "Cheeni (Sugar)",
      base_unit: "g",
      pack_size_base_units: 1000,
      unit_price_paisa: 16_000, // Rs. 160 / kg
      cost_price_paisa: 14_500,
      stock_base_units: 25_000,
      aliases: ["cheeni", "chini", "sugar", "khand"],
    },
    {
      id: "prod-oil",
      name: "Khula Cooking Oil",
      base_unit: "ml",
      pack_size_base_units: 1000,
      unit_price_paisa: 52_000, // Rs. 520 / L
      cost_price_paisa: 49_000,
      stock_base_units: 12_000,
      aliases: ["khula oil", "cooking oil", "oil", "tel", "tail"],
    },
    {
      id: "prod-sabun",
      name: "Lux Sabun",
      base_unit: "pcs",
      pack_size_base_units: 1,
      unit_price_paisa: 13_500, // Rs. 135 / pc
      cost_price_paisa: 11_500,
      stock_base_units: 30,
      aliases: ["sabun", "lux", "soap"],
    },
  ],
  customers: [
    {
      id: "cust-chhote-ali",
      name: "Chhote Ali",
      role_tag: "mohalla",
      phone: "03001112233",
      balance_paisa: 25_000, // Rs. 250 existing udhaar
      aliases: ["chhote ali", "chote ali", "ali"],
    },
    {
      id: "cust-ali-tailor",
      name: "Ali Tailor",
      role_tag: "darzi",
      phone: "03012223344",
      balance_paisa: 180_000,
      aliases: ["ali tailor", "ali darzi", "ali"],
    },
    {
      id: "cust-ali-mechanic",
      name: "Ali Mechanic",
      role_tag: "workshop",
      phone: "03213334455",
      balance_paisa: 90_000,
      aliases: ["ali mechanic", "ali"],
    },
    {
      id: "cust-bilal",
      name: "Bilal",
      role_tag: null,
      phone: "03334445566",
      balance_paisa: 200_000,
      aliases: ["bilal", "bilal bhai"],
    },
  ],
};

describe("Munshi golden counter math, turn routing, and Ed25519 passport", () => {
  it("computes Act 1 kiryana counter utterance deterministically in integer paisa", () => {
    const utterance = "Chhote Ali ko dedh pao cheeni, 250 ka khula oil, 30 rupay chhor do, 400 cash diya baqi khate mein";
    const parsed = parseFallback(utterance);
    const proposal = buildSaleProposal(parsed, GOLDEN_CATALOG);

    expect(parsed.intent).toBe("sale");
    expect(proposal.customer.selected_id).toBe("cust-chhote-ali");
    expect(proposal.lines).toHaveLength(2);

    const cheeni = proposal.lines[0];
    const oil = proposal.lines[1];
    // dedh pao = 375g @ Rs. 160/kg = Rs. 60 = 6000 paisa
    expect(cheeni.qty_base_units).toBe(375);
    expect(cheeni.line_total_paisa).toBe(6_000);
    // 250 ka khula oil -> exact value_first 25000 paisa
    expect(oil.value_first).toBe(true);
    expect(oil.line_total_paisa).toBe(25_000);

    expect(proposal.subtotal_paisa).toBe(31_000);
    expect(proposal.discount_paisa).toBe(3_000);
    expect(proposal.total_paisa).toBe(28_000);
    expect(proposal.cash_paid_paisa).toBe(40_000);
    // Customer paid Rs. 400 against Rs. 280 bill -> Rs. 120 reduces existing khata
    expect(proposal.credit_paisa).toBe(-12_000);
    expect(proposal.new_balance_paisa).toBe(13_000);
    expect(proposal.tier).toBe(2);
    expect(proposal.tier_reasons).toEqual(expect.arrayContaining(["DISCOUNT", "OVERPAYMENT_TO_KHATA"]));

    const commitInput = toCommitInput(proposal, "turn-act1", { channel: "voice" });
    expect(commitInput.cash_paid_paisa).toBe(40_000);
    expect(commitInput.discount_paisa).toBe(3_000);
    expect(commitInput.customer_id).toBe("cust-chhote-ali");
  });

  it("promotes high-confidence verified cash sales to Tier 1 auto-commit", () => {
    const parsed: ParsedTurn = {
      intent: "sale",
      transcript: "Ek kilo cheeni aur do sabun cash",
      customer_mention: null,
      items: [
        { spoken: "cheeni", quantity_phrase: "ek kilo", value_rupees: null, is_loose: false, confidence: 0.98 },
        { spoken: "sabun", quantity_phrase: "do", value_rupees: null, is_loose: false, confidence: 0.97 },
      ],
      discount_rupees: null,
      cash_paid_rupees: 43_0,
      payment_mode: "cash",
      payment_amount_rupees: null,
      question: null,
      confidence: 0.97,
      tier1_evidence_verified: true,
    };

    const proposal = buildSaleProposal(parsed, GOLDEN_CATALOG, { tier1EvidenceVerified: true });
    expect(proposal.tier).toBe(1);
    expect(proposal.tier_reasons).toEqual([]);
    expect(proposal.total_paisa).toBe(16_000 + 27_000); // Rs. 430

    const action = classifyTurnResponse(
      {
        kind: "sale",
        proposal,
        trace: {
          transcript: parsed.transcript,
          model: "gemini-3.5-flash-lite",
          latency_ms: 420,
          source: "model",
          pakphone: { items: [], ms_total: 2, customer: null },
          intent: "sale",
          api_ms: 420,
          attempts: [{ model: "gemini-3.5-flash-lite", ok: true, ms: 420 }],
        },
      },
      "t1-key",
    );
    expect(action.type).toBe("auto_commit_sale");
    expect(deferredFlushOutcome({
      kind: "sale",
      proposal,
      trace: { transcript: parsed.transcript, latency_ms: 10, source: "model", pakphone: { items: [], ms_total: 1, customer: null }, intent: "sale", model: "gemini-3.5-flash-lite", api_ms: 15, attempts: [] },
    })).toBe("done");
  });

  it("handles 3-Ali disambiguation, QuickAdd new SKU pricing, and Review edits deterministically", () => {
    const parsed = parseFallback("Ali ko 2 packet Lays cash");
    const proposal = buildSaleProposal(parsed, GOLDEN_CATALOG);

    expect(proposal.tier).toBe(2);
    expect(proposal.tier_reasons).toContain("NEW_SKU");
    expect(proposal.customer.candidates.length).toBeGreaterThanOrEqual(2);

    const lays = proposal.lines[0];
    expect(lays.kind).toBe("new_sku");
    expect(lays.price_known).toBe(false);

    const pricedLays = recalcNewSkuLine({
      ...lays,
      unit_price_paisa: 5_000, // Rs. 50 / packet
      price_known: true,
      confidence: 1,
    });
    expect(pricedLays.qty_base_units).toBe(2);
    expect(pricedLays.line_total_paisa).toBe(10_000);

    const bumped = setLineQty(pricedLays, 3, null);
    expect(bumped.line_total_paisa).toBe(15_000);

    const settled = resettle(proposal, GOLDEN_CATALOG.customers, {
      lines: [bumped],
      selected_customer_id: "cust-ali-tailor",
      cash_paid_paisa: 0,
      payment_mode: "udhaar",
    });
    expect(settled.customer.selected_id).toBe("cust-ali-tailor");
    expect(settled.customer.ambiguous).toBe(false);
    expect(settled.credit_paisa).toBe(15_000);
    expect(settled.new_balance_paisa).toBe(195_000);
  });

  it("parses Bilal wasooli payment and classifies deferred flush outcomes", () => {
    const parsed = parseFallback("Bilal ne 1500 jama karwaye");
    expect(parsed.intent).toBe("payment");
    const proposal = buildPaymentProposal(parsed, GOLDEN_CATALOG.customers);
    expect(proposal.customer.selected_id).toBe("cust-bilal");
    expect(proposal.amount_paisa).toBe(150_000);
    expect(proposal.new_balance_paisa).toBe(50_000);

    const outcome = deferredFlushOutcome({
      kind: "payment",
      proposal,
      trace: { transcript: parsed.transcript, latency_ms: 15, source: "regex", pakphone: { items: [], ms_total: 1, customer: null }, intent: "payment", model: null, api_ms: 15, attempts: [] },
    });
    expect(outcome).toMatchObject({ status: "review", patch: { review_kind: "payment" } });

    const baseTrace = {
      transcript: parsed.transcript,
      latency_ms: 15,
      source: "regex" as const,
      pakphone: { items: [], ms_total: 1, customer: null },
      intent: "payment",
      model: null,
      api_ms: 15,
      attempts: [],
    };
    expect(classifyTurnResponse({ kind: "payment", proposal, trace: baseTrace }, "k-pay").type).toBe("open_payment");
    expect(classifyTurnResponse({ kind: "reversal", target: null, trace: baseTrace }, "k-rev").type).toBe("open_reversal");
    expect(
      classifyTurnResponse(
        {
          kind: "pulse",
          pulse: {
            galla: {
              cash_in_galla_paisa: 0,
              cash_sales_paisa: 0,
              udhaar_paisa: 0,
              est_margin_paisa: 0,
              sales_count: 0,
              cash_sales_count: 0,
              udhaar_accounts: 0,
              gross_sales_paisa: 0,
              wasooli_paisa: 0,
              purchases_cash_paisa: 0,
            },
            overdue: { count: 0, total_paisa: 0, items: [] },
            stockout: { count: 0, items: [] },
            sql_ms: 4,
            generated_at: "2026-11-25T10:00:00Z",
            llm_cost_rs: 0,
          },
          trace: baseTrace,
        },
        "k-pulse",
      ).type,
    ).toBe("open_pulse");
    expect(
      classifyTurnResponse({ kind: "answer", answer: "Rs. 1,800", proposal: null, tools: [], trace: baseTrace }, "k-ans").type,
    ).toBe("open_answer");
    expect(classifyTurnResponse({ kind: "purchase", trace: baseTrace }, "k-buy").type).toBe("open_parchi");
    expect(classifyTurnResponse({ kind: "unknown", trace: baseTrace }, "k-unk").type).toBe("unknown");

    const tier2Proposal = buildSaleProposal(parseFallback("Chhote Ali ko dedh pao cheeni"), GOLDEN_CATALOG);
    expect(classifyTurnResponse({ kind: "sale", proposal: tier2Proposal, trace: baseTrace }, "k-t2").type).toBe(
      "open_sale_review",
    );
    expect(deferredFlushOutcome({ kind: "sale", proposal: tier2Proposal, trace: baseTrace })).toMatchObject({
      status: "review",
      patch: { review_kind: "sale" },
    });
    expect(deferredFlushOutcome({ kind: "reversal", target: null, trace: baseTrace })).toMatchObject({
      status: "review",
      patch: { review_kind: "reversal" },
    });
  });

  it("signs and verifies Ed25519 SMEConnect passport on mobile Hermes/Jest runtime", async () => {
    const summary: TradeSummary = {
      shop_id: "0f6a3b6e-1111-4222-8333-444455556666",
      shop_name: "Bismillah Kiryana",
      city: "G-10 Markaz, Islamabad",
      active_days: 142,
      period_days: 30,
      period_from: "2026-10-25T00:00:00Z",
      period_to: "2026-11-24T00:00:00Z",
      gmv_paisa: 124_000_00,
      sales_count: 210,
      cash_sales_paisa: 91_760_00,
      credit_sales_paisa: 32_240_00,
      recovered_paisa: 29_470_00,
      purchases_paisa: 26_190_00,
      active_trading_days: 14,
      receivable_paisa: 9_300_00,
      ledger_balanced: true,
      tx_count_total: 192,
      head_entry_hash: "9f8a7c12".padEnd(64, "0"),
    };

    const kp = await generateKeypairHex();
    const signed = await signPassport(toPayload(summary), kp.privateKey);
    const verified = await verifyPassport(signed.token, kp.publicKey);
    expect(verified.valid).toBe(true);
    expect(verified.payload?.n).toBe("Bismillah Kiryana");

    const [p, sig] = signed.token.split(".");
    const obj = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
    obj.gmv = obj.gmv + 100;
    const tampered = `${b64urlEncode(new TextEncoder().encode(canonicalJson(obj)))}.${sig}`;
    const tamperedRes = await verifyPassport(tampered, kp.publicKey);
    expect(tamperedRes.valid).toBe(false);
  });
});
