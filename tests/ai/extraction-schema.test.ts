import { describe, expect, it } from "vitest";
import { PARSED_TURN_JSON_SCHEMA, ParsedTurnZ } from "@/lib/ai/munshi";
import { PARCHI_JSON_SCHEMA, PARCHI_OCR_ZOD_SCHEMA } from "@/lib/ai/parchi";

function validTurn(overrides: Record<string, unknown> = {}) {
  return {
    intent: "sale",
    transcript: "ek kilo cheeni cash",
    transcript_roman: "ek kilo cheeni cash",
    customer_mention: null,
    items: [{ spoken: "cheeni", quantity_phrase: "ek kilo", value_phrase: null, value_rupees: null, is_loose: false, confidence: 0.95 }],
    discount_phrase: null,
    discount_rupees: null,
    cash_phrase: null,
    cash_paid_rupees: null,
    payment_mode: "cash",
    payment_amount_phrase: null,
    payment_amount_rupees: null,
    question: null,
    confidence: 0.95,
    ...overrides,
  };
}

function validParchi(overrides: Record<string, unknown> = {}) {
  return {
    supplier_name: "Bismillah Traders",
    bill_date: "2026-11-24",
    lines: [
      { name_raw: "Cheeni", quantity_raw: "2", unit_raw: "kg", rate_raw: "160", line_total_raw: "320", confidence: 0.96 },
    ],
    bill_total_raw: "320",
    legibility: "good",
    ...overrides,
  };
}

describe("AI extraction JSON schemas and Zod bounds", () => {
  it("defines required raw-evidence fields on PARSED_TURN_JSON_SCHEMA", () => {
    expect(PARSED_TURN_JSON_SCHEMA.required).toEqual(expect.arrayContaining([
      "intent", "transcript", "transcript_roman", "items", "discount_phrase", "cash_phrase", "payment_mode", "payment_amount_phrase", "confidence",
    ]));
    expect(PARSED_TURN_JSON_SCHEMA.properties.items.type).toBe("array");
  });

  it("enforces bounds and finite amounts in ParsedTurnZ", () => {
    expect(ParsedTurnZ.safeParse(validTurn()).success).toBe(true);
    expect(ParsedTurnZ.safeParse(validTurn({ transcript: "x".repeat(2_001) })).success).toBe(false);
    expect(ParsedTurnZ.safeParse(validTurn({ customer_mention: "a".repeat(121) })).success).toBe(false);
    expect(ParsedTurnZ.safeParse(validTurn({ discount_rupees: -10 })).success).toBe(false);
    expect(ParsedTurnZ.safeParse(validTurn({ cash_paid_rupees: 100_000_001 })).success).toBe(false);
    expect(ParsedTurnZ.safeParse(validTurn({ confidence: 1.5 })).success).toBe(false);
    expect(ParsedTurnZ.safeParse(validTurn({ items: [{ spoken: "   ", quantity_phrase: "1", value_phrase: null, value_rupees: null, is_loose: false, confidence: 0.9 }] })).success).toBe(false);
    expect(ParsedTurnZ.safeParse(validTurn({ items: Array.from({ length: 41 }, () => ({ spoken: "cheeni", quantity_phrase: "1 kg", value_phrase: null, value_rupees: null, is_loose: false, confidence: 0.9 })) })).success).toBe(false);
  });

  it("defines evidence-only fields on PARCHI_JSON_SCHEMA and bounds in PARCHI_OCR_ZOD_SCHEMA", () => {
    expect(PARCHI_JSON_SCHEMA.required).toEqual(["supplier_name", "bill_date", "lines", "bill_total_raw", "legibility"]);
    expect(PARCHI_JSON_SCHEMA.properties.lines.type).toBe("array");
    expect(PARCHI_OCR_ZOD_SCHEMA.safeParse(validParchi()).success).toBe(true);
    expect(PARCHI_OCR_ZOD_SCHEMA.safeParse(validParchi({ supplier_name: "a".repeat(121) })).success).toBe(false);
    expect(PARCHI_OCR_ZOD_SCHEMA.safeParse(validParchi({ bill_date: "2".repeat(41) })).success).toBe(false);
    expect(PARCHI_OCR_ZOD_SCHEMA.safeParse(validParchi({ legibility: "perfect" })).success).toBe(false);
    expect(PARCHI_OCR_ZOD_SCHEMA.safeParse(validParchi({ lines: [{ name_raw: "Cheeni", quantity_raw: "1", unit_raw: "kg", rate_raw: "1", line_total_raw: "1", confidence: -0.1 }] })).success).toBe(false);
  });
});
