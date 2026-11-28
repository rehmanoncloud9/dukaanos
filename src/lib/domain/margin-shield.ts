import type { StateProduct } from "@/lib/api/contracts";
import { mulDiv } from "./money";

export interface MarginAlert {
  product: StateProduct;
  margin_pct: number;
  is_loss: boolean;
  suggested_price_paisa: number;
  weekly_gain_paisa: number;
}

/** Round paisa up to the nearest Rs. 5 (500 paisa) for clean Pakistani retail pricing. */
function roundUpRs5(paisa: number): number {
  const step = 500;
  return Math.ceil(paisa / step) * step;
}

/**
 * Margin Shield ("Munafa Bachao"): deterministically detects SKUs selling at a loss or
 * razor-thin margin after wholesale inflation, and suggests a clean retail price.
 */
export function analyzeMargins(
  products: StateProduct[],
  targetMarginPct = 10,
  alertBelowPct = 5,
): MarginAlert[] {
  const alerts: MarginAlert[] = [];
  for (const p of products) {
    if (p.cost_price_paisa <= 0 || p.unit_price_paisa <= 0) continue;
    const diff = p.unit_price_paisa - p.cost_price_paisa;
    const marginPct = Math.round((diff * 100) / p.unit_price_paisa);
    if (marginPct >= alertBelowPct) continue;

    // Target retail price = cost / (1 - targetMarginPct / 100), rounded up to nearest Rs. 5
    const rawTarget = mulDiv(p.cost_price_paisa, 100, Math.max(1, 100 - targetMarginPct));
    const suggested = Math.max(roundUpRs5(rawTarget), p.unit_price_paisa + 500);
    const unitsPerPack = Math.max(1, p.pack_size_base_units || (p.base_unit === "pcs" ? 1 : 1000));
    const soldUnits = p.sold_7d > 0 ? p.sold_7d / unitsPerPack : 0;
    const weeklyGain = Math.round(soldUnits * (suggested - p.unit_price_paisa));

    alerts.push({
      product: p,
      margin_pct: marginPct,
      is_loss: diff <= 0,
      suggested_price_paisa: suggested,
      weekly_gain_paisa: Math.max(0, weeklyGain),
    });
  }
  return alerts.sort((a, b) => a.margin_pct - b.margin_pct || b.weekly_gain_paisa - a.weekly_gain_paisa);
}
