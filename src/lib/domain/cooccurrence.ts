/**
 * Deterministic basket co-occurrence engine — zero LLM, zero network, <1ms.
 *
 * Scans `state.feed` (last 90 days of sales) to build a co-occurrence index:
 * "which products appear together in the same basket most often?"
 * Then `suggestCompanionItems()` returns the top-N companion products for the
 * items already in the open SaleProposal so the shopkeeper can tap "+ Add".
 *
 * All arithmetic is integer — product IDs only, no money.
 */

import type { FeedTx } from "@/lib/api/contracts";
import type { StateProduct } from "@/lib/api/contracts";

export interface CompanionSuggestion {
  product_id: string;
  name: string;
  /** Number of baskets where this product appeared with one of the basket products. */
  co_count: number;
  /** Current in-stock units (base_units). */
  stock_base_units: number;
  unit_price_paisa: number;
  base_unit: string;
}

/**
 * Build a co-occurrence index from the feed.
 * Returns a Map: product_id → Map<companion_id, count>
 * Only "sale" transactions with ≥2 lines are indexed.
 * Runs in O(T × L²) where T = transactions, L = avg lines per basket (≤40).
 */
export function buildCoOccurrenceIndex(feed: FeedTx[]): Map<string, Map<string, number>> {
  const index = new Map<string, Map<string, number>>();

  for (const tx of feed) {
    if (tx.type !== "sale") continue;
    const ids = tx.lines
      .map((l) => l.product_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length < 2) continue;

    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        const a = ids[i];
        const b = ids[j];
        if (!index.has(a)) index.set(a, new Map());
        const companions = index.get(a)!;
        companions.set(b, (companions.get(b) ?? 0) + 1);
      }
    }
  }

  return index;
}

/**
 * Suggest up to `topN` companion products for the given basket.
 * Products already in the basket are excluded.
 * Products with zero or negative stock are excluded.
 * Results are sorted by co-occurrence count descending.
 *
 * @param basketProductIds  IDs of products already in the open SaleProposal
 * @param index             Pre-built co-occurrence index from `buildCoOccurrenceIndex`
 * @param products          Full product catalog for name + stock lookup
 * @param topN              How many suggestions to return (default 2)
 */
export function suggestCompanionItems(
  basketProductIds: string[],
  index: Map<string, Map<string, number>>,
  products: StateProduct[],
  topN = 2,
): CompanionSuggestion[] {
  if (basketProductIds.length === 0 || index.size === 0) return [];

  const inBasket = new Set(basketProductIds);
  const scores = new Map<string, number>();

  for (const pid of basketProductIds) {
    const companions = index.get(pid);
    if (!companions) continue;
    for (const [companion, count] of companions) {
      if (inBasket.has(companion)) continue;
      scores.set(companion, (scores.get(companion) ?? 0) + count);
    }
  }

  if (scores.size === 0) return [];

  // Sort by score descending, then alphabetically for stability
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const result: CompanionSuggestion[] = [];
  for (const [companion_id, co_count] of sorted) {
    if (result.length >= topN) break;
    const product = products.find((p) => p.id === companion_id);
    if (!product) continue;
    if (product.stock_base_units <= 0) continue;
    result.push({
      product_id: companion_id,
      name: product.name,
      co_count,
      stock_base_units: product.stock_base_units,
      unit_price_paisa: product.unit_price_paisa,
      base_unit: product.base_unit,
    });
  }

  return result;
}

/**
 * Convenience: build index then suggest in a single call.
 * Use this when you don't need to cache the index.
 */
export function quickSuggest(
  basketProductIds: string[],
  feed: FeedTx[],
  products: StateProduct[],
  topN = 2,
): CompanionSuggestion[] {
  const index = buildCoOccurrenceIndex(feed);
  return suggestCompanionItems(basketProductIds, index, products, topN);
}
