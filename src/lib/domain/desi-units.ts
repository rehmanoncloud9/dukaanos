/** Deterministic conversion of Pakistani conversational units into base units. */

import { formatAmount, mulDiv, type Paisa } from "./money";
import { normalizeUrduNumberWords, parseQuantityNumber } from "./urdu-numbers";

export type BaseUnit = "g" | "ml" | "pcs";
export type UnitFamily = "mass" | "volume" | "count" | "pack";

export interface UnitDef {
  family: UnitFamily;
  /** Base units in one named unit. A pack uses the matched product's pack size. */
  base: number;
  canonical: string;
}

const UNIT_TABLE: Array<[string[], UnitDef]> = [
  [["g", "gm", "gms", "gram", "grams", "giram", "گرام"], { family: "mass", base: 1, canonical: "g" }],
  [["kg", "kgs", "kilo", "kilos", "killo", "kilogram", "kg.", "کلو", "کلوگرام"], { family: "mass", base: 1000, canonical: "kilo" }],
  [["mann", "man", "mun", "من"], { family: "mass", base: 40_000, canonical: "mann" }],
  [["pao", "pau", "paao", "paav", "pav", "paoo", "پاؤ", "پاو"], { family: "mass", base: 250, canonical: "pao" }],
  [["ml", "mili", "millilitre", "milliliter", "ملی لیٹر"], { family: "volume", base: 1, canonical: "ml" }],
  [["l", "ltr", "litre", "liter", "litr", "leter", "لیٹر", "لٹر"], { family: "volume", base: 1000, canonical: "litre" }],
  [["darjan", "darjen", "dozen", "darzan", "درجن"], { family: "count", base: 12, canonical: "darjan" }],
  [["pc", "pcs", "piece", "pieces", "adad", "dana", "daney", "nag", "عدد", "پیس"], { family: "count", base: 1, canonical: "pcs" }],
  [["packet", "packets", "pkt", "pack", "packs", "paket", "tin", "tins", "dabba", "dibba", "dabbe", "bottle", "bottles", "botal", "bag", "bori", "carton", "cartons", "peti", "sachet", "sachets", "pouch", "pouches", "box", "boxes", "roll", "rolls", "bar", "bars", "tikki", "پیکٹ", "ڈبہ"], { family: "pack", base: 1, canonical: "pack" }],
];

/** Legacy exported number dictionary retained for existing domain consumers. */
export const NUMBER_WORDS: Record<string, number> = {
  ek: 1, aik: 1, ik: 1, ikk: 1, one: 1, do: 2, dou: 2, two: 2, teen: 3, three: 3,
  char: 4, chaar: 4, four: 4, panch: 5, paanch: 5, punj: 5, five: 5, chhe: 6,
  chhay: 6, chay: 6, che: 6, six: 6, saat: 7, sat: 7, seven: 7, aath: 8, ath: 8,
  eight: 8, nau: 9, nine: 9, das: 10, dus: 10, ten: 10, gyarah: 11, barah: 12,
  terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18,
  unees: 19, bees: 20, pachees: 25, tees: 30, chalees: 40, pachas: 50,
  pachaas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90, sau: 100,
  "ایک": 1, "دو": 2, "تین": 3, "چار": 4, "پانچ": 5, "چھ": 6, "سات": 7,
  "آٹھ": 8, "نو": 9, "دس": 10,
};

const UNIT_INDEX = new Map<string, UnitDef>();
for (const [names, def] of UNIT_TABLE) for (const name of names) UNIT_INDEX.set(name, def);

const PACK_SIZE_REQUIRED = new Set(["bag", "bori", "carton", "peti", "box", "case", "sack",
  // Urdu-script variants preserved after normalizeUrduNumberWords maps them to Roman equivalents.
  // کارتن (kaartan, variant of کارٹن) is kept for orthographic tolerance.
  "کارتن", "کارٹن", "بوری", "بیگ", "باکس",
]);

/** True for package labels whose conversion to inventory units is not implied. */
export function requiresExplicitPackSize(word: string | null | undefined): boolean {
  if (!word) return false;
  return normalizeUrduNumberWords(word).trim().toLowerCase().split(/\s+/).some((token) => PACK_SIZE_REQUIRED.has(token));
}

/** Resolve a Roman Urdu, English, or supported Urdu-script unit name. */
export function lookupUnit(word: string | null | undefined): UnitDef | null {
  if (!word) return null;
  const key = word.trim().toLowerCase();
  return UNIT_INDEX.get(key) ?? UNIT_INDEX.get(normalizeUrduNumberWords(key)) ?? null;
}

/** True when a token can be part of a supported number or unit expression. */
export function isQuantityToken(token: string): boolean {
  const normalized = normalizeUrduNumberWords(token).toLowerCase();
  return lookupUnit(normalized) !== null || parseQuantityNumber(normalized) !== null;
}

export interface QuantityPhrase {
  /** Quantity in quarters (4 = 1), when exactly representable in quarters. */
  quarters: number | null;
  /** Quantity multiplied by 100, preserving decimal values exactly. */
  hundredths: number | null;
  unit: UnitDef | null;
  /** Normalized unit spelling. The original phrase remains on the proposal. */
  unitWord: string | null;
  /** True if interpreting the supplied phrase would require guessing. */
  unresolved: boolean;
}

/**
 * Parse a quantity phrase such as `dhai pao`, `پونے دو کلو`, `500g`, or `2.5 kg`.
 * Unknown words and unsupported decimal precision are never rounded into a guess.
 */
export function parseQuantityPhrase(phrase: string | null | undefined): QuantityPhrase {
  if (!phrase?.trim()) return { quarters: null, hundredths: null, unit: null, unitWord: null, unresolved: false };
  const normalized = normalizeUrduNumberWords(phrase.replace(/(\d)([a-z])/gi, "$1 $2")).toLowerCase();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const unitWord = tokens.find((token) => lookupUnit(token) !== null) ?? null;
  const unit = lookupUnit(unitWord);
  let value = parseQuantityNumber(normalized);

  // Preserve the established API behavior for phrases that include the item
  // name after the quantity (`ek darjan anday`, `pao cheeni`). Only a valid
  // leading quantity prefix is accepted; unknown words inside it still fail.
  // The prefix must contain at least one recognized unit to avoid treating
  // bare numbers like "do unknown" as a resolved quantity phrase.
  if (value === null) {
    for (let end = tokens.length - 1; end > 0; end--) {
      if (tokens.slice(end).some((token) => parseQuantityNumber(token) !== null || lookupUnit(token) !== null)) continue;
      const prefix = tokens.slice(0, end);
      if (!prefix.some((token) => lookupUnit(token) !== null)) break;
      value = parseQuantityNumber(prefix.join(" "));
      if (value !== null) break;
    }
  }

  if (value !== null) {
    const hundredths = Math.round(value * 100);
    const positive = hundredths > 0;
    return {
      quarters: hundredths % 25 === 0 ? hundredths / 25 : null,
      hundredths,
      unit,
      unitWord,
      unresolved: !positive || !Number.isSafeInteger(hundredths),
    };
  }

  // A single bare unit means one of that unit (for example, `pao cheeni` is
  // tokenized by the fallback parser as quantity `pao`, item `cheeni`).
  if (unit && tokens[0] === unitWord && tokens.slice(1).every((token) => parseQuantityNumber(token) === null && lookupUnit(token) === null)) {
    return { quarters: 4, hundredths: 100, unit, unitWord, unresolved: false };
  }
  return { quarters: null, hundredths: null, unit, unitWord, unresolved: true };
}

export interface ProductUnitInfo {
  name: string;
  base_unit: BaseUnit;
  pack_size_base_units: number;
  unit_price_paisa: Paisa;
}

export interface LineResolution {
  qty_base_units: number;
  line_total_paisa: Paisa;
  value_first: boolean;
  formula: string;
}

/** Format integer base units for user-facing review. */
export function formatBaseQty(qty: number, unit: BaseUnit): string {
  if (unit === "pcs") return `${qty} عدد`;
  const big = unit === "g" ? "کلو" : "لیٹر";
  if (Math.abs(qty) >= 1000) {
    const v = qty / 1000;
    return `${Number.isInteger(v) ? v : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} ${big}`;
  }
  return `${qty} ${unit === "g" ? "گرام" : "ملی لیٹر"}`;
}

/** Format a catalog price with its unit basis. */
export function formatUnitPrice(product: ProductUnitInfo): string {
  const per = product.base_unit === "pcs"
    ? product.pack_size_base_units === 1 ? "عدد" : `${product.pack_size_base_units} عدد`
    : product.pack_size_base_units === 1000
      ? product.base_unit === "g" ? "کلو" : "لیٹر"
      : formatBaseQty(product.pack_size_base_units, product.base_unit);
  return `${formatAmount(product.unit_price_paisa)} روپے فی ${per}`;
}

/** Convert a parsed spoken quantity into product inventory base units. */
export function quantityToBaseUnits(quantity: QuantityPhrase, product: ProductUnitInfo): number {
  if (quantity.unresolved) throw new RangeError("quantity phrase is not safely interpretable");
  if (!Number.isSafeInteger(product.pack_size_base_units) || product.pack_size_base_units <= 0) {
    throw new RangeError("product pack size must be a positive safe integer");
  }
  const amountHundredths = quantity.hundredths ?? (quantity.quarters ?? 4) * 25;
  const unit = quantity.unit;
  let perUnit: number;
  if (!unit || unit.family === "pack") {
    perUnit = product.pack_size_base_units;
  } else if (unit.family === "count") {
    perUnit = product.base_unit === "pcs" ? unit.base : unit.base * product.pack_size_base_units;
  } else {
    // Local trade convention: kilo≈litre and pao≈250ml for liquids.
    perUnit = product.base_unit === "pcs" ? product.pack_size_base_units : unit.base;
  }
  return mulDiv(amountHundredths, perUnit, 100);
}

/** Resolve quantity or value-first price to integer base units and integer paisa. */
export function resolveLine(
  product: ProductUnitInfo,
  input: { quantity?: QuantityPhrase | null; value_paisa?: Paisa | null; spoken?: string },
): LineResolution {
  const priceLabel = formatUnitPrice(product);
  if (input.value_paisa !== null && input.value_paisa !== undefined && input.value_paisa > 0) {
    const qty = Math.max(1, mulDiv(input.value_paisa, product.pack_size_base_units, product.unit_price_paisa));
    return {
      qty_base_units: qty,
      line_total_paisa: input.value_paisa,
      value_first: true,
      formula: `value("${formatAmount(input.value_paisa)} ka") → ${formatAmount(input.value_paisa)} ÷ ${priceLabel} = ${formatBaseQty(qty, product.base_unit)}`,
    };
  }
  const quantity = input.quantity ?? { quarters: null, hundredths: null, unit: null, unitWord: null, unresolved: false };
  const qty = Math.max(1, quantityToBaseUnits(quantity, product));
  const total = mulDiv(qty, product.unit_price_paisa, product.pack_size_base_units);
  const count = quantity.hundredths === null ? describeQuarters(quantity.quarters) : String(quantity.hundredths / 100);
  const spokenUnit = quantity.unitWord ? `${count} ${quantity.unitWord}` : count;
  return {
    qty_base_units: qty,
    line_total_paisa: total,
    value_first: false,
    formula: `unit("${spokenUnit}") → ${formatBaseQty(qty, product.base_unit)} @ ${priceLabel} = ${formatAmount(total)} PKR`,
  };
}

/** Format an exact quarter count for X-Ray and review text. */
export function describeQuarters(quarters: number | null): string {
  if (quarters === null) return "1";
  if (quarters % 4 === 0) return String(quarters / 4);
  return (quarters / 4).toString();
}

/** Format a base quantity with a secondary spoken pao count when applicable. */
export function describeQty(qty: number, unit: BaseUnit, spoken?: QuantityPhrase | null): string {
  const base = formatBaseQty(qty, unit);
  if (spoken?.unit?.canonical === "pao" && spoken.quarters !== null) {
    return `${base} (${describeQuarters(spoken.quarters)} pao)`;
  }
  return base;
}
