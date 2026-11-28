/**
 * Wholesale Margin Guard for Parchi-to-Godam batch OCR.
 * Detects silent supplier rate hikes and generates Urdu voice alerts + suggested retail prices.
 */

import type { StateProduct } from "@/lib/api/contracts";
import type { ParchiReviewLine } from "@/lib/ai/parchi";
import { mulDiv } from "./money";

export interface ParchiRateAlert {
  productId: string;
  name: string;
  oldCostPaisa: number;
  newCostPaisa: number;
  deltaPaisa: number;
  currentRetailPaisa: number;
  suggestedRetailPaisa: number;
  isLoss: boolean;
}

function roundUpRs5(paisa: number): number {
  return Math.ceil(paisa / 500) * 500;
}

/** Compute per-pack wholesale cost from a Parchi line and compare against catalog cost. */
export function detectParchiMarginAlerts(
  lines: ParchiReviewLine[],
  products: StateProduct[],
  targetMarginPct = 10,
): ParchiRateAlert[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const alerts: ParchiRateAlert[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (line.match_status !== "matched" || !line.product_id || seen.has(line.product_id)) continue;
    const prod = byId.get(line.product_id);
    if (!prod || prod.cost_price_paisa <= 0) continue;

    let newCostPaisa = line.rate_paisa ?? 0;
    if (newCostPaisa <= 0 && line.line_total_paisa && line.qty_base_units && line.qty_base_units > 0) {
      const packs = line.qty_base_units / Math.max(1, prod.pack_size_base_units);
      if (packs > 0) newCostPaisa = Math.round(line.line_total_paisa / packs);
    }
    if (newCostPaisa <= prod.cost_price_paisa) continue;

    const deltaPaisa = newCostPaisa - prod.cost_price_paisa;
    // Ignore tiny rounding noise under Rs. 1
    if (deltaPaisa < 100) continue;

    seen.add(prod.id);
    const rawTarget = mulDiv(newCostPaisa, 100, Math.max(1, 100 - targetMarginPct));
    const suggestedRetailPaisa = Math.max(roundUpRs5(rawTarget), prod.unit_price_paisa);

    alerts.push({
      productId: prod.id,
      name: prod.name_ur || prod.name,
      oldCostPaisa: prod.cost_price_paisa,
      newCostPaisa,
      deltaPaisa,
      currentRetailPaisa: prod.unit_price_paisa,
      suggestedRetailPaisa: suggestedRetailPaisa > prod.unit_price_paisa ? suggestedRetailPaisa : roundUpRs5(newCostPaisa + 1000),
      isLoss: newCostPaisa >= prod.unit_price_paisa,
    });
  }

  return alerts.sort((a, b) => Number(b.isLoss) - Number(a.isLoss) || b.deltaPaisa - a.deltaPaisa);
}

export function parchiMarginSpeech(alerts: ParchiRateAlert[]): string {
  if (alerts.length === 0) return "";
  const first = alerts[0];
  const deltaRs = Math.round(first.deltaPaisa / 100);
  const sugRs = Math.round(first.suggestedRetailPaisa / 100);
  const cleanName = first.name.replace(/\s*\(.*\)/, "");
  if (alerts.length === 1) {
    return `خبردار: ${cleanName} کا ہول سیل ریٹ ${deltaRs} روپے بڑھ گیا ہے — کیا نیا ریٹیل ریٹ ${sugRs} روپے سیٹ کر دوں؟`;
  }
  return `خبردار: ${alerts.length} اشیاء کا ہول سیل ریٹ بڑھ گیا ہے۔ ${cleanName} ${deltaRs} روپے مہنگا ہو گیا ہے — نیا ریٹیل ریٹ ${sugRs} روپے سیٹ کریں۔`;
}
