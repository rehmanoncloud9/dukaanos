import { describe, expect, it } from "vitest";
import { exportKhataCsv, exportMaalCsv } from "@/lib/client/csv-export";
import { normalizePkPhone, STARTER_KIRYANA_SKUS } from "@/lib/domain/starter-catalog";

describe("Phase B helpers", () => {
  it("normalizes Pakistani mobile numbers to +92 E.164", () => {
    expect(normalizePkPhone("0300-1234567")).toBe("+923001234567");
    expect(normalizePkPhone("3001234567")).toBe("+923001234567");
    expect(normalizePkPhone("923001234567")).toBe("+923001234567");
    expect(normalizePkPhone("+923001234567")).toBe("+923001234567");
    expect(() => normalizePkPhone("12345")).toThrow();
  });

  it("keeps integer paisa & pack sizes across starter kiryana SKUs", () => {
    expect(STARTER_KIRYANA_SKUS.length).toBeGreaterThanOrEqual(20);
    for (const s of STARTER_KIRYANA_SKUS) {
      expect(Number.isInteger(s.unit_price_paisa)).toBe(true);
      expect(Number.isInteger(s.cost_price_paisa)).toBe(true);
      expect(Number.isInteger(s.pack_size_base_units)).toBe(true);
      expect(s.aliases.length).toBeGreaterThan(0);
    }
  });

  it("exports Khata and Maal CSVs with UTF-8 BOM and RFC-4180 escaping", () => {
    const khata = exportKhataCsv([
      {
        id: "c1",
        name: 'Ali, "Chhote"',
        aliases: [],
        phone: "03001234567",
        role_tag: "Bakery",
        balance_paisa: 12550,
        last_paid_at: "2026-11-25",
        code: "C1",
        days_overdue: 16,
      },
    ]);
    expect(khata.startsWith("\uFEFFName,Role,Phone")).toBe(true);
    expect(khata).toContain('"Ali, ""Chhote"""');
    expect(khata).toContain("125.50");

    const maal = exportMaalCsv([
      {
        id: "p1",
        name: "Cheeni",
        name_ur: "چینی",
        aliases: ["cheeni"],
        base_unit: "g",
        pack_size_base_units: 1000,
        unit_price_paisa: 16000,
        cost_price_paisa: 14500,
        stock_base_units: 2500,
        sku_code: "STR-01",
        is_quick_added: false,
        sold_7d: 7000,
        days_left: 2,
      },
    ]);
    expect(maal.startsWith("\uFEFFSKU,Name,Urdu Name")).toBe(true);
    expect(maal).toContain("چینی");
    expect(maal).toContain("160.00");
  });
});
