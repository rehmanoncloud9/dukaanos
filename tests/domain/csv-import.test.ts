import { describe, expect, it } from "vitest";
import { parseCustomerCsv, parseProductCsv } from "@/lib/client/csv-import";

describe("parseCustomerCsv", () => {
  it("parses UTF-8 BOM CSV with quoted commas and PKR balances", () => {
    const csv = '\uFEFFName,Phone,Balance (PKR)\r\n"Ali, Chhote",0300-1234567,1250.50\r\nBilal,,500\r\n';
    const res = parseCustomerCsv(csv);
    expect(res).toEqual([
      { name: "Ali, Chhote", phone: "0300-1234567", balance_paisa: 125050 },
      { name: "Bilal", phone: null, balance_paisa: 50000 },
    ]);
  });

  it("handles headerless CSVs cleanly", () => {
    const res = parseCustomerCsv("Tariq,03211112222,0");
    expect(res).toEqual([{ name: "Tariq", phone: "03211112222", balance_paisa: 0 }]);
  });
});

describe("parseProductCsv", () => {
  it("parses product catalog CSV with units, prices, and opening stock", () => {
    const csv = "Name,Unit,Sell,Cost,Opening\nCheeni,kg,160,145,25\nLux Sabun,pcs,100,,12\n";
    const res = parseProductCsv(csv);
    expect(res).toEqual([
      { name: "Cheeni", base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 16000, cost_price_paisa: 14500, opening_stock_base_units: 25000 },
      { name: "Lux Sabun", base_unit: "pcs", pack_size_base_units: 1, unit_price_paisa: 10000, cost_price_paisa: 8500, opening_stock_base_units: 12 },
    ]);
  });
});
