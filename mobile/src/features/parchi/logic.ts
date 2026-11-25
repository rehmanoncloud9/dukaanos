import {
  parseQuantityPhrase,
  quantityToBaseUnits,
  requiresExplicitPackSize,
  type BaseUnit,
} from "@domain/desi-units";
import { mulDiv } from "@domain/money";
import { parseRupeeAmount } from "@domain/urdu-numbers";
import type { ParchiParseLine, ParchiParseResponse, PurchaseInput } from "@/core/api/types";

export type AmountChoice = "computed" | "written" | "agreed" | null;

export interface EditableParchiLine extends ParchiParseLine {
  choice: AmountChoice;
  reviewed: boolean;
  qtyText: string;
  unitText: string;
  rateText: string;
  totalText: string;
  packText: string;
}

export function parseParchiRupeesToPaisa(text: string): number | null {
  const clean = text.replace(/,/g, "").trim();
  if (!clean) return null;
  return parseRupeeAmount(clean)?.paisa ?? null;
}

export function computeTargetResize(
  width?: number | null,
  height?: number | null,
): { lowRes: boolean; resize: { width?: number; height?: number } | null } {
  const w = typeof width === "number" && Number.isFinite(width) ? width : 0;
  const h = typeof height === "number" && Number.isFinite(height) ? height : 0;
  if (w <= 0 || h <= 0) {
    return { lowRes: false, resize: { width: 1280 } };
  }
  const longest = Math.max(w, h);
  const lowRes = longest < 800;
  if (longest <= 1280) {
    return { lowRes, resize: null };
  }
  return {
    lowRes,
    resize: w >= h ? { width: 1280 } : { height: 1280 },
  };
}

export function toEditableParchiLines(lines: ParchiParseLine[]): EditableParchiLine[] {
  return lines.map((line) => ({
    ...line,
    choice: line.line_total_paisa === null ? null : "agreed",
    reviewed: !line.manual_review_required,
    qtyText: line.qty_number === null ? "" : String(line.qty_number),
    unitText: line.unit ?? "",
    rateText: line.rate_paisa === null ? "" : String(line.rate_paisa / 100),
    totalText: line.written_total_paisa === null ? "" : String(line.written_total_paisa / 100),
    packText: line.conversion_unresolved ? "" : String(line.pack_size_base_units),
  }));
}

export function patchEditableLine(
  lines: EditableParchiLine[],
  key: string,
  patch: Partial<EditableParchiLine>,
): EditableParchiLine[] {
  return lines.map((line) => {
    if (line.key !== key) return line;
    const changed: EditableParchiLine = { ...line, ...patch, reviewed: false };
    const numericEdit =
      patch.qtyText !== undefined ||
      patch.unitText !== undefined ||
      patch.rateText !== undefined ||
      patch.totalText !== undefined ||
      patch.packText !== undefined ||
      patch.base_unit !== undefined;
    if (numericEdit) {
      changed.choice = null;
      changed.line_total_paisa = null;
      changed.qty_base_units = null;
      changed.rate_paisa = null;
      changed.written_total_paisa = null;
      changed.computed_total_paisa = null;
      changed.math_mismatch = false;
    }
    return changed;
  });
}

export function recalculateEditableLine(
  line: EditableParchiLine,
): { ok: true; line: EditableParchiLine } | { ok: false; error: string } {
  const quantity = parseQuantityPhrase(`${line.qtyText} ${line.unitText}`.trim());
  if (quantity.unresolved || quantity.hundredths === null || !quantity.unit) {
    return {
      ok: false,
      error: "Quantity ya unit saaf nahi hai — sahi adad aur unit darj karein.",
    };
  }
  const incompatible =
    (quantity.unit.family === "mass" && line.base_unit !== "g") ||
    (quantity.unit.family === "volume" && line.base_unit !== "ml") ||
    (quantity.unit.family === "count" && line.base_unit !== "pcs");
  if (incompatible) {
    return {
      ok: false,
      error: "Stock unit aur likhi hui quantity unit match nahi kar rahin.",
    };
  }
  if (
    line.match_status === "matched" &&
    quantity.unit.family === "pack" &&
    requiresExplicitPackSize(line.unitText)
  ) {
    return {
      ok: false,
      error:
        "Carton/bori ka size catalog mein nahi — kg, g, litre, ml, ya pcs mein quantity likhein.",
    };
  }
  let packSize = line.pack_size_base_units;
  if (line.conversion_unresolved && line.match_status === "new_sku") {
    packSize = Number(line.packText);
    if (!Number.isSafeInteger(packSize) || packSize <= 0) {
      return {
        ok: false,
        error: "New SKU ke liye package ke base units (e.g. 1000 ya 1) darj karein.",
      };
    }
  }
  const rate = parseParchiRupeesToPaisa(line.rateText);
  const written = parseParchiRupeesToPaisa(line.totalText);
  let qtyBase: number;
  try {
    qtyBase = quantityToBaseUnits(quantity, {
      name: line.name,
      base_unit: line.base_unit,
      pack_size_base_units: packSize,
      unit_price_paisa: rate ?? 0,
    });
  } catch {
    return { ok: false, error: "Yeh unit stock base unit mein convert nahi ho sakti." };
  }
  if (qtyBase <= 0 || !Number.isSafeInteger(qtyBase)) {
    return { ok: false, error: "Quantity positive safe integer honi chahiye." };
  }
  const computed = rate === null ? null : mulDiv(quantity.hundredths, rate, 100);
  const agree = computed !== null && written !== null && computed === written;
  const writtenOnly = written !== null && computed === null;
  const computedOnly = computed !== null && written === null;
  const lineTotal = agree ? computed : writtenOnly ? written : computedOnly ? computed : null;

  return {
    ok: true,
    line: {
      ...line,
      qty_number: quantity.hundredths / 100,
      unit: line.unitText,
      pack_size_base_units: packSize,
      conversion_unresolved: false,
      qty_base_units: qtyBase,
      rate_paisa: rate,
      written_total_paisa: written,
      computed_total_paisa: computed,
      line_total_paisa: lineTotal,
      math_mismatch: computed !== null && written !== null && computed !== written,
      choice: agree
        ? "agreed"
        : writtenOnly
          ? "written"
          : computedOnly
            ? "computed"
            : null,
      manual_review_required: true,
      reviewed: false,
      issues: [],
    },
  };
}

export function chooseParchiLineAmount(
  lines: EditableParchiLine[],
  key: string,
  choice: "computed" | "written",
): EditableParchiLine[] {
  return lines.map((entry) => {
    if (entry.key !== key) return entry;
    const amount = choice === "computed" ? entry.computed_total_paisa : entry.written_total_paisa;
    if (amount === null) return entry;
    return { ...entry, choice, line_total_paisa: amount, reviewed: false };
  });
}

export function confirmParchiLine(
  lines: EditableParchiLine[],
  key: string,
): EditableParchiLine[] {
  return lines.map((entry) => {
    if (entry.key !== key) return entry;
    if (
      entry.qty_base_units === null ||
      entry.qty_base_units <= 0 ||
      entry.line_total_paisa === null ||
      entry.line_total_paisa < 0
    ) {
      return entry;
    }
    return { ...entry, reviewed: true, manual_review_required: false };
  });
}

export interface ParchiReviewSummary {
  sumPaisa: number;
  totalSafe: boolean;
  newSkuCount: number;
  hasUnreviewedLine: boolean;
  grandTotalMismatch: boolean;
  grandTotalNeedsConfirmation: boolean;
  cashPaidPaisa: number | null;
  apBalancePaisa: number;
  canCommit: boolean;
}

export function summarizeParchiReview(
  lines: EditableParchiLine[],
  statedTotalPaisa: number | null,
  grandTotalAcknowledged: boolean,
  cashInputText: string,
): ParchiReviewSummary {
  const sumPaisa = lines.reduce((sum, line) => sum + (line.line_total_paisa ?? 0), 0);
  const totalSafe = Number.isSafeInteger(sumPaisa);
  const newSkuCount = lines.filter((line) => line.match_status === "new_sku").length;
  const hasUnreviewedLine = lines.some(
    (line) => !line.reviewed || line.qty_base_units === null || line.line_total_paisa === null,
  );
  const grandTotalMismatch = statedTotalPaisa === null || statedTotalPaisa !== sumPaisa;
  const grandTotalNeedsConfirmation = grandTotalMismatch && !grandTotalAcknowledged;
  const cashPaidPaisa = parseParchiRupeesToPaisa(cashInputText);
  const apBalancePaisa = Math.max(0, sumPaisa - (cashPaidPaisa ?? 0));
  const canCommit =
    lines.length > 0 &&
    !hasUnreviewedLine &&
    !grandTotalNeedsConfirmation &&
    totalSafe &&
    sumPaisa > 0 &&
    cashPaidPaisa !== null;

  return {
    sumPaisa,
    totalSafe,
    newSkuCount,
    hasUnreviewedLine,
    grandTotalMismatch,
    grandTotalNeedsConfirmation,
    cashPaidPaisa,
    apBalancePaisa,
    canCommit,
  };
}

export function buildPurchaseInput(opts: {
  idempotencyKey: string;
  parsed: ParchiParseResponse;
  lines: EditableParchiLine[];
  cashPaidPaisa: number;
  statedTotalPaisa: number | null;
}): PurchaseInput {
  const total = opts.lines.reduce((s, l) => s + (l.line_total_paisa ?? 0), 0);
  const payloadLines = opts.lines.map((line) => ({
    ...(line.product_id
      ? { product_id: line.product_id }
      : {
          new_sku: {
            name: line.name.trim() || line.written_name,
            base_unit: line.base_unit as BaseUnit,
            pack_size_base_units: line.pack_size_base_units,
          },
        }),
    qty_base_units: line.qty_base_units!,
    line_total_paisa: line.line_total_paisa!,
    spoken: line.written_name,
  }));

  const replayBase = {
    idempotency_key: opts.idempotencyKey,
    supplier_name: opts.parsed.supplier_name,
    cash_paid_paisa: Math.min(total, opts.cashPaidPaisa),
    stated_total_paisa: opts.statedTotalPaisa,
    lines: payloadLines,
  };

  return {
    ...replayBase,
    audit_meta: {
      channel: "parchi",
      model: opts.parsed.model,
      latency_ms: opts.parsed.latency_ms,
      legibility: opts.parsed.legibility,
      mismatches: opts.lines
        .filter((line) => line.math_mismatch)
        .map((line) => ({
          name: line.name,
          choice: line.choice,
          written: line.written_total_paisa,
          computed: line.computed_total_paisa,
        })),
      replay_payload: replayBase,
    },
  };
}
