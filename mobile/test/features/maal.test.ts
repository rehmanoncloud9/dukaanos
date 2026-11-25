import type { StateProduct } from "@contracts";
import {
  isLowStock,
  normalizeMaalFilter,
  sortAndFilterProducts,
  stockLabel,
  stockProgressPct,
  unitPriceBasisLabel,
} from "@/features/maal/logic";

function makeProduct(overrides: Partial<StateProduct>): StateProduct {
  return {
    id: "p-1",
    name: "Cheeni",
    base_unit: "g",
    pack_size_base_units: 1000,
    unit_price_paisa: 16_000,
    cost_price_paisa: 14_500,
    stock_base_units: 12_500,
    reorder_level_base_units: 25_000,
    aliases: ["sugar", "khand"],
    sku_code: "CHEENI",
    is_quick_added: false,
    sold_7d: 8_000,
    days_left: 10,
    ...overrides,
  };
}

describe("Maal inventory formatting and filtering", () => {
  test("formats stock against reorder level for kg, tin, and pcs", () => {
    expect(stockLabel(makeProduct({ stock_base_units: 4200, reorder_level_base_units: 25000 }))).toBe(
      "4.2 / 25 kg",
    );
    expect(
      stockLabel(
        makeProduct({
          base_unit: "ml",
          pack_size_base_units: 5000,
          stock_base_units: 10000,
          reorder_level_base_units: 60000,
        }),
      ),
    ).toBe("2 / 12 tin");
    expect(
      stockLabel(
        makeProduct({
          base_unit: "pcs",
          pack_size_base_units: 1,
          stock_base_units: 24,
          reorder_level_base_units: 12,
        }),
      ),
    ).toBe("24 / 12 pcs");
  });

  test("identifies low stock across zero/negative, <=25% reorder, and <=2.5 days left", () => {
    expect(isLowStock(makeProduct({ stock_base_units: -500 }))).toBe(true);
    expect(isLowStock(makeProduct({ stock_base_units: 5000, reorder_level_base_units: 25000 }))).toBe(
      true,
    );
    expect(isLowStock(makeProduct({ stock_base_units: 15000, days_left: 2.0 }))).toBe(true);
    expect(isLowStock(makeProduct({}))).toBe(false);
  });

  test("clamps stock progress pct and derives unit price basis label", () => {
    expect(stockProgressPct(makeProduct({ stock_base_units: -100 }))).toBe(0);
    expect(stockProgressPct(makeProduct({ stock_base_units: 50000, reorder_level_base_units: 25000 }))).toBe(1);
    expect(unitPriceBasisLabel(makeProduct({ base_unit: "g", pack_size_base_units: 1000 }))).toBe("kg");
    expect(unitPriceBasisLabel(makeProduct({ base_unit: "ml", pack_size_base_units: 1000 }))).toBe("L");
    expect(unitPriceBasisLabel(makeProduct({ base_unit: "pcs", pack_size_base_units: 1 }))).toBe("pc");
  });

  test("sorts low-stock products first and applies filter", () => {
    const healthy = makeProduct({ id: "h", name: "Atta", stock_base_units: 20_000 });
    const low = makeProduct({ id: "l", name: "Zeera", stock_base_units: 100 });
    expect(normalizeMaalFilter("low")).toBe("low");
    expect(sortAndFilterProducts([healthy, low], "all").map((p) => p.id)).toEqual(["l", "h"]);
    expect(sortAndFilterProducts([healthy, low], "low").map((p) => p.id)).toEqual(["l"]);
  });
});
