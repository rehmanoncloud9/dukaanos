import type { SupabaseClient } from "@supabase/supabase-js";
import { rpc } from "@/lib/supabase/server";
import { stateToCatalog, type ShopState } from "./contracts";

/** Normalise bigint-as-string columns from PostgREST into numbers (all values are < 2^53). */
export function numify<T>(v: T): T {
  if (Array.isArray(v)) return v.map(numify) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = /(_paisa|_base_units|^seq$|^sold_7d$|^qty_base_units$|_count$|^count$)/.test(k) && typeof x === "string" && /^-?\d+$/.test(x) ? Number(x) : numify(x);
    }
    return out as T;
  }
  return v;
}

export async function loadState(sb: SupabaseClient, shopId: string): Promise<ShopState> {
  return numify(await rpc<ShopState>(sb, "get_shop_state_with_stock_age", { p_shop_id: shopId }));
}

export async function loadCatalog(sb: SupabaseClient, shopId: string) {
  const state = await loadState(sb, shopId);
  return { state, catalog: stateToCatalog(state) };
}
