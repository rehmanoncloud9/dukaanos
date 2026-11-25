import type { StateProduct } from "@contracts";
import { formatBaseQty } from "@domain/desi-units";

export type MaalFilter = "all" | "low";

export function normalizeMaalFilter(raw?: string | string[] | null): MaalFilter {
  const val = Array.isArray(raw) ? raw[0] : raw;
  return val === "low" ? "low" : "all";
}

/** Formats stock against reorder level, e.g. "4.2 / 25 kg", "2 / 12 tin", "24 / 12 pcs". */
export function stockLabel(
  p: Pick<
    StateProduct,
    "stock_base_units" | "reorder_level_base_units" | "base_unit" | "pack_size_base_units"
  >,
): string {
  const s = p.stock_base_units;
  const r = p.reorder_level_base_units ?? 0;
  if (p.base_unit !== "pcs" && p.pack_size_base_units > 1000) {
    const f = (v: number) => {
      const ratio = v / p.pack_size_base_units;
      return Number.isInteger(ratio) ? String(ratio) : ratio.toFixed(1);
    };
    return `${f(s)} / ${f(r)} tin`;
  }
  if (p.base_unit === "pcs") return `${s} / ${r} pcs`;
  const big = p.base_unit === "g" ? "kg" : "L";
  const f = (v: number) => (v / 1000).toFixed(Math.abs(v) % 1000 === 0 ? 0 : 1);
  return `${f(s)} / ${f(r)} ${big}`;
}

export function isLowStock(
  p: Pick<StateProduct, "stock_base_units" | "reorder_level_base_units" | "days_left">,
): boolean {
  const reorder = p.reorder_level_base_units ?? 0;
  return (
    p.stock_base_units <= 0 ||
    (reorder > 0 && p.stock_base_units <= reorder * 0.25) ||
    (p.days_left !== null && p.days_left <= 2.5)
  );
}

export function stockProgressPct(
  p: Pick<StateProduct, "stock_base_units" | "reorder_level_base_units">,
): number {
  const reorder = p.reorder_level_base_units ?? 0;
  if (reorder <= 0) return p.stock_base_units <= 0 ? 0 : 1;
  return Math.max(0, Math.min(1, p.stock_base_units / reorder));
}

export function unitPriceBasisLabel(
  p: Pick<StateProduct, "base_unit" | "pack_size_base_units">,
): string {
  if (p.base_unit === "pcs") {
    return p.pack_size_base_units === 1 ? "pc" : `${p.pack_size_base_units} pcs`;
  }
  if (p.pack_size_base_units === 1000) {
    return p.base_unit === "g" ? "kg" : "L";
  }
  return formatBaseQty(p.pack_size_base_units, p.base_unit);
}

export function sortAndFilterProducts(
  products: StateProduct[],
  filter: MaalFilter,
): StateProduct[] {
  const sorted = products
    .slice()
    .sort((a, b) => Number(isLowStock(b)) - Number(isLowStock(a)) || a.name.localeCompare(b.name));
  return filter === "low" ? sorted.filter(isLowStock) : sorted;
}
