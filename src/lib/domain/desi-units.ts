/**
 * Desi-Unit Normalizer — deterministic, integer-only.
 *
 * Quantities are tracked in QUARTERS (1 = 4 quarters) so that adha (½), sawa (1¼),
 * dedh (1½), dhai (2½) and paune (¾) never touch floating point. Base units are
 * grams, millilitres or pieces.
 */

import { formatAmount, mulDiv, type Paisa } from "./money";

export type BaseUnit = "g" | "ml" | "pcs";
export type UnitFamily = "mass" | "volume" | "count" | "pack";

export interface UnitDef {
  family: UnitFamily;
  /** base units per 1 of this unit (ignored for "pack": uses product pack size) */
  base: number;
  canonical: string;
}

const UNIT_TABLE: Array<[string[], UnitDef]> = [
  [["g", "gm", "gms", "gram", "grams", "giram"], { family: "mass", base: 1, canonical: "g" }],
  [["kg", "kgs", "kilo", "kilos", "killo", "kilogram", "kg.", "کلو"], { family: "mass", base: 1000, canonical: "kilo" }],
  [["pao", "pau", "paao", "paav", "pav", "paoo", "پاؤ", "پاو"], { family: "mass", base: 250, canonical: "pao" }],
  [["ml", "mili", "millilitre", "milliliter"], { family: "volume", base: 1, canonical: "ml" }],
  [["l", "ltr", "litre", "liter", "litr", "leter", "لیٹر"], { family: "volume", base: 1000, canonical: "litre" }],
  [["darjan", "darjen", "dozen", "darzan", "درجن"], { family: "count", base: 12, canonical: "darjan" }],
  [["pc", "pcs", "piece", "pieces", "adad", "dana", "daney", "nag", "عدد"], { family: "count", base: 1, canonical: "pcs" }],
  [
    ["packet", "packets", "pkt", "pack", "packs", "paket", "tin", "dabba", "dibba", "bottle", "botal", "bag", "bori", "carton", "peti", "sachet", "pouch", "box", "roll", "bar", "tikki", "پیکٹ", "ڈبہ"],
    { family: "pack", base: 1, canonical: "pack" },
  ],
];

const UNIT_INDEX = new Map<string, UnitDef>();
for (const [names, def] of UNIT_TABLE) for (const n of names) UNIT_INDEX.set(n, def);

export function lookupUnit(word: string | null | undefined): UnitDef | null {
  if (!word) return null;
  return UNIT_INDEX.get(word.trim().toLowerCase()) ?? null;
}

/** Whole-number words (Roman Urdu / Punjabi + Urdu script). */
export const NUMBER_WORDS: Record<string, number> = {
  ek: 1, aik: 1, ik: 1, ikk: 1, one: 1, "ایک": 1,
  do: 2, dou: 2, two: 2, "دو": 2,
  teen: 3, three: 3, "تین": 3,
  char: 4, chaar: 4, four: 4, "چار": 4,
  panch: 5, paanch: 5, punj: 5, five: 5, "پانچ": 5,
  chhe: 6, chhay: 6, chay: 6, che: 6, six: 6, "چھ": 6,
  saat: 7, sat: 7, seven: 7, "سات": 7,
  aath: 8, ath: 8, eight: 8, "آٹھ": 8,
  nau: 9, nine: 9, "نو": 9,
  das: 10, dus: 10, ten: 10, "دس": 10,
  gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16,
  satrah: 17, atharah: 18, unees: 19, bees: 20, pachees: 25, tees: 30,
  chalees: 40, pachas: 50, pachaas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
  sau: 100,
};

/** Fraction words expressed in quarters, and how they combine with a following number. */
const FRACTION_WORDS: Record<string, { standalone: number; combine?: (n: number) => number }> = {
  adha: { standalone: 2 }, aadha: { standalone: 2 }, aadhi: { standalone: 2 }, adhi: { standalone: 2 }, adhaa: { standalone: 2 }, "آدھا": { standalone: 2 }, "آدھی": { standalone: 2 },
  sawa: { standalone: 5, combine: (n) => n * 4 + 1 }, "سوا": { standalone: 5, combine: (n) => n * 4 + 1 },
  dedh: { standalone: 6 }, derh: { standalone: 6 }, dirh: { standalone: 6 }, deedh: { standalone: 6 }, "ڈیڑھ": { standalone: 6 },
  dhai: { standalone: 10 }, dhaai: { standalone: 10 }, arhai: { standalone: 10 }, adhai: { standalone: 10 }, "ڈھائی": { standalone: 10 },
  paune: { standalone: 3, combine: (n) => n * 4 - 1 }, pone: { standalone: 3, combine: (n) => n * 4 - 1 }, "پونے": { standalone: 3, combine: (n) => n * 4 - 1 },
};

/** True when a token can belong to a quantity phrase (number, fraction or unit word). */
export function isQuantityToken(tok: string): boolean {
  const t = tok.toLowerCase();
  return /^\d+(\.\d+)?$/.test(t) || /^\d+(\.\d+)?[a-z]+$/.test(t) || t in NUMBER_WORDS || t in FRACTION_WORDS || UNIT_INDEX.has(t);
}

export interface QuantityPhrase {
  /** quantity in quarters (4 = 1). null when no quantity was stated. */
  quarters: number | null;
  unit: UnitDef | null;
  /** the unit word as spoken */
  unitWord: string | null;
}

function parseNumberToken(tok: string): number | null {
  if (/^\d+(\.\d+)?$/.test(tok)) return Number(tok);
  if (tok in NUMBER_WORDS) return NUMBER_WORDS[tok];
  return null;
}

/** Quarters from a numeric value; rejects anything finer than ¼. */
function toQuarters(n: number): number {
  return Math.round(n * 4);
}

/**
 * Parse a spoken quantity phrase: "dedh pao", "adha kilo", "sawa do kilo",
 * "2.5 kg", "ek darjan", "250g", "teen pao", "pao", "2".
 */
export function parseQuantityPhrase(phrase: string | null | undefined): QuantityPhrase {
  if (!phrase) return { quarters: null, unit: null, unitWord: null };
  const cleaned = phrase
    .toLowerCase()
    .replace(/(\d)([a-z؀-ۿ])/g, "$1 $2")
    .replace(/[,]/g, " ")
    .trim();
  const toks = cleaned.split(/\s+/).filter(Boolean);
  let quarters: number | null = null;
  let unit: UnitDef | null = null;
  let unitWord: string | null = null;

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const frac = FRACTION_WORDS[t];
    if (frac) {
      const next = toks[i + 1] !== undefined ? parseNumberToken(toks[i + 1]) : null;
      if (frac.combine && next !== null) {
        quarters = frac.combine(next);
        i++;
      } else {
        quarters = frac.standalone;
      }
      continue;
    }
    const n = parseNumberToken(t);
    if (n !== null && quarters === null) {
      quarters = toQuarters(n);
      continue;
    }
    const u = lookupUnit(t);
    if (u && !unit) {
      unit = u;
      unitWord = t;
    }
  }
  // A bare unit ("pao cheeni") means one of that unit.
  if (quarters === null && unit) quarters = 4;
  return { quarters, unit, unitWord };
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
  /** human formula for the X-Ray, e.g. unit("dedh pao") → 375g @ 160/kg = 60 PKR */
  formula: string;
}

export function formatBaseQty(qty: number, unit: BaseUnit): string {
  if (unit === "pcs") return `${qty} pcs`;
  const big = unit === "g" ? "kg" : "L";
  if (Math.abs(qty) >= 1000) {
    const v = qty / 1000;
    return `${Number.isInteger(v) ? v : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}${big}`;
  }
  return `${qty}${unit}`;
}

/** "Rs. 160/kg", "Rs. 50/pcs", "Rs. 2,600/5L" */
export function formatUnitPrice(p: ProductUnitInfo): string {
  const per =
    p.base_unit === "pcs"
      ? p.pack_size_base_units === 1
        ? "pc"
        : `${p.pack_size_base_units} pcs`
      : p.pack_size_base_units === 1000
        ? p.base_unit === "g"
          ? "kg"
          : "L"
        : formatBaseQty(p.pack_size_base_units, p.base_unit);
  return `Rs. ${formatAmount(p.unit_price_paisa)}/${per}`;
}

/** Spoken-unit → base units for a given product. */
export function quantityToBaseUnits(q: QuantityPhrase, product: ProductUnitInfo): number {
  const quarters = q.quarters ?? 4;
  const u = q.unit;
  let perUnit: number;
  if (!u || u.family === "pack") {
    perUnit = product.pack_size_base_units;
  } else if (u.family === "count") {
    perUnit = product.base_unit === "pcs" ? u.base : u.base * product.pack_size_base_units;
  } else {
    // mass/volume: desi usage treats kilo≈litre and pao≈250ml for liquids
    perUnit = product.base_unit === "pcs" ? product.pack_size_base_units : u.base;
  }
  return Math.round((quarters * perUnit) / 4);
}

export function resolveLine(
  product: ProductUnitInfo,
  input: { quantity?: QuantityPhrase | null; value_paisa?: Paisa | null; spoken?: string },
): LineResolution {
  const priceLabel = formatUnitPrice(product);
  if (input.value_paisa && input.value_paisa > 0) {
    const qty = Math.max(1, mulDiv(input.value_paisa, product.pack_size_base_units, product.unit_price_paisa));
    return {
      qty_base_units: qty,
      line_total_paisa: input.value_paisa,
      value_first: true,
      formula: `value("${formatAmount(input.value_paisa)} ka") → ${formatAmount(input.value_paisa)} ÷ ${priceLabel} = ${formatBaseQty(qty, product.base_unit)}`,
    };
  }
  const q = input.quantity ?? { quarters: 4, unit: null, unitWord: null };
  const qty = Math.max(1, quantityToBaseUnits(q, product));
  const total = mulDiv(qty, product.unit_price_paisa, product.pack_size_base_units);
  const spokenUnit = q.unitWord ? `${describeQuarters(q.quarters)} ${q.unitWord}`.trim() : describeQuarters(q.quarters);
  return {
    qty_base_units: qty,
    line_total_paisa: total,
    value_first: false,
    formula: `unit("${spokenUnit}") → ${formatBaseQty(qty, product.base_unit)} @ ${priceLabel} = ${formatAmount(total)} PKR`,
  };
}

export function describeQuarters(q: number | null): string {
  if (q === null) return "1";
  if (q % 4 === 0) return String(q / 4);
  return (q / 4).toString();
}

/** "375g (1.5 pao)" style secondary label used on review rows. */
export function describeQty(qty: number, unit: BaseUnit, spoken?: QuantityPhrase | null): string {
  const base = formatBaseQty(qty, unit);
  if (spoken?.unit?.canonical === "pao" && spoken.quarters !== null) {
    return `${base} (${describeQuarters(spoken.quarters)} pao)`;
  }
  return base;
}
