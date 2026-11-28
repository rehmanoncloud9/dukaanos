import { describe, expect, it } from "vitest";
import type { ShopState } from "@/lib/api/contracts";
import type { ParchiReviewLine } from "@/lib/ai/parchi";
import { computeAajKiSalah } from "@/lib/domain/aaj-ki-salah";
import { parseQuantityPhrase, quantityToBaseUnits } from "@/lib/domain/desi-units";
import { matchCatalog } from "@/lib/domain/pakphone";
import { detectParchiMarginAlerts, parchiMarginSpeech } from "@/lib/domain/parchi-margin";

describe("5,000+ SKU Scalability & Autonomous Munshi", () => {
  it("matches 5,000+ SKUs in <20ms using inverted phonetic index", () => {
    const entries = Array.from({ length: 5200 }, (_, i) => ({
      id: `sku-${i}`,
      name: i === 3456 ? "Daal Chana" : `Item ${i} Brand ${i % 50}`,
      aliases: i === 3456 ? ["chana dal", "دال چنا"] : [`alias-${i}`],
    }));
    // Warm up WeakMap index once (as happens on app load)
    matchCatalog("warm up", entries, 5);

    const t0 = performance.now();
    const report = matchCatalog("chana dal", entries, 5);
    const elapsed = performance.now() - t0;

    expect(report.results[0]?.id).toBe("sku-3456");
    expect(elapsed).toBeLessThan(20);
  });

  it("supports Pakistani wholesale unit mann (40 kg) and adha pao (125 g)", () => {
    const mann = parseQuantityPhrase("2 mann");
    expect(mann.unresolved).toBe(false);
    expect(quantityToBaseUnits(mann, { name: "Basmati Chawal", base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 35_000 })).toBe(80_000);

    const adhaPao = parseQuantityPhrase("adha pao");
    expect(adhaPao.unresolved).toBe(false);
    expect(quantityToBaseUnits(adhaPao, { name: "Cheeni", base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 20_000 })).toBe(125);
  });

  it("detects supplier rate hikes in Parchi Margin Guard and produces Urdu voice alert", () => {
    const products = [
      {
        id: "p1",
        sku_code: "DM-1",
        name: "Daal Masoor",
        name_ur: "دال مسور",
        base_unit: "g" as const,
        pack_size_base_units: 1000,
        unit_price_paisa: 30_000, // Rs 300
        cost_price_paisa: 26_000, // Rs 260
        stock_base_units: 10_000,
        reorder_level_base_units: 5000,
        aliases: [],
        is_quick_added: false,
        sold_7d: 5000,
        days_left: 2,
      },
    ];
    const lines: ParchiReviewLine[] = [
      {
        key: "l1",
        raw: { name: "Daal Masoor", quantity: "10", unit: "kg", rate: "278", line_total: "2780" },
        written_name: "Daal Masoor",
        match_status: "matched",
        product_id: "p1",
        name: "Daal Masoor",
        match_score: 0.99,
        base_unit: "g",
        pack_size_base_units: 1000,
        conversion_unresolved: false,
        qty_number: 10,
        unit: "kg",
        qty_base_units: 10_000,
        rate_paisa: 27_800, // +18 Rs hike!
        written_total_paisa: 278_000,
        computed_total_paisa: 278_000,
        line_total_paisa: 278_000,
        math_mismatch: false,
        manual_review_required: false,
        issues: [],
        low_confidence: false,
        confidence: 0.98,
      },
    ];

    const alerts = detectParchiMarginAlerts(lines, products);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].deltaPaisa).toBe(1800);
    const speech = parchiMarginSpeech(alerts);
    expect(speech).toContain("خبردار");
    expect(speech).toContain("18 روپے");
  });

  it("computes Aaj Ki Salah Friday stockouts & 45-day dead-stock briefing", () => {
    const now = new Date("2026-11-26T09:00:00+05:00"); // Thursday -> 1 day until Friday
    const state: ShopState = {
      shop: {
        id: "s1",
        name: "Bismillah Karyana",
        owner_name: "Tariq",
        phone: null,
        city: "Lahore",
        is_demo_shop: false,
        is_stage_shop: false,
        active_since: "2026-01-01T00:00:00Z",
      },
      today: {
        cash_sales_paisa: 100_000,
        sales_count: 5,
        cash_sales_count: 4,
        udhaar_paisa: 20_000,
        udhaar_accounts: 1,
        gross_sales_paisa: 120_000,
        wasooli_paisa: 0,
        purchases_cash_paisa: 0,
        cash_in_galla_paisa: 100_000,
        est_margin_paisa: 15_000,
      },
      feed: [],
      customers: [],
      products: [
        {
          id: "fast1",
          sku_code: "F1",
          name: "Basmati Chawal",
          name_ur: "باسمتی چاول",
          base_unit: "g",
          pack_size_base_units: 1000,
          unit_price_paisa: 35_000,
          cost_price_paisa: 28_000,
          stock_base_units: 1000,
          reorder_level_base_units: 5000,
          aliases: [],
          is_quick_added: false,
          sold_7d: 7000,
          days_left: 1,
        },
        {
          id: "dead1",
          sku_code: "D1",
          name: "Old Jam",
          name_ur: "پرانا جام",
          base_unit: "pcs",
          pack_size_base_units: 1,
          unit_price_paisa: 45_000,
          cost_price_paisa: 35_000,
          stock_base_units: 10,
          reorder_level_base_units: 2,
          aliases: [],
          is_quick_added: false,
          sold_7d: 0,
          days_left: null,
        },
      ],
      chain_head: null,
      sql_ms: 0,
    };

    const report = computeAajKiSalah(state, now);
    expect(report.fridayStockouts).toHaveLength(1);
    expect(report.deadStock).toHaveLength(1);
    expect(report.briefingUrdu).toContain("باسمتی چاول");
    expect(report.briefingUrdu).toContain("پرانا جام");
  });

  it("matches 1,000+ customers in <20ms and flags duplicate customer names for disambiguation", () => {
    const customers = Array.from({ length: 1200 }, (_, i) => ({
      id: `cust-${i}`,
      name: i === 210 || i === 580 || i === 910 ? "Muhammad Ahmed" : `Customer ${i}`,
      role_tag: i === 210 ? "Gali 4" : i === 580 ? "Driver" : i === 910 ? "Tailor" : null,
      phone: null,
      balance_paisa: (i % 7) * 15_000,
      aliases: i === 210 || i === 580 || i === 910 ? ["Ahmed", "احمد"] : [],
    }));
    const entries = customers.map((c) => ({
      id: c.id,
      name: c.name,
      aliases: [...c.aliases, ...(c.role_tag ? [`${c.name} ${c.role_tag}`] : [])],
    }));
    matchCatalog("warmup", entries, 3);

    const t0 = performance.now();
    const report = matchCatalog("احمد", entries, 3);
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(20);
    expect(report.results.length).toBeGreaterThanOrEqual(2);
    expect(report.results[0]?.score).toBe(1);
    expect(report.results[1]?.score).toBe(1);
  });

  it("handles natural Urdu split sales, customer-linked cash sales, unknown products, and negative stock without blocking", async () => {
    const { parseFallback } = await import("@/lib/domain/fallback-parser");
    const { buildSaleProposal } = await import("@/lib/domain/bill");
    const { deriveInventoryStatus } = await import("@/lib/client/local-db");
    const { tr } = await import("@/lib/client/i18n");

    // 1. Three-hub Urdu navigation labels
    expect(tr("munshi", "ur")).toBe("فروخت");
    expect(tr("khata", "ur")).toBe("ادھار");
    expect(tr("maal", "ur")).toBe("گودام");

    const catalog = {
      products: [
        {
          id: "p-chawal",
          name: "Basmati Chawal",
          name_ur: "باسمتی چاول",
          base_unit: "g" as const,
          pack_size_base_units: 1000,
          unit_price_paisa: 30_000, // Rs. 300/kg
          cost_price_paisa: 25_000,
          stock_base_units: 10_000, // 10 kg recorded stock
          aliases: ["chawal", "چاول", "باسمتی چاول"],
        },
        {
          id: "p-oil",
          name: "Cooking Oil",
          name_ur: "تیل",
          base_unit: "ml" as const,
          pack_size_base_units: 1000,
          unit_price_paisa: 50_000, // Rs. 500/L
          cost_price_paisa: 44_000,
          stock_base_units: 20_000,
          aliases: ["tel", "tail", "تیل"],
        },
      ],
      customers: [
        {
          id: "c-tariq",
          name: "Tariq",
          role_tag: "Bhai",
          phone: "03001112222",
          balance_paisa: 100_000,
          aliases: ["طارق", "Tariq Bhai"],
        },
      ],
    };

    // 2. Natural Urdu split sale: "طارق بھائی کے کھاتے میں پانچ کلو باسمتی چاول اور دو لیٹر تیل لکھ دو، باقی پانچ سو روپے نقد لے لو"
    const parsedSplit = parseFallback(
      "طارق بھائی کے کھاتے میں پانچ کلو باسمتی چاول اور دو لیٹر تیل لکھ دو، باقی پانچ سو روپے نقد لے لو۔",
    );
    expect(parsedSplit.payment_mode).toBe("split");
    expect(parsedSplit.cash_paid_rupees).toBe(500);
    const propSplit = buildSaleProposal(parsedSplit, catalog);
    expect(propSplit.customer.selected_id).toBe("c-tariq");
    expect(propSplit.total_paisa).toBe(250_000); // 5*300 + 2*500 = Rs. 2,500
    expect(propSplit.cash_paid_paisa).toBe(50_000); // Rs. 500 cash
    expect(propSplit.credit_paisa).toBe(200_000); // Rs. 2,000 credit

    // 3. Selling 15 kg Basmati Rice when only 10 kg is in stock -> allows sale + flags NEGATIVE_STOCK
    const propNeg = buildSaleProposal(parseFallback("15 kilo basmati chawal cash"), catalog);
    expect(propNeg.lines[0]?.qty_base_units).toBe(15_000);
    expect(propNeg.lines[0]?.stock_after).toBe(-5_000);
    expect(propNeg.warnings[0]?.code).toBe("NEGATIVE_STOCK");
    expect(deriveInventoryStatus({ stock_base_units: -5_000, is_quick_added: false })).toBe("stock_discrepancy");

    // 4. Selling unregistered product creates provisional new_sku record
    const propNew = buildSaleProposal(parseFallback("300 ka imported honey cash"), catalog);
    expect(propNew.lines[0]?.kind).toBe("new_sku");
    expect(propNew.lines[0]?.line_total_paisa).toBe(30_000);
    expect(deriveInventoryStatus({ stock_base_units: 0, is_quick_added: true })).toBe("provisional");

    // 5. Customer-linked cash sale keeps customer balance unchanged while associating customer
    const propCustCash = buildSaleProposal(parseFallback("Tariq ko دو کلو چاول نقد دے دو"), catalog);
    expect(propCustCash.customer.selected_id).toBe("c-tariq");
    expect(propCustCash.cash_paid_paisa).toBe(60_000);
    expect(propCustCash.credit_paisa).toBe(0);
    expect(propCustCash.new_balance_paisa).toBe(100_000); // unchanged
  });
});
