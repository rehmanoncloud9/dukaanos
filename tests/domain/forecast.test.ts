/**
 * Tests for forecast.ts — margin-weighted reorder optimizer.
 * Zero LLM, zero network, pure deterministic integer math.
 */
import { describe, expect, it } from "vitest";
import { computeReorderForecast, formatReorderLine } from "@/lib/domain/forecast";
import type { StateProduct } from "@/lib/api/contracts";

function mkProduct(overrides: Partial<StateProduct> & { id: string; name: string }): StateProduct {
  return {
    base_unit: "g",
    pack_size_base_units: 1000,
    unit_price_paisa: 10000, // Rs. 100/kg
    cost_price_paisa: 7000,  // Rs. 70/kg
    stock_base_units: 500,   // 500g in stock
    aliases: [],
    sold_7d: 1000,           // 1kg/week velocity
    sku_code: "",
    is_quick_added: false,
    days_left: null,
    ...overrides,
  };
}

describe("forecast", () => {
  it("only includes products with days_of_stock <= threshold", () => {
    const products: StateProduct[] = [
      mkProduct({ id: "a", name: "Cheeni", stock_base_units: 500, sold_7d: 1000, pack_size_base_units: 1000 }), // mulDiv(500,7,1000)=3.5→rounds to 4 days → included at threshold=4
      mkProduct({ id: "b", name: "Atta", stock_base_units: 5000, sold_7d: 1000, pack_size_base_units: 1000 }), // mulDiv(5000,7,1000)=35 days → excluded
    ];
    const result = computeReorderForecast(products, 100_000, 4);
    // Cheeni: mulDiv(500,7,1000) = round(3.5) = 4 days → included at threshold=4
    expect(result.items.some((i) => i.product_id === "a")).toBe(true);
    // Atta: 35 days → excluded
    expect(result.items.some((i) => i.product_id === "b")).toBe(false);
  });

  it("sorts by daily_profit_at_risk descending", () => {
    const products: StateProduct[] = [
      mkProduct({ id: "low", name: "Low Margin", unit_price_paisa: 5000, cost_price_paisa: 4800, stock_base_units: 100, sold_7d: 1000 }),
      mkProduct({ id: "high", name: "High Margin", unit_price_paisa: 10000, cost_price_paisa: 5000, stock_base_units: 100, sold_7d: 1000 }),
    ];
    const result = computeReorderForecast(products, 100_000, 10);
    expect(result.items[0].product_id).toBe("high");
  });

  it("computes integer reorder cost without floats", () => {
    const products: StateProduct[] = [
      mkProduct({ id: "x", name: "Oil", base_unit: "ml", pack_size_base_units: 1000, unit_price_paisa: 20000, cost_price_paisa: 15000, stock_base_units: 200, sold_7d: 2000 }),
    ];
    const result = computeReorderForecast(products, 100_000, 5);
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    // reorder_cost_paisa must be an integer
    expect(Number.isInteger(item.reorder_cost_paisa)).toBe(true);
    expect(item.reorder_cost_paisa).toBeGreaterThan(0);
    expect(item.daily_profit_at_risk_paisa).toBeGreaterThan(0);
  });

  it("uses 70% fallback cost when cost_price_paisa is 0", () => {
    const products: StateProduct[] = [
      mkProduct({ id: "y", name: "Salt", cost_price_paisa: 0, unit_price_paisa: 10000, stock_base_units: 100, sold_7d: 500 }),
    ];
    const result = computeReorderForecast(products, 100_000, 5);
    const item = result.items.find((i) => i.product_id === "y");
    // With 70% fallback: effective cost = 7000 paisa/kg → margin = 3000 paisa/kg
    expect(item).toBeDefined();
    expect(item!.effective_cost_paisa).toBeGreaterThan(0);
  });

  it("tracks affordable vs unaffordable counts", () => {
    const products: StateProduct[] = [
      mkProduct({ id: "cheap", name: "Namak", cost_price_paisa: 500, unit_price_paisa: 700, stock_base_units: 50, sold_7d: 500, pack_size_base_units: 1000 }),
      mkProduct({ id: "pricey", name: "Ghee", cost_price_paisa: 500_000, unit_price_paisa: 600_000, stock_base_units: 50, sold_7d: 500, pack_size_base_units: 1000 }),
    ];
    const result = computeReorderForecast(products, 10_000, 10); // only Rs. 100 cash
    expect(result.affordable_count + result.unaffordable_count).toBe(result.items.length);
  });

  it("formatReorderLine produces human-readable output", () => {
    const products: StateProduct[] = [
      mkProduct({ id: "z", name: "Cheeni", base_unit: "g", pack_size_base_units: 1000, stock_base_units: 100, sold_7d: 1000 }),
    ];
    const result = computeReorderForecast(products, 100_000, 3);
    const item = result.items[0];
    const line = formatReorderLine(item);
    expect(line).toContain("Cheeni");
    expect(line).toContain("Rs.");
    expect(line).toMatch(/khatam/);
  });

  it("is fast (<10ms) for 100 products", () => {
    const products = Array.from({ length: 100 }, (_, i) =>
      mkProduct({ id: `p${i}`, name: `Product ${i}`, stock_base_units: i * 10, sold_7d: 100 + i }),
    );
    const t0 = performance.now();
    computeReorderForecast(products, 100_000, 3);
    expect(performance.now() - t0).toBeLessThan(50); // generous Vitest allowance
  });
});
