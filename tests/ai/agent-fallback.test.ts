import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAgent } from "@/lib/ai/agent";
import type { Catalog } from "@/lib/domain/types";

const originalKey = process.env.GEMINI_API_KEY;

const catalog: Catalog = {
  products: [
    {
      id: "p-cheeni",
      name: "Cheeni",
      name_ur: "چینی",
      aliases: ["sugar", "chini"],
      base_unit: "g",
      pack_size_base_units: 1000,
      unit_price_paisa: 15000,
      cost_price_paisa: 13000,
      stock_base_units: 12000,
    },
  ],
  customers: [
    {
      id: "c-bilal",
      name: "Bilal",
      aliases: ["bilal bhai"],
      role_tag: "Regular",
      balance_paisa: 45000,
    },
  ],
};

function mockSb(): SupabaseClient {
  return {
    rpc: async (fn: string) => {
      if (fn === "get_munshi_pulse") {
        return {
          data: {
            today: { sales_paisa: 250000, cash_paisa: 150000, udhaar_paisa: 100000 },
            overdue_udhaar: [{ id: "c-bilal" }],
            stockout_risks: [],
          },
          error: null,
        };
      }
      if (fn === "get_shop_state") {
        return {
          data: {
            feed: [{ type: "sale", customer_name: "Bilal", total_paisa: 50000, created_at: "2026-11-25T10:00:00Z" }],
            products: [{ id: "p-cheeni", name: "Cheeni", stock_base_units: 12000, base_unit: "g", unit_price_paisa: 15000, sold_7d: 5000, days_left: 16 }],
            customers: [{ id: "c-bilal", name: "Bilal", balance_paisa: 45000, days_overdue: 18, last_paid_at: null, role_tag: "Regular" }],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}

describe("Agent deterministic fallback when model is unavailable", () => {
  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  it("answers pulse, customer udhaar, and product stock queries without an API key", async () => {
    delete process.env.GEMINI_API_KEY;
    const sb = mockSb();

    const pulse = await runAgent({ question: "Aaj ka hisaab kya hai?", sb, shopId: "s1", shopName: "Bismillah Store", catalog });
    expect(pulse.model).toBe("rules-fallback");
    expect(pulse.answer).toContain("Rs. 2,500");

    const udhaar = await runAgent({ question: "Bilal ka udhaar kitna hai?", sb, shopId: "s1", shopName: "Bismillah Store", catalog });
    expect(udhaar.model).toBe("rules-fallback");
    expect(udhaar.answer).toContain("Bilal");
    expect(udhaar.answer).toContain("Rs. 450");

    const stock = await runAgent({ question: "Cheeni kitni bachi hai?", sb, shopId: "s1", shopName: "Bismillah Store", catalog });
    expect(stock.model).toBe("rules-fallback");
    expect(stock.answer).toContain("Cheeni");
  });
});
