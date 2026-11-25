import type { ParchiParseLine, ParchiParseResponse } from "@/core/api/types";
import {
  buildPurchaseInput,
  chooseParchiLineAmount,
  computeTargetResize,
  confirmParchiLine,
  patchEditableLine,
  recalculateEditableLine,
  summarizeParchiReview,
  toEditableParchiLines,
} from "@/features/parchi/logic";

function makeParseLine(overrides: Partial<ParchiParseLine>): ParchiParseLine {
  return {
    key: "l-1",
    raw: { name: "Dalda Oil 5L", quantity: "3", unit: "tin", rate: "2450", line_total: "7650" },
    written_name: "Dalda Oil 5L",
    match_status: "matched",
    product_id: "11111111-1111-4111-8111-111111111111",
    name: "Dalda Oil (5L Tin)",
    match_score: 0.96,
    base_unit: "ml",
    pack_size_base_units: 5000,
    conversion_unresolved: false,
    qty_number: 3,
    unit: "tin",
    qty_base_units: 15_000,
    rate_paisa: 245_000,
    written_total_paisa: 765_000,
    computed_total_paisa: 735_000,
    line_total_paisa: null,
    math_mismatch: true,
    manual_review_required: true,
    issues: ["MATH_MISMATCH"],
    low_confidence: false,
    confidence: 0.94,
    ...overrides,
  };
}

describe("Parchi OCR line recalculation, mismatch toggle, and purchase commit", () => {
  test("computes image resize constraints and low-res warning below 800px", () => {
    expect(computeTargetResize(640, 480)).toEqual({ lowRes: true, resize: null });
    expect(computeTargetResize(1080, 720)).toEqual({ lowRes: false, resize: null });
    expect(computeTargetResize(2400, 1800)).toEqual({
      lowRes: false,
      resize: { width: 1280 },
    });
    expect(computeTargetResize(1800, 2400)).toEqual({
      lowRes: false,
      resize: { height: 1280 },
    });
  });

  test("toggles Use computed vs Keep slip totals on MATH_MISMATCH rows", () => {
    const editable = toEditableParchiLines([makeParseLine({})]);
    expect(editable[0].reviewed).toBe(false);

    const computedChosen = chooseParchiLineAmount(editable, "l-1", "computed");
    expect(computedChosen[0].choice).toBe("computed");
    expect(computedChosen[0].line_total_paisa).toBe(735_000);

    const writtenChosen = chooseParchiLineAmount(computedChosen, "l-1", "written");
    expect(writtenChosen[0].choice).toBe("written");
    expect(writtenChosen[0].line_total_paisa).toBe(765_000);

    const confirmed = confirmParchiLine(computedChosen, "l-1");
    expect(confirmed[0].reviewed).toBe(true);
  });

  test("recalculates edited quantity and rate deterministically", () => {
    const editable = toEditableParchiLines([
      makeParseLine({
        key: "l-2",
        match_status: "new_sku",
        product_id: null,
        name: "Tapal Danedar",
        base_unit: "g",
        pack_size_base_units: 1000,
        conversion_unresolved: false,
        qty_number: 1,
        unit: "kg",
        rate_paisa: 152_000,
        written_total_paisa: 152_000,
        computed_total_paisa: 152_000,
        line_total_paisa: 152_000,
        math_mismatch: false,
        manual_review_required: false,
      }),
    ]);

    const edited = patchEditableLine(editable, "l-2", {
      qtyText: "2",
      unitText: "kg",
      rateText: "1520",
      totalText: "3040",
    });
    const recalced = recalculateEditableLine(edited[0]);
    expect(recalced.ok).toBe(true);
    if (recalced.ok) {
      expect(recalced.line.qty_base_units).toBe(2000);
      expect(recalced.line.computed_total_paisa).toBe(304_000);
      expect(recalced.line.line_total_paisa).toBe(304_000);
      expect(recalced.line.math_mismatch).toBe(false);
    }
  });

  test("rejects mismatched stock unit family on recalculation", () => {
    const editable = toEditableParchiLines([
      makeParseLine({ key: "l-3", base_unit: "ml", qty_number: 2, unit: "kg" }),
    ]);
    const res = recalculateEditableLine(editable[0]);
    expect(res.ok).toBe(false);
  });

  test("requires grand-total confirmation on mismatch and builds PurchaseInput", () => {
    const line1 = confirmParchiLine(
      chooseParchiLineAmount(toEditableParchiLines([makeParseLine({})]), "l-1", "computed"),
      "l-1",
    )[0];
    const notAcked = summarizeParchiReview([line1], 765_000, false, "5000");
    expect(notAcked.grandTotalMismatch).toBe(true);
    expect(notAcked.canCommit).toBe(false);

    const acked = summarizeParchiReview([line1], 765_000, true, "5000");
    expect(acked.canCommit).toBe(true);
    expect(acked.sumPaisa).toBe(735_000);
    expect(acked.apBalancePaisa).toBe(235_000);

    const parsed: ParchiParseResponse = {
      supplier_name: "Al-Madina Wholesale",
      bill_date: "2026-11-24",
      legibility: "good",
      lines: [],
      math_check: {
        passed: false,
        checked: true,
        extracted_total_paisa: 765_000,
        computed_total_paisa: 735_000,
        delta_paisa: 30_000,
      },
      manual_review_required: true,
      new_sku_count: 0,
      mismatch_count: 1,
      model: "gemini-3.5-flash-lite",
      latency_ms: 420,
      write_tools_bound: 0,
    };

    const payload = buildPurchaseInput({
      idempotencyKey: "parchi-12345678",
      parsed,
      lines: [line1],
      cashPaidPaisa: 500_000,
      statedTotalPaisa: 765_000,
    });
    expect(payload.supplier_name).toBe("Al-Madina Wholesale");
    expect(payload.cash_paid_paisa).toBe(500_000);
    expect(payload.lines[0].qty_base_units).toBe(15_000);
    expect(payload.lines[0].line_total_paisa).toBe(735_000);
  });
});
