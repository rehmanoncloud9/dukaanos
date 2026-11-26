"use client";

import { useEffect, useState } from "react";
import { api, friendlyError } from "@/lib/client/api";
import { useDukaan } from "@/lib/client/store";
import { formatRs } from "@/lib/domain/money";

/* ───────────── 7F Supplier Price Memory ───────────── */

export interface PriceMemoryItem {
  product_id: string;
  name: string;
  retail_price_paisa: number;
  last_cost_paisa: number;
  prev_cost_paisa: number;
  change_bp: number;
  margin_before_bp: number | null;
  margin_now_bp: number | null;
  suggested_price_paisa: number | null;
  supplier_name: string | null;
}

/** After a restock: which items got costlier vs the previous parchi, the margin they ate, and a one-tap fair price. */
export function PriceMemoryCard() {
  const { refresh, toast } = useDukaan();
  const [items, setItems] = useState<PriceMemoryItem[] | null>(null);
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  useEffect(() => {
    api<{ items: PriceMemoryItem[] }>("/api/shop/price-memory?min_bp=300")
      .then((r) => setItems(r.items.filter((i) => i.change_bp > 0).slice(0, 4)))
      .catch(() => setItems([]));
  }, []);
  if (!items || items.length === 0) return null;

  const apply = async (i: PriceMemoryItem) => {
    if (!i.suggested_price_paisa) return;
    try {
      await api("/api/shop/price", { json: { product_id: i.product_id, unit_price_paisa: i.suggested_price_paisa } });
      setApplied((a) => ({ ...a, [i.product_id]: true }));
      void refresh();
      toast(`${i.name}: naya rate ${formatRs(i.suggested_price_paisa)}`, "ok");
    } catch (e) {
      toast(friendlyError(e), "err");
    }
  };

  return (
    <div className="surface-card overflow-hidden">
      <div className="px-4 pt-3.5">
        <div className="section-label">Price memory · cheezein mehngi huin</div>
      </div>
      {items.map((i) => (
        <div key={i.product_id} className="hairline-b px-4 py-3 last:border-b-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-semibold">{i.name}</span>
            <span className="num shrink-0 text-[14px] font-bold text-udhaar">+{(i.change_bp / 100).toFixed(1)}%</span>
          </div>
          <div className="num text-[13px] text-ink-2">
            Thok {formatRs(i.prev_cost_paisa)} → {formatRs(i.last_cost_paisa)}
            {i.margin_before_bp !== null && i.margin_now_bp !== null && ` · margin ${(i.margin_before_bp / 100).toFixed(0)}% → ${(i.margin_now_bp / 100).toFixed(0)}%`}
          </div>
          {i.suggested_price_paisa && (
            <button onClick={() => void apply(i)} disabled={applied[i.product_id]}
              className="tactile mt-2 h-11 rounded-[12px] bg-maal px-3.5 text-[14px] font-semibold text-white disabled:opacity-60">
              {applied[i.product_id] ? "Rate update ho gaya ✓" : `Becho ${formatRs(i.retail_price_paisa)} → ${formatRs(i.suggested_price_paisa)}`}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
