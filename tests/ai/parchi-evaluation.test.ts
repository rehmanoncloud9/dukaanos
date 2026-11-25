import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/ai/parchi/golden-parchi-fixtures.json";
import { interpretParchiOcr, PARCHI_OCR_ZOD_SCHEMA } from "@/lib/ai/parchi";
import { demoCatalog } from "../helpers/catalog";

const products = demoCatalog().products;

interface ExpectedParchiLine {
  match_status?: string;
  product_id?: string;
  qty_base_units?: number | null;
  rate_paisa?: number | null;
  base_unit?: string;
  pack_size_base_units?: number;
  written_total_paisa?: number | null;
  computed_total_paisa?: number | null;
  line_total_paisa?: number | null;
  math_mismatch?: boolean;
  conversion_unresolved?: boolean;
  issues_include?: string[];
}

interface ParchiFixture {
  id: string;
  category: string;
  ocr: Parameters<typeof PARCHI_OCR_ZOD_SCHEMA.parse>[0];
  expected: {
    line_count: number;
    math_passed: boolean;
    manual_review_required: boolean;
    new_sku_count?: number;
    mismatch_count?: number;
    extracted_total_paisa?: number | null;
    computed_total_paisa?: number | null;
    delta_paisa?: number | null;
    lines: ExpectedParchiLine[];
  };
}

const typedFixtures = fixtures as ParchiFixture[];

describe("Synthetic parchi golden fixture evaluation", () => {
  it.each(typedFixtures)("evaluates $id ($category) deterministically with zero write tools", (fixture) => {
    const parsed = PARCHI_OCR_ZOD_SCHEMA.parse(fixture.ocr);
    const result = interpretParchiOcr(parsed, products, "gemini-3.5-flash-lite", 25);

    expect(result.write_tools_bound).toBe(0);
    expect(result.lines).toHaveLength(fixture.expected.line_count);
    expect(result.math_check.passed).toBe(fixture.expected.math_passed);
    expect(result.manual_review_required).toBe(fixture.expected.manual_review_required);

    if (fixture.expected.new_sku_count !== undefined) expect(result.new_sku_count).toBe(fixture.expected.new_sku_count);
    if (fixture.expected.mismatch_count !== undefined) expect(result.mismatch_count).toBe(fixture.expected.mismatch_count);
    if (fixture.expected.extracted_total_paisa !== undefined) expect(result.math_check.extracted_total_paisa).toBe(fixture.expected.extracted_total_paisa);
    if (fixture.expected.computed_total_paisa !== undefined) expect(result.math_check.computed_total_paisa).toBe(fixture.expected.computed_total_paisa);
    if (fixture.expected.delta_paisa !== undefined) expect(result.math_check.delta_paisa).toBe(fixture.expected.delta_paisa);

    fixture.expected.lines.forEach((exp, idx) => {
      const actual = result.lines[idx];
      expect(actual).toBeDefined();
      if (exp.match_status) expect(actual?.match_status).toBe(exp.match_status);
      if (exp.product_id) expect(actual?.product_id).toBe(exp.product_id);
      if ("qty_base_units" in exp) expect(actual?.qty_base_units).toBe(exp.qty_base_units);
      if ("rate_paisa" in exp) expect(actual?.rate_paisa).toBe(exp.rate_paisa);
      if ("base_unit" in exp) expect(actual?.base_unit).toBe(exp.base_unit);
      if ("pack_size_base_units" in exp) expect(actual?.pack_size_base_units).toBe(exp.pack_size_base_units);
      if ("written_total_paisa" in exp) expect(actual?.written_total_paisa).toBe(exp.written_total_paisa);
      if ("computed_total_paisa" in exp) expect(actual?.computed_total_paisa).toBe(exp.computed_total_paisa);
      if ("line_total_paisa" in exp) expect(actual?.line_total_paisa).toBe(exp.line_total_paisa);
      if ("math_mismatch" in exp) expect(actual?.math_mismatch).toBe(exp.math_mismatch);
      if ("conversion_unresolved" in exp) expect(actual?.conversion_unresolved).toBe(exp.conversion_unresolved);
      if (exp.issues_include) {
        for (const issue of exp.issues_include) {
          expect(actual?.issues).toContain(issue);
        }
      }
    });
  });
});
