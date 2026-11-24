/**
 * Crinkled Parchi OCR — pure vision extraction on AI_FAST_MODEL with ZERO tools bound.
 * The model reads; deterministic code checks every line (qty × rate vs line total) and the
 * bill sum (SUM(lines) vs written total) and matches items to the catalog via PakPhone.
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/http";
import { env } from "@/lib/env";
import { productEntries } from "@/lib/domain/bill";
import { parseQuantityPhrase, quantityToBaseUnits, type BaseUnit } from "@/lib/domain/desi-units";
import { rupeesToPaisa } from "@/lib/domain/money";
import { matchCatalog, PRODUCT_MATCH_THRESHOLD } from "@/lib/domain/pakphone";
import type { ProductRow } from "@/lib/domain/types";
import { generateWithFallback, parseModelJson } from "./models";

const nn = { anyOf: [{ type: "number" }, { type: "null" }] };
const ns = { anyOf: [{ type: "string" }, { type: "null" }] };

export const PARCHI_JSON_SCHEMA = {
  type: "object",
  properties: {
    supplier_name: ns,
    bill_date: ns,
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Item as written (transliterate Urdu to Roman, keep brand + size, e.g. 'Dalda Oil 5L')" },
          qty: { ...nn, description: "Quantity number as written" },
          unit: { ...ns, description: "Unit as written: kg, tin, pcs, carton, bori, packet…" },
          rate_rupees: { ...nn, description: "Per-unit rate as written" },
          line_total_rupees: { ...nn, description: "Line amount as written" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["name", "qty", "unit", "rate_rupees", "line_total_rupees", "confidence"],
      },
    },
    bill_total_rupees: { ...nn, description: "Grand total as written on the slip" },
    legibility: { type: "string", enum: ["good", "fair", "poor"] },
  },
  required: ["supplier_name", "bill_date", "lines", "bill_total_rupees", "legibility"],
} as const;

const ParchiZ = z.object({
  supplier_name: z.string().nullable(),
  bill_date: z.string().nullable(),
  lines: z.array(z.object({
    name: z.string(),
    qty: z.number().nullable(),
    unit: z.string().nullable(),
    rate_rupees: z.number().nullable(),
    line_total_rupees: z.number().nullable(),
    confidence: z.number().min(0).max(1),
  })),
  bill_total_rupees: z.number().nullable(),
  legibility: z.enum(["good", "fair", "poor"]),
});

export interface ParchiReviewLine {
  key: string;
  written_name: string;
  match_status: "matched" | "new_sku";
  product_id: string | null;
  name: string;
  match_score: number;
  base_unit: BaseUnit;
  pack_size_base_units: number;
  qty_number: number;
  unit: string | null;
  qty_base_units: number;
  rate_paisa: number | null;
  written_total_paisa: number | null;
  computed_total_paisa: number | null;
  /** the amount that will be committed (defaults to the computed qty×rate when they disagree) */
  line_total_paisa: number;
  math_mismatch: boolean;
  low_confidence: boolean;
  confidence: number;
}

export interface ParchiParseResult {
  supplier_name: string;
  bill_date: string | null;
  legibility: "good" | "fair" | "poor";
  lines: ParchiReviewLine[];
  math_check: { passed: boolean; extracted_total_paisa: number | null; computed_total_paisa: number; delta_paisa: number };
  new_sku_count: number;
  mismatch_count: number;
  model: string;
  latency_ms: number;
  write_tools_bound: 0;
}

function guessUnit(name: string, unit: string | null): { base_unit: BaseUnit; pack: number } {
  const u = (unit ?? "").toLowerCase();
  const n = name.toLowerCase();
  const size = n.match(/(\d+(?:\.\d+)?)\s*(kg|g|gm|l|ltr|litre|ml)\b/);
  if (size) {
    const v = Number(size[1]);
    if (["kg"].includes(size[2])) return { base_unit: "pcs", pack: 1 };
    if (["l", "ltr", "litre"].includes(size[2])) return { base_unit: "pcs", pack: 1 };
    if (["g", "gm", "ml"].includes(size[2]) && v > 0) return { base_unit: "pcs", pack: 1 };
  }
  if (["kg", "kilo"].includes(u)) return { base_unit: "g", pack: 1000 };
  if (["l", "ltr", "litre"].includes(u)) return { base_unit: "ml", pack: 1000 };
  return { base_unit: "pcs", pack: 1 };
}

export async function parseParchi(opts: { base64: string; mimeType: string; products: ProductRow[] }): Promise<ParchiParseResult> {
  const call = await generateWithFallback(env.fastModel(), {
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: opts.mimeType, data: opts.base64 } },
        { text: "This is a crinkled handwritten Pakistani wholesale bill (parchi), Urdu and/or English. Read every line exactly as written. Do not correct the shopkeeper's arithmetic; copy the numbers you see." },
      ],
    }],
    config: {
      systemInstruction: "You are a careful OCR clerk. Output only JSON matching the schema. Never compute or fix totals; transcribe what is written. Mark unclear digits with lower confidence.",
      responseMimeType: "application/json",
      responseJsonSchema: PARCHI_JSON_SCHEMA,
      temperature: 0,
      // ZERO tools: this route can never write anything.
    },
  }, Math.max(env.aiTimeoutMs(), 15_000));

  const raw = parseModelJson<unknown>(call.response);
  const checked = ParchiZ.safeParse(raw);
  if (!checked.success) throw new ApiError("AI_UNAVAILABLE", "Parchi JSON failed schema validation", checked.error.issues);
  const p = checked.data;
  const entries = productEntries(opts.products);

  const lines: ParchiReviewLine[] = p.lines.map((l, i) => {
    const report = matchCatalog(l.name, entries, 1);
    const top = report.results[0];
    const matched = top && top.score >= PRODUCT_MATCH_THRESHOLD ? opts.products.find((x) => x.id === top.id)! : null;
    const guess = guessUnit(l.name, l.unit);
    const base_unit = matched?.base_unit ?? guess.base_unit;
    const pack = matched?.pack_size_base_units ?? guess.pack;
    const qtyNumber = l.qty && l.qty > 0 ? l.qty : 1;
    const qtyBase = matched
      ? quantityToBaseUnits(parseQuantityPhrase(`${qtyNumber} ${l.unit ?? ""}`), matched)
      : Math.max(1, Math.round(qtyNumber * pack));
    const rate = l.rate_rupees !== null ? rupeesToPaisa(l.rate_rupees) : null;
    const written = l.line_total_rupees !== null ? rupeesToPaisa(l.line_total_rupees) : null;
    const computed = rate !== null ? Math.round(qtyNumber * rate) : null;
    const mismatch = computed !== null && written !== null && computed !== written;
    return {
      key: `p${i}`,
      written_name: l.name,
      match_status: matched ? "matched" : "new_sku",
      product_id: matched?.id ?? null,
      name: matched?.name ?? l.name,
      match_score: top?.score ?? 0,
      base_unit,
      pack_size_base_units: pack,
      qty_number: qtyNumber,
      unit: l.unit,
      qty_base_units: Math.max(1, qtyBase),
      rate_paisa: rate,
      written_total_paisa: written,
      computed_total_paisa: computed,
      line_total_paisa: computed ?? written ?? 0,
      math_mismatch: mismatch,
      low_confidence: l.confidence < 0.75,
      confidence: l.confidence,
    };
  });

  const computedTotal = lines.reduce((s, l) => s + l.line_total_paisa, 0);
  const extracted = p.bill_total_rupees !== null ? rupeesToPaisa(p.bill_total_rupees) : null;
  return {
    supplier_name: p.supplier_name?.trim() || "Wholesale",
    bill_date: p.bill_date,
    legibility: p.legibility,
    lines,
    math_check: {
      passed: extracted === null || extracted === computedTotal,
      extracted_total_paisa: extracted,
      computed_total_paisa: computedTotal,
      delta_paisa: extracted === null ? 0 : extracted - computedTotal,
    },
    new_sku_count: lines.filter((l) => l.match_status === "new_sku").length,
    mismatch_count: lines.filter((l) => l.math_mismatch).length,
    model: call.model,
    latency_ms: call.latency_ms,
    write_tools_bound: 0,
  };
}
