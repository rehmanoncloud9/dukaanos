import { describe, expect, it } from "vitest";
import { buildSaleProposal } from "@/lib/domain/bill";
import { parseFallback } from "@/lib/domain/fallback-parser";
import type { Catalog } from "@/lib/domain/types";

const catalog: Catalog = {
  products: [{
    id: "sugar",
    name: "Cheeni",
    base_unit: "g",
    pack_size_base_units: 1_000,
    unit_price_paisa: 16_000,
    cost_price_paisa: 12_000,
    stock_base_units: 100_000,
    aliases: ["sugar"],
  }],
  customers: [],
};

describe("deterministic fallback extraction", () => {
  it("keeps number phrases and amount evidence on the proposal", () => {
    const parsed = parseFallback("Chhote Ali ko dhai sau ka khula oil, 3 packet chips, 200 cash diya baqi khate mein");
    const oil = parsed.items.find((item) => item.spoken.toLowerCase().includes("oil"));
    expect(oil?.value_rupees).toBe(250);
    expect(oil?.value_phrase).toBe("dhai sau");
    expect(parsed.cash_paid_rupees).toBe(200);
    expect(parsed.cash_phrase).toContain("cash");
    expect(parsed.payment_mode).toBe("split");
    expect(parsed.tier1_evidence_verified).not.toBe(true);
  });

  it("parses quantity and split-payment phrases without doing financial arithmetic", () => {
    const parsed = parseFallback("dhai kilo cheeni, 30 rupay chhor do, 200 cash diya baqi khate mein");
    expect(parsed.items[0]?.quantity_phrase).toBe("dhai kilo");
    expect(parsed.discount_rupees).toBe(30);
    expect(parsed.discount_phrase).toContain("chhor");
    expect(parsed.cash_paid_rupees).toBe(200);
    expect(parsed.number_unresolved).toBe(false);
  });

  it("normalizes Urdu number words and numeral script", () => {
    const parsed = parseFallback("ڈھائی کلو چینی");
    expect(parsed.items[0]?.quantity_phrase).toBe("dhai kilo");
    const digits = parseFallback("۲ کلو چینی");
    expect(digits.items[0]?.quantity_phrase).toBe("2 kilo");
  });

  it("never auto-commits a fallback parse even when the local parse is clear", () => {
    const proposal = buildSaleProposal(parseFallback("ek kilo cheeni cash"), catalog);
    expect(proposal.tier).toBe(2);
    expect(proposal.tier_reasons).toContain("UNVERIFIED_EXTRACTION");
  });

  it("marks ambiguous numeric evidence for human review", () => {
    const parsed = parseFallback("99999999999999999 rupay cash diya");
    expect(parsed.number_unresolved).toBe(true);
  });
});
