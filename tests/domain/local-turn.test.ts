import { describe, expect, it } from "vitest";
import type { ShopState } from "@/lib/api/contracts";
import { tryLocalTurn } from "@/lib/client/local-turn";

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
      cash_sales_paisa: 150000,
      sales_count: 4,
      cash_sales_count: 3,
      udhaar_paisa: 50000,
      udhaar_accounts: 1,
      gross_sales_paisa: 200000,
      wasooli_paisa: 25000,
      purchases_cash_paisa: 0,
      cash_in_galla_paisa: 175000,
      est_margin_paisa: 24000,
    },
    feed: [],
    customers: [
      { id: "c-bilal", name: "Bilal", aliases: [], phone: "03001111111", role_tag: null, balance_paisa: 50000, last_paid_at: null, code: "C01", days_overdue: 20 },
      { id: "c-ali-1", name: "Chhote Ali", aliases: ["Ali"], phone: "03002222222", role_tag: "Bakery", balance_paisa: 30000, last_paid_at: null, code: "C02", days_overdue: 5 },
      { id: "c-ali-2", name: "Bade Ali", aliases: ["Ali"], phone: "03003333333", role_tag: "Chai", balance_paisa: 40000, last_paid_at: null, code: "C03", days_overdue: 2 },
    ],
    products: [
      {
        id: "p-cheeni",
        name: "Cheeni",
        name_ur: "چینی",
        aliases: ["cheeni", "sugar"],
        base_unit: "g",
        pack_size_base_units: 1000,
        unit_price_paisa: 16000,
        cost_price_paisa: 13000,
        stock_base_units: 15000,
        sku_code: "SKU-1",
        is_quick_added: false,
        sold_7d: 21000,
        days_left: 5,
      },
      {
        id: "p-atta",
        name: "Atta",
        name_ur: "آٹا",
        aliases: ["atta", "flour"],
        base_unit: "g",
        pack_size_base_units: 1000,
        unit_price_paisa: 14000,
        cost_price_paisa: 11000,
        stock_base_units: 1000,
        sku_code: "SKU-2",
        is_quick_added: false,
        sold_7d: 7000,
        days_left: 1,
      },
    ],
    chain_head: { seq: 10, entry_hash: "abc" },
    sql_ms: 8,
  };
}

describe("tryLocalTurn", () => {
  it("resolves offline text sales with desi units against cached ShopState", () => {
    const res = tryLocalTurn("dhai kilo cheeni cash", makeState(), { offline: true });
    expect(res?.kind).toBe("sale");
    if (res?.kind === "sale") {
      expect(res.proposal.lines[0].qty_base_units).toBe(2500);
      expect(res.proposal.total_paisa).toBe(40000);
      expect(res.proposal.tier).toBe(2); // offline fallback always requires review
    }
  });

  it("computes offline pulse from cached state", () => {
    const res = tryLocalTurn("subah ka hisaab", makeState(), { offline: true });
    expect(res?.kind).toBe("pulse");
    if (res?.kind === "pulse") {
      expect(res.pulse.overdue.count).toBe(1);
      expect(res.pulse.stockout.count).toBe(1);
      expect(res.pulse.llm_cost_rs).toBe(0);
    }
  });

  it("fast-paths unambiguous exact online text sales at Rs. 0 LLM", () => {
    const res = tryLocalTurn("2 kilo cheeni cash", makeState(), { offline: false });
    expect(res?.kind).toBe("sale");
    if (res?.kind === "sale") {
      expect(res.proposal.total_paisa).toBe(32000);
      expect(res.proposal.tier).toBe(1); // exact unambiguous cash sale qualifies for Tier-1 5s Undo at Rs. 0 LLM
      expect(res.trace.source).toBe("regex");
      expect(res.trace.model).toBeNull();
    }
  });

  it("falls through to Gemini online when customer is ambiguous (3 Alis)", () => {
    const res = tryLocalTurn("Ali ko 2 kilo cheeni udhaar", makeState(), { offline: false });
    expect(res).toBeNull();
  });

  it("falls through to Gemini online when product match is fuzzy or unknown", () => {
    const res = tryLocalTurn("2 kilo zafran cash", makeState(), { offline: false });
    expect(res).toBeNull();
  });

  it("falls through to Gemini online for open-ended questions", () => {
    const res = tryLocalTurn("aaj kitna munafa hua?", makeState(), { offline: false });
    expect(res).toBeNull();
  });
});
