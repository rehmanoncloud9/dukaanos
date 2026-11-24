import { DEMO_CUSTOMERS, DEMO_PRODUCTS } from "@/lib/domain/demo-data";
import type { Catalog } from "@/lib/domain/types";

const BALANCES: Record<string, number> = {
  CHHOTE_ALI: 140000,
  ALI_DRIVER: 0,
  ALI_TAILOR: 65000,
  TARIQ_M: 90000,
  TARIQ_B: 0,
  BILAL: 635000,
};

/** In-memory mirror of the seeded demo shop for pure domain tests. */
export function demoCatalog(): Catalog {
  return {
    products: DEMO_PRODUCTS.map((p) => ({
      id: p.code,
      name: p.name,
      name_ur: p.name_ur,
      base_unit: p.base_unit,
      pack_size_base_units: p.pack,
      unit_price_paisa: p.price_rs * 100,
      cost_price_paisa: p.cost_rs * 100,
      stock_base_units: p.stock_target,
      reorder_level_base_units: p.reorder,
      aliases: p.aliases,
    })),
    customers: DEMO_CUSTOMERS.map((c) => ({
      id: c.code,
      name: c.name,
      role_tag: c.role_tag,
      phone: c.phone,
      balance_paisa: BALANCES[c.code] ?? 0,
      aliases: c.aliases,
    })),
  };
}
