import { describe, expect, it } from "vitest";
import { parseCustomerCsv } from "@/lib/client/csv-import";

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
