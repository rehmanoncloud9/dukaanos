import { describe, expect, it } from "vitest";
import { guessParchiUnit, interpretParchiOcr, PARCHI_OCR_ZOD_SCHEMA } from "@/lib/ai/parchi";
import type { ProductRow } from "@/lib/domain/types";

const sugar: ProductRow = {
  id: "sugar",
  name: "Cheeni",
  base_unit: "g",
  pack_size_base_units: 1_000,
  unit_price_paisa: 16_000,
  cost_price_paisa: 12_000,
  stock_base_units: 100_000,
  aliases: ["sugar"],
};

function ocrLine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name_raw: "Cheeni",
    quantity_raw: "dhai",
    unit_raw: "kg",
    rate_raw: "100",
    line_total_raw: "250",
    confidence: 0.99,
    ...overrides,
  };
}

function ocrSlip(line: ReturnType<typeof ocrLine>, total: string | null = "250") {
  return {
    supplier_name: "Wholesale",
    bill_date: null,
    lines: [line],
    bill_total_raw: total,
    legibility: "good" as const,
  };
}

describe("Parchi OCR evidence and deterministic calculations", () => {
  it("requires bounded raw evidence and does not accept model-calculated numeric fields", () => {
    const valid = PARCHI_OCR_ZOD_SCHEMA.safeParse(ocrSlip(ocrLine()));
    expect(valid.success).toBe(true);
    expect(PARCHI_OCR_ZOD_SCHEMA.safeParse(ocrSlip(ocrLine({ name_raw: "" }))).success).toBe(false);
    expect(PARCHI_OCR_ZOD_SCHEMA.safeParse(ocrSlip(ocrLine({ rate_raw: "1".repeat(161) }))).success).toBe(false);
    expect(PARCHI_OCR_ZOD_SCHEMA.safeParse({ ...ocrSlip(ocrLine()), lines: Array.from({ length: 81 }, () => ocrLine()) }).success).toBe(false);
  });

  it("correctly reads package sizes and refuses unknown carton conversions", () => {
    expect(guessParchiUnit("Dalda Oil 5L", "tin")).toEqual({ base_unit: "ml", pack_size_base_units: 5_000, resolved: true });
    expect(guessParchiUnit("Atta 500g", "packet")).toEqual({ base_unit: "g", pack_size_base_units: 500, resolved: true });
    expect(guessParchiUnit("Tapal Danedar (900g)", "packs")).toEqual({ base_unit: "g", pack_size_base_units: 900, resolved: true });
    expect(guessParchiUnit("Pepsi", "botal")).toEqual({ base_unit: "pcs", pack_size_base_units: 1, resolved: true });
    expect(guessParchiUnit("Bulk Atta 5kg", "carton")).toEqual({ base_unit: "g", pack_size_base_units: 5_000, resolved: false });
    expect(guessParchiUnit("Bulk Atta", "bori").resolved).toBe(false);
  });

  it("calculates exact quantities, paisa, line totals, and matching bill totals", () => {
    const checked = PARCHI_OCR_ZOD_SCHEMA.parse(ocrSlip(ocrLine()));
    const result = interpretParchiOcr(checked, [sugar], "gemini-3.5-flash-lite", 30);
    expect(result.lines[0]).toMatchObject({
      match_status: "matched",
      qty_number: 2.5,
      qty_base_units: 2_500,
      rate_paisa: 10_000,
      written_total_paisa: 25_000,
      computed_total_paisa: 25_000,
      line_total_paisa: 25_000,
      manual_review_required: false,
    });
    expect(result.math_check).toEqual({
      passed: true,
      checked: true,
      extracted_total_paisa: 25_000,
      computed_total_paisa: 25_000,
      delta_paisa: 0,
    });
    expect(result.write_tools_bound).toBe(0);
  });

  it("keeps mismatched written totals unselected and detects the grand-total difference", () => {
    const checked = PARCHI_OCR_ZOD_SCHEMA.parse(ocrSlip(ocrLine({ line_total_raw: "190" }), "190"));
    const result = interpretParchiOcr(checked, [sugar], "gemini-3.5-flash-lite", 40);
    expect(result.lines[0]?.math_mismatch).toBe(true);
    expect(result.lines[0]?.line_total_paisa).toBeNull();
    expect(result.lines[0]?.computed_total_paisa).toBe(25_000);
    expect(result.math_check.passed).toBe(false);
    expect(result.math_check.delta_paisa).toBe(-6_000);
    expect(result.manual_review_required).toBe(true);
  });

  it("does not turn missing units or unknown cartons into one-piece quantities", () => {
    const missingUnit = PARCHI_OCR_ZOD_SCHEMA.parse(ocrSlip(ocrLine({ quantity_raw: "2", unit_raw: null, rate_raw: "100", line_total_raw: "200" }), "200"));
    const missingResult = interpretParchiOcr(missingUnit, [sugar], "model", 20);
    expect(missingResult.lines[0]?.qty_base_units).toBeNull();
    expect(missingResult.lines[0]?.manual_review_required).toBe(true);

    const carton = PARCHI_OCR_ZOD_SCHEMA.parse(ocrSlip(ocrLine({ name_raw: "Bulk Atta", quantity_raw: "2", unit_raw: "carton", rate_raw: "400", line_total_raw: "800" }), "800"));
    const cartonResult = interpretParchiOcr(carton, [], "model", 20);
    expect(cartonResult.lines[0]?.qty_base_units).toBeNull();
    expect(cartonResult.lines[0]?.conversion_unresolved).toBe(true);
  });

  it("marks missing and unreadable financial fields for review", () => {
    const checked = PARCHI_OCR_ZOD_SCHEMA.parse(ocrSlip(ocrLine({ quantity_raw: null, unit_raw: null, rate_raw: null, line_total_raw: null }), null));
    const result = interpretParchiOcr(checked, [sugar], "model", 20);
    expect(result.lines[0]?.qty_base_units).toBeNull();
    expect(result.lines[0]?.rate_paisa).toBeNull();
    expect(result.lines[0]?.written_total_paisa).toBeNull();
    expect(result.math_check.checked).toBe(false);
    expect(result.manual_review_required).toBe(true);
  });

  it("handles sub-unit gram lines safely by computing per-kg rate and flagging rate basis for review", () => {
    const checked = PARCHI_OCR_ZOD_SCHEMA.parse(ocrSlip(ocrLine({ quantity_raw: "500", unit_raw: "g", rate_raw: "160", line_total_raw: "80" }), "80"));
    const result = interpretParchiOcr(checked, [sugar], "model", 20);
    expect(result.lines[0]?.qty_base_units).toBe(500);
    expect(result.lines[0]?.computed_total_paisa).toBe(8_000);
    expect(result.lines[0]?.line_total_paisa).toBeNull();
    expect(result.lines[0]?.issues).toContain("RATE_UNCLEAR");
    expect(result.manual_review_required).toBe(true);
  });
});
