import { describe, expect, it } from "vitest";
import type { ShopState } from "@/lib/api/contracts";
import { applyOptimisticOverlay, type QueuedCommit } from "@/lib/client/queue";

function makeState(): ShopState {
  return {
    shop: {
      id: "shop-1",
      name: "Bismillah Kiryana",
      owner_name: "Tariq",
      phone: "03001234567",
      city: "Rawalpindi",
      is_demo_shop: true,
      is_stage_shop: false,
      active_since: "2026-11-01T00:00:00Z",
    },
    today: {
      cash_sales_paisa: 100000,
      sales_count: 2,
      cash_sales_count: 2,
      udhaar_paisa: 0,
      udhaar_accounts: 0,
      gross_sales_paisa: 100000,
      wasooli_paisa: 0,
      purchases_cash_paisa: 0,
      cash_in_galla_paisa: 100000,
      est_margin_paisa: 12000,
    },
    feed: [],
    customers: [
      { id: "c-ali", name: "Chhote Ali", aliases: [], phone: "03001111111", role_tag: null, balance_paisa: 20000, last_paid_at: null, code: "C01", days_overdue: 5 },
    ],
    products: [
      {
        id: "p-cheeni",
        name: "Cheeni",
        name_ur: "چینی",
        aliases: ["cheeni"],
        base_unit: "g",
        pack_size_base_units: 1000,
        unit_price_paisa: 16000,
        cost_price_paisa: 13000,
        stock_base_units: 1000,
        sku_code: "SKU-1",
        is_quick_added: false,
        sold_7d: 7000,
        days_left: 1,
      },
    ],
    chain_head: { seq: 5, entry_hash: "deadbeef" },
    sql_ms: 5,
  };
}

describe("applyOptimisticOverlay", () => {
  it("applies FIFO offline commits to galla, customer balance, soft negative stock, and pending feed without fabricating hashes", () => {
    const commits: QueuedCommit[] = [
      {
        idempotency_key: "sale-1",
        shop_id: "shop-1",
        endpoint: "/api/transactions/commit",
        payload: { idempotency_key: "sale-1" },
        created_at: 1000,
        attempts: 0,
        status: "pending",
        optimistic: {
          type: "sale",
          customer_id: "c-ali",
          customer_name: "Chhote Ali",
          total_paisa: 32000,
          cash_paid_paisa: 10000,
          credit_paisa: 22000,
          lines: [{ product_id: "p-cheeni", name: "Cheeni", qty_base_units: 2000, base_unit: "g", line_total_paisa: 32000, value_first: false }],
          label: "2kg Cheeni",
        },
      },
      {
        idempotency_key: "pay-1",
        shop_id: "shop-1",
        endpoint: "/api/transactions/payment",
        payload: { idempotency_key: "pay-1" },
        created_at: 2000,
        attempts: 0,
        status: "pending",
        optimistic: {
          type: "payment",
          customer_id: "c-ali",
          customer_name: "Chhote Ali",
          total_paisa: 5000,
          cash_paid_paisa: 5000,
          credit_paisa: 0,
          label: "Wasooli Rs. 50",
        },
      },
    ];

    const next = applyOptimisticOverlay(makeState(), commits)!;
    expect(next.today.gross_sales_paisa).toBe(132000);
    expect(next.today.cash_in_galla_paisa).toBe(115000);
    expect(next.customers[0].balance_paisa).toBe(37000); // 20000 + 22000 - 5000
    expect(next.products[0].stock_base_units).toBe(-1000); // soft negative stock never blocked
    expect(next.feed).toHaveLength(2);
    expect(next.feed[0].seq).toBeLessThan(0);
    expect(next.feed[0].entry_hash).toBe("pending");
    expect(next.feed[0].audit_meta.pending_sync).toBe(true);
  });
});
