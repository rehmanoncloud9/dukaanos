/**
 * Margin-weighted reorder optimizer — pure integer math, zero LLM, zero network.
 *
 * Ranks near-stockout products by daily gross-profit-at-risk so the shopkeeper
 * knows which items to buy first with available galla cash.
 *
 * Rules:
 *  - Only products with days_of_stock < threshold (default 3 days) are ranked.
 *  - daily_profit_at_risk = (unit_price_paisa - cost_price_paisa) × sold_7d / 7
 *  - reorder_cost_paisa = reorder_qty_base_units × cost_price_paisa / pack_size_base_units
 *  - All arithmetic uses integer mulDiv to avoid floating-point rounding.
 *  - Products with zero cost_price_paisa are assigned cost = unit_price_paisa × 70%
 *    (conservative estimate when wholesale cost is unknown).
 */

import { mulDiv } from "./money";
import type { StateProduct } from "@/lib/api/contracts";

export interface ReorderItem {
  product_id: string;
  name: string;
  base_unit: string;
  pack_size_base_units: number;
  /** Current stock in base_units. */
  stock_base_units: number;
  /** Sales velocity: base_units sold in last 7 days. */
  sold_7d: number;
  /** Estimated days of stock remaining (0 if no velocity data). */
  days_of_stock: number;
  /** Gross profit margin per pack in paisa. */
  margin_per_pack_paisa: number;
  /** Daily gross profit that will be lost if this item goes out of stock. */
  daily_profit_at_risk_paisa: number;
  /** Suggested reorder quantity in base_units (enough for 7 days of sales). */
  suggested_reorder_base_units: number;
  /** Estimated cash needed to reorder (in paisa). */
  reorder_cost_paisa: number;
  /** Effective cost price per base_unit used in computation (in paisa). */
  effective_cost_paisa: number;
  /** Effective unit sale price per base_unit used (in paisa). */
  effective_price_paisa: number;
}

export interface ForecastResult {
  items: ReorderItem[];
  /** Total cash needed for the top-priority reorders (paisa). */
  total_reorder_cost_paisa: number;
  /** Cash in galla available for reordering (paisa). */
  cash_available_paisa: number;
  /** Items the shop can fully afford right now. */
  affordable_count: number;
  /** Items the shop cannot afford right now. */
  unaffordable_count: number;
}

const COST_FALLBACK_BP = 7000; // 70% of price when cost unknown (in basis points)

/**
 * Compute reorder plan for near-stockout products.
 *
 * @param products          Full product catalog with stock, velocity, prices
 * @param cashInGallaPaisa  Current cash in the drawer
 * @param thresholdDays     Products with <= this many days of stock are included (default 3)
 * @param topN              Return at most this many ranked items (default 10)
 */
export function computeReorderForecast(
  products: StateProduct[],
  cashInGallaPaisa: number,
  thresholdDays = 3,
  topN = 10,
): ForecastResult {
  const items: ReorderItem[] = [];

  for (const p of products) {
    const sold7d = Math.max(0, p.sold_7d ?? 0);

    // Days of stock: infinity if no velocity → skip
    const daysOfStock = sold7d > 0
      ? Math.floor(mulDiv(p.stock_base_units, 7, sold7d))
      : (p.stock_base_units <= 0 ? 0 : 999);

    if (daysOfStock > thresholdDays) continue;
    if (p.unit_price_paisa <= 0) continue;

    // Per-base-unit prices (pack_size_base_units maps pack price to per-unit price)
    // unit_price_paisa in the catalog is price per pack; cost_price_paisa is per pack too
    const pack = Math.max(1, p.pack_size_base_units);
    const pricePaisaPerUnit = Math.round(p.unit_price_paisa / pack);
    const rawCost = p.cost_price_paisa > 0 ? p.cost_price_paisa : mulDiv(p.unit_price_paisa, COST_FALLBACK_BP, 10000);
    const costPaisaPerUnit = Math.round(rawCost / pack);

    // Margin per pack
    const marginPerPackPaisa = p.unit_price_paisa - rawCost;

    // Daily profit at risk: (price - cost) per unit × sold_7d / 7
    // = marginPerUnit × sold_7d / 7
    const marginPerUnit = pricePaisaPerUnit - costPaisaPerUnit;
    const dailyProfitAtRisk = sold7d > 0
      ? Math.max(0, mulDiv(Math.max(0, marginPerUnit), sold7d, 7))
      : 0;

    // Reorder quantity: 7 days of sales, rounded up to pack boundaries
    const target7d = sold7d; // already in base_units for 7 days
    const packs = Math.ceil(target7d / pack);
    const suggestedBaseUnits = packs * pack;

    // Cost to reorder
    const packsForCost = Math.ceil(suggestedBaseUnits / pack);
    const reorderCostPaisa = packsForCost * rawCost;

    items.push({
      product_id: p.id,
      name: p.name,
      base_unit: p.base_unit,
      pack_size_base_units: pack,
      stock_base_units: p.stock_base_units,
      sold_7d: sold7d,
      days_of_stock: daysOfStock,
      margin_per_pack_paisa: Math.max(0, marginPerPackPaisa),
      daily_profit_at_risk_paisa: dailyProfitAtRisk,
      suggested_reorder_base_units: suggestedBaseUnits,
      reorder_cost_paisa: Math.max(0, reorderCostPaisa),
      effective_cost_paisa: costPaisaPerUnit,
      effective_price_paisa: pricePaisaPerUnit,
    });
  }

  // Sort: primary = daily_profit_at_risk_paisa desc, secondary = days_of_stock asc
  items.sort((a, b) =>
    b.daily_profit_at_risk_paisa - a.daily_profit_at_risk_paisa ||
    a.days_of_stock - b.days_of_stock ||
    a.name.localeCompare(b.name),
  );

  const topItems = items.slice(0, topN);

  let totalCost = 0;
  let affordableCount = 0;
  let runningCash = cashInGallaPaisa;
  for (const item of topItems) {
    totalCost += item.reorder_cost_paisa;
    if (item.reorder_cost_paisa <= runningCash) {
      affordableCount++;
      // Don't subtract cash here — shopkeeper decides individually
    }
  }

  return {
    items: topItems,
    total_reorder_cost_paisa: totalCost,
    cash_available_paisa: cashInGallaPaisa,
    affordable_count: topItems.filter((i) => i.reorder_cost_paisa <= cashInGallaPaisa).length,
    unaffordable_count: topItems.filter((i) => i.reorder_cost_paisa > cashInGallaPaisa).length,
  };
}

/**
 * Format a reorder item into a human-readable restock SMS / WhatsApp line.
 * Example: "Cheeni 5kg (Rs. 2,500) — aaj khatam ho sakta hai"
 */
export function formatReorderLine(item: ReorderItem): string {
  const qty = item.suggested_reorder_base_units;
  const unit = item.base_unit;
  const qtyLabel =
    unit === "g" ? `${qty / 1000}kg` :
    unit === "ml" ? `${qty / 1000}L` :
    `${qty} ${unit}`;
  const cost = Math.round(item.reorder_cost_paisa / 100);
  const urgency = item.days_of_stock === 0 ? "aaj khatam" : `${item.days_of_stock}d mein khatam`;
  return `${item.name} ${qtyLabel} (Rs. ${cost.toLocaleString("en-US")}) — ${urgency}`;
}
