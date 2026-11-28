import { describe, expect, it } from "vitest";
import type { StateProduct } from "@/lib/api/contracts";
import { analyzeMargins } from "@/lib/domain/margin-shield";

function prod(over: Partial<StateProduct>): StateProduct {
  return {
    id: "p1",
    name: "Cheeni",
    aliases: [],
    base_unit: "g",
    pack_size_base_units: 1000,
    unit_price_paisa: 16000,
    cost_price_paisa: 14000,
    stock_base_units: 5000,
    sku_code: "CHEENI",
    is_quick_added: false,
    sold_7d: 10000,
    days_left: 5,
    ...over,
  };
}

describe("Margin Shield (Munafa Bachao)", () => {
  it("flags loss-making and razor-thin margin products with Rs. 5-rounded prices", () => {
    const loss = prod({ id: "loss", name: "Atta", cost_price_paisa: 13000, unit_price_paisa: 12000, sold_7d: 20000 });
    const thin = prod({ id: "thin", name: "Cheeni", cost_price_paisa: 15800, unit_price_paisa: 16000, sold_7d: 10000 });
    const healthy = prod({ id: "ok", name: "Chawal", cost_price_paisa: 30000, unit_price_paisa: 38000, sold_7d: 5000 });
    const noCost = prod({ id: "nocost", name: "Namak", cost_price_paisa: 0, unit_price_paisa: 6000 });

    const alerts = analyzeMargins([healthy, thin, loss, noCost]);
    expect(alerts.map((a) => a.product.id)).toEqual(["loss", "thin"]);
    expect(alerts[0].is_loss).toBe(true);
    expect(alerts[0].suggested_price_paisa % 500).toBe(0);
    expect(alerts[0].suggested_price_paisa).toBeGreaterThan(loss.cost_price_paisa);
    expect(alerts[1].is_loss).toBe(false);
    expect(alerts[1].margin_pct).toBeLessThan(5);
    expect(alerts[1].weekly_gain_paisa).toBeGreaterThan(0);
  });
});
