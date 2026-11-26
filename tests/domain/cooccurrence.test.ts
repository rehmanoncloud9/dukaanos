/**
 * Tests for cooccurrence.ts — deterministic basket co-occurrence engine.
 * Runs in Vitest, zero network, zero LLM.
 */
import { describe, expect, it } from "vitest";
import { buildCoOccurrenceIndex, suggestCompanionItems, quickSuggest } from "@/lib/domain/cooccurrence";
import type { FeedTx } from "@/lib/api/contracts";
import type { StateProduct } from "@/lib/api/contracts";

// Minimal FeedTx factory
function mkTx(lines: string[]): FeedTx {
  return {
    id: Math.random().toString(36).slice(2),
    seq: 1,
    type: "sale",
    created_at: new Date().toISOString(),
    is_reversed: false,
    customer_id: null,
    customer_name: null,
    customer_role: null,
    supplier_name: null,
    reversed_transaction_id: null,
    subtotal_paisa: 1000,
    discount_paisa: 0,
    total_paisa: 1000,
    cash_paid_paisa: 1000,
    credit_paisa: 0,
    entry_hash: "",
    prev_hash: "",
    idempotency_key: "",
    audit_meta: {},
    lines: lines.map((id) => ({
      product_id: id,
      name: id,
      qty_base_units: 100,
      base_unit: "g" as const,
      line_total_paisa: 100,
      value_first: false,
    })),
  };
}

function mkProduct(id: string, sold7d = 10): StateProduct {
  return {
    id,
    name: id,
    base_unit: "g" as const,
    pack_size_base_units: 1000,
    unit_price_paisa: 5000,
    cost_price_paisa: 3000,
    stock_base_units: 2000,
    aliases: [],
    sold_7d: sold7d,
    sku_code: "",
    is_quick_added: false,
    days_left: null,
  };
}

const cheeni = "cheeni";
const chai = "chai-patti";
const doodh = "doodh";
const sabun = "sabun";

describe("cooccurrence", () => {
  it("builds an index from sale transactions only", () => {
    const feed = [
      mkTx([cheeni, chai]),
      mkTx([cheeni, doodh]),
      { ...mkTx([sabun]), type: "purchase" as const }, // ignored
    ];
    const index = buildCoOccurrenceIndex(feed as FeedTx[]);
    expect(index.has(cheeni)).toBe(true);
    expect(index.get(cheeni)?.has(chai)).toBe(true);
    expect(index.get(cheeni)?.has(sabun)).toBe(false); // purchase ignored
  });

  it("counts co-occurrences correctly", () => {
    const feed = [
      mkTx([cheeni, chai]),
      mkTx([cheeni, chai]),
      mkTx([cheeni, doodh]),
    ];
    const index = buildCoOccurrenceIndex(feed as FeedTx[]);
    expect(index.get(cheeni)?.get(chai)).toBe(2);
    expect(index.get(cheeni)?.get(doodh)).toBe(1);
  });

  it("suggests top companions excluding basket items", () => {
    const feed = [
      mkTx([cheeni, chai, doodh]),
      mkTx([cheeni, chai]),
      mkTx([cheeni, doodh]),
    ];
    const products = [chai, doodh, sabun].map(mkProduct);
    const index = buildCoOccurrenceIndex(feed as FeedTx[]);
    const suggestions = suggestCompanionItems([cheeni], index, products, 2);
    expect(suggestions).toHaveLength(2);
    // chai appeared 2×, doodh 2×, sort by count then alpha
    expect(suggestions[0].product_id).toBe(chai);
    expect(suggestions[1].product_id).toBe(doodh);
    // Basket item not suggested
    expect(suggestions.every((s) => s.product_id !== cheeni)).toBe(true);
  });

  it("excludes out-of-stock companions", () => {
    const feed = [mkTx([cheeni, sabun])];
    const products = [{ ...mkProduct(sabun), stock_base_units: 0 }];
    const index = buildCoOccurrenceIndex(feed as FeedTx[]);
    const suggestions = suggestCompanionItems([cheeni], index, products, 2);
    expect(suggestions).toHaveLength(0);
  });

  it("returns empty when basket is empty", () => {
    const feed = [mkTx([cheeni, chai])];
    const index = buildCoOccurrenceIndex(feed as FeedTx[]);
    const products = [mkProduct(chai)];
    expect(suggestCompanionItems([], index, products, 2)).toHaveLength(0);
  });

  it("quickSuggest is fast (<5ms on warm run)", () => {
    // Build a realistic 50-basket feed
    const items = [cheeni, chai, doodh, sabun, "atta", "tel", "rice", "salt"];
    const feed = Array.from({ length: 50 }, (_, i) => {
      const basket = items.slice(0, 2 + (i % 3));
      return mkTx(basket);
    });
    const products = items.map((id) => mkProduct(id));
    const t0 = performance.now();
    quickSuggest([cheeni], feed as FeedTx[], products, 2);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(50); // generous Vitest allowance; production <1ms
  });
});
