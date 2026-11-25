import { describe, expect, it } from "vitest";
import { lookupUnit, parseQuantityPhrase, quantityToBaseUnits, requiresExplicitPackSize } from "@/lib/domain/desi-units";

describe("Pakistani trade quantity units", () => {
  it.each([
    ["dhai kilo", "g", 1_000, 2_500],
    ["dedh pao", "g", 1_000, 375],
    ["500g", "g", 1_000, 500],
    ["2.5 litre", "ml", 1_000, 2_500],
    ["ek darjan", "pcs", 1, 12],
    ["3 packet", "pcs", 1, 3],
  ] as const)("converts %s to base units", (phrase, base_unit, pack_size_base_units, expected) => {
    const parsed = parseQuantityPhrase(phrase);
    expect(parsed.unresolved).toBe(false);
    expect(quantityToBaseUnits(parsed, { name: "fixture", base_unit, pack_size_base_units, unit_price_paisa: 1_000 })).toBe(expected);
  });

  it("preserves established phrases with a following item name", () => {
    expect(quantityToBaseUnits(parseQuantityPhrase("pao cheeni"), { name: "Cheeni", base_unit: "g", pack_size_base_units: 1_000, unit_price_paisa: 1 })).toBe(250);
    expect(quantityToBaseUnits(parseQuantityPhrase("ek darjan anday"), { name: "Anday", base_unit: "pcs", pack_size_base_units: 1, unit_price_paisa: 1 })).toBe(12);
    expect(quantityToBaseUnits(parseQuantityPhrase("2 packet chips"), { name: "Chips", base_unit: "pcs", pack_size_base_units: 1, unit_price_paisa: 1 })).toBe(2);
  });

  it("resolves common Urdu units and flags unsupported quantities", () => {
    expect(lookupUnit("کلو")).toMatchObject({ family: "mass", base: 1_000 });
    expect(lookupUnit("پاؤ")).toMatchObject({ family: "mass", base: 250 });
    expect(parseQuantityPhrase("do unknown").unresolved).toBe(true);
    expect(parseQuantityPhrase("2.555 kg").unresolved).toBe(true);
    expect(requiresExplicitPackSize("carton")).toBe(true);
    expect(requiresExplicitPackSize("کارتن")).toBe(true);
    expect(requiresExplicitPackSize("packet")).toBe(false);
  });
});
