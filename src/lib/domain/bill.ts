/**
 * Bill compiler: turns a ParsedTurn (mentions only) + the shop catalog into a
 * deterministic, integer-paisa proposal and decides the safety tier.
 * The LLM never does arithmetic — every number below is computed here (and
 * re-computed authoritatively inside the commit_sale RPC).
 */

import {
  formatBaseQty,
  parseQuantityPhrase,
  resolveLine,
  type BaseUnit,
  type ProductUnitInfo,
} from "./desi-units";
import { mulDiv, rupeesToPaisa } from "./money";
import {
  customerCandidates,
  isAmbiguous,
  matchCatalog,
  PRODUCT_MATCH_THRESHOLD,
  type CatalogEntry,
} from "./pakphone";
import type {
  Catalog,
  CommitSaleInput,
  CustomerCandidate,
  CustomerRow,
  ParsedTurn,
  PaymentProposal,
  ProposalLine,
  SaleProposal,
  StockWarning,
  TierReason,
} from "./types";

export const TIER1_CONFIDENCE = 0.9;

export function productEntries(products: Catalog["products"]): CatalogEntry[] {
  return products.map((p) => ({ id: p.id, name: p.name, aliases: [...p.aliases, ...(p.name_ur ? [p.name_ur] : [])] }));
}

export function customerEntries(customers: CustomerRow[]): CatalogEntry[] {
  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: [...c.aliases, ...(c.role_tag ? [`${c.name} ${c.role_tag}`] : [])],
  }));
}

/** Guess a sensible base unit for a brand-new SKU from how it was spoken. */
export function guessNewSkuUnit(quantityPhrase: string | null, spoken: string): { base_unit: BaseUnit; pack: number } {
  const q = parseQuantityPhrase(quantityPhrase);
  const fam = q.unit?.family;
  if (fam === "mass") return { base_unit: "g", pack: 1000 };
  if (fam === "volume") return { base_unit: "ml", pack: 1000 };
  if (/\b(oil|tel|tail|doodh|milk|ghee)\b/i.test(spoken)) return { base_unit: "ml", pack: 1000 };
  if (/\b(atta|aata|cheeni|chawal|daal|dal|sugar|rice|flour|besan|maida)\b/i.test(spoken)) return { base_unit: "g", pack: 1000 };
  return { base_unit: "pcs", pack: 1 };
}

function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

let keySeq = 0;
function lineKey(): string {
  keySeq += 1;
  return `l${Date.now().toString(36)}${keySeq}`;
}

export function buildLines(parsed: ParsedTurn, catalog: Catalog): ProposalLine[] {
  const entries = productEntries(catalog.products);
  const lines: ProposalLine[] = [];
  for (const item of parsed.items) {
    const report = matchCatalog(item.spoken, entries, 3);
    const top = report.results[0];
    const quantity = parseQuantityPhrase(item.quantity_phrase);
    const valuePaisa = item.value_rupees && item.value_rupees > 0 ? rupeesToPaisa(item.value_rupees) : null;
    const trace = top
      ? { score: top.score, matched: top.matched, ms: report.ms, key: top.key }
      : { score: 0, matched: "", ms: report.ms, key: report.key };

    if (top && top.score >= PRODUCT_MATCH_THRESHOLD) {
      const product = catalog.products.find((p) => p.id === top.id)!;
      const res = resolveLine(product, { quantity, value_paisa: valuePaisa });
      lines.push({
        key: lineKey(),
        kind: "catalog",
        product_id: product.id,
        name: product.name,
        spoken: item.spoken,
        quantity_phrase: item.quantity_phrase,
        base_unit: product.base_unit,
        pack_size_base_units: product.pack_size_base_units,
        unit_price_paisa: product.unit_price_paisa,
        qty_base_units: res.qty_base_units,
        line_total_paisa: res.line_total_paisa,
        value_first: res.value_first,
        value_paisa: valuePaisa,
        is_loose: item.is_loose,
        formula: res.formula,
        match: trace,
        confidence: Math.min(item.confidence, top.score >= 0.9 ? 1 : top.score),
        stock_after: product.stock_base_units - res.qty_base_units,
        price_known: true,
      });
    } else {
      // QuickAddChip: uncataloged item never errors — it becomes an editable new SKU line.
      const guess = guessNewSkuUnit(item.quantity_phrase, item.spoken);
      const name = titleCase(item.spoken);
      lines.push(
        recalcNewSkuLine({
          key: lineKey(),
          kind: "new_sku",
          product_id: null,
          name,
          spoken: item.spoken,
          quantity_phrase: item.quantity_phrase,
          base_unit: guess.base_unit,
          pack_size_base_units: guess.pack,
          unit_price_paisa: valuePaisa ?? 0,
          qty_base_units: 0,
          line_total_paisa: 0,
          value_first: valuePaisa !== null,
          value_paisa: valuePaisa,
          is_loose: item.is_loose,
          formula: "",
          match: trace,
          confidence: Math.min(item.confidence, 0.5),
          stock_after: null,
          price_known: false,
        }),
      );
    }
  }
  return lines;
}

/**
 * Recompute a QuickAdd line. Value-first with unknown price sells "one unit worth
 * Rs. X"; once the shopkeeper types a price, qty is derived deterministically.
 */
export function recalcNewSkuLine(line: ProposalLine): ProposalLine {
  const quantity = parseQuantityPhrase(line.quantity_phrase);
  if (line.value_paisa && line.value_paisa > 0) {
    if (!line.price_known || line.unit_price_paisa <= 0) {
      return {
        ...line,
        unit_price_paisa: line.value_paisa,
        qty_base_units: line.pack_size_base_units,
        line_total_paisa: line.value_paisa,
        formula: `value("${line.value_paisa / 100} ka") → new SKU "${line.name}" @ Rs. ${line.value_paisa / 100}/${packLabel(line)} (QuickAdd)`,
      };
    }
    const info: ProductUnitInfo = line;
    const res = resolveLine(info, { value_paisa: line.value_paisa });
    return { ...line, qty_base_units: res.qty_base_units, line_total_paisa: res.line_total_paisa, formula: `${res.formula} (QuickAdd)` };
  }
  if (line.unit_price_paisa <= 0) {
    const qty = Math.max(1, Math.round(((quantity.quarters ?? 4) * line.pack_size_base_units) / 4));
    return { ...line, qty_base_units: qty, line_total_paisa: 0, formula: `new SKU "${line.name}" × ${formatBaseQty(qty, line.base_unit)} — price needed` };
  }
  const res = resolveLine(line, { quantity });
  return { ...line, qty_base_units: res.qty_base_units, line_total_paisa: res.line_total_paisa, formula: `${res.formula} (QuickAdd)` };
}

function packLabel(line: Pick<ProposalLine, "base_unit" | "pack_size_base_units">): string {
  if (line.base_unit === "pcs") return line.pack_size_base_units === 1 ? "pc" : `${line.pack_size_base_units} pcs`;
  return line.pack_size_base_units === 1000 ? (line.base_unit === "g" ? "kg" : "L") : formatBaseQty(line.pack_size_base_units, line.base_unit);
}

/** Recompute a catalog line after the shopkeeper edits its quantity phrase or value. */
export function recalcCatalogLine(line: ProposalLine, stockBefore: number | null): ProposalLine {
  const res = resolveLine(line, {
    quantity: parseQuantityPhrase(line.quantity_phrase),
    value_paisa: line.value_first ? line.value_paisa : null,
  });
  return {
    ...line,
    qty_base_units: res.qty_base_units,
    line_total_paisa: res.line_total_paisa,
    formula: res.formula,
    stock_after: stockBefore === null ? null : stockBefore - res.qty_base_units,
  };
}

/** Set an explicit base-unit quantity (stepper edits) and recompute the total. */
export function setLineQty(line: ProposalLine, qtyBaseUnits: number, stockBefore: number | null): ProposalLine {
  const qty = Math.max(1, Math.round(qtyBaseUnits));
  const total = line.unit_price_paisa > 0 ? mulDiv(qty, line.unit_price_paisa, line.pack_size_base_units) : 0;
  return {
    ...line,
    qty_base_units: qty,
    line_total_paisa: total,
    value_first: false,
    value_paisa: null,
    formula: `edit → ${formatBaseQty(qty, line.base_unit)} @ Rs. ${line.unit_price_paisa / 100}/${packLabel(line)} = ${total / 100} PKR`,
    stock_after: stockBefore === null ? null : stockBefore - qty,
  };
}

export function buildCustomerBlock(mention: string | null, customers: CustomerRow[]): SaleProposal["customer"] {
  if (!mention) return { mention: null, candidates: [], selected_id: null, ambiguous: false, match_ms: 0 };
  const report = customerCandidates(mention, customerEntries(customers), 3);
  const candidates: CustomerCandidate[] = report.results.map((r) => {
    const c = customers.find((x) => x.id === r.id)!;
    return { id: c.id, name: c.name, role_tag: c.role_tag ?? null, balance_paisa: c.balance_paisa, score: r.score };
  });
  const ambiguous = isAmbiguous(report.results);
  return {
    mention,
    candidates,
    selected_id: candidates[0]?.id ?? null,
    ambiguous,
    match_ms: report.ms,
  };
}

export interface SettlementInput {
  lines: ProposalLine[];
  discount_paisa: number;
  cash_paid_paisa: number | null;
  payment_mode: SaleProposal["payment_mode"];
  customer: SaleProposal["customer"];
  customers: CustomerRow[];
  confidence: number;
}

/** Totals, split settlement, tier gate and warnings — pure and deterministic. */
export function settle(input: SettlementInput): SaleProposal {
  const { lines, customer } = input;
  const subtotal = lines.reduce((s, l) => s + l.line_total_paisa, 0);
  const discount = Math.max(0, Math.min(input.discount_paisa, subtotal));
  const total = subtotal - discount;

  const hasCustomer = customer.selected_id !== null;
  let cash: number;
  if (input.cash_paid_paisa !== null) cash = Math.max(0, input.cash_paid_paisa);
  else if (input.payment_mode === "udhaar" || input.payment_mode === "split") cash = 0;
  else if (input.payment_mode === "unspecified" && hasCustomer) cash = 0;
  else cash = total;

  let change = 0;
  if (!hasCustomer && cash > total) {
    change = cash - total;
    cash = total;
  }
  const credit = total - cash;

  const selected = input.customers.find((c) => c.id === customer.selected_id) ?? null;
  const newBalance = selected ? selected.balance_paisa + credit : null;

  const reasons: TierReason[] = [];
  if (lines.length === 0) reasons.push("NO_ITEMS");
  if (credit > 0) reasons.push("UDHAAR");
  if (credit < 0) reasons.push("OVERPAYMENT_TO_KHATA");
  if (credit !== 0 && !hasCustomer) reasons.push("UDHAAR_REQUIRES_CUSTOMER");
  if (discount > 0) reasons.push("DISCOUNT");
  if (customer.mention && customer.ambiguous) reasons.push("AMBIGUOUS_CUSTOMER");
  if (lines.some((l) => l.kind === "new_sku")) reasons.push("NEW_SKU");
  const minConf = Math.min(input.confidence, ...lines.map((l) => l.confidence));
  if (minConf < TIER1_CONFIDENCE) reasons.push("LOW_CONFIDENCE");

  const warnings: StockWarning[] = lines
    .filter((l) => l.product_id && l.stock_after !== null && l.stock_after < 0)
    .map((l) => ({ code: "NEGATIVE_STOCK" as const, product_id: l.product_id!, name: l.name, stock_after: l.stock_after!, base_unit: l.base_unit }));

  return {
    kind: "sale",
    lines,
    subtotal_paisa: subtotal,
    discount_paisa: discount,
    total_paisa: total,
    cash_paid_paisa: cash,
    cash_explicit: input.cash_paid_paisa !== null,
    credit_paisa: credit,
    change_due_paisa: change,
    payment_mode: input.payment_mode,
    customer,
    new_balance_paisa: newBalance,
    tier: reasons.length === 0 ? 1 : 2,
    tier_reasons: reasons,
    warnings,
    confidence: minConf === Infinity ? input.confidence : minConf,
  };
}

export function buildSaleProposal(parsed: ParsedTurn, catalog: Catalog): SaleProposal {
  const lines = buildLines(parsed, catalog);
  const customer = buildCustomerBlock(parsed.customer_mention, catalog.customers);
  return settle({
    lines,
    discount_paisa: parsed.discount_rupees ? rupeesToPaisa(parsed.discount_rupees) : 0,
    cash_paid_paisa: parsed.cash_paid_rupees !== null && parsed.cash_paid_rupees !== undefined ? rupeesToPaisa(parsed.cash_paid_rupees) : null,
    payment_mode: parsed.payment_mode,
    customer,
    customers: catalog.customers,
    confidence: parsed.confidence,
  });
}

/** Re-settle after any edit on the Tier-2 card (chip tap, QuickAdd price, cash edit…). */
export function resettle(
  p: SaleProposal,
  customers: CustomerRow[],
  patch: Partial<Pick<SaleProposal, "lines" | "discount_paisa" | "payment_mode">> & {
    cash_paid_paisa?: number | null;
    selected_customer_id?: string | null;
  },
): SaleProposal {
  const customer = {
    ...p.customer,
    selected_id: patch.selected_customer_id !== undefined ? patch.selected_customer_id : p.customer.selected_id,
    // an explicit tap resolves the ambiguity
    ambiguous: patch.selected_customer_id !== undefined ? false : p.customer.ambiguous,
  };
  if (patch.selected_customer_id && !customer.candidates.some((c) => c.id === patch.selected_customer_id)) {
    const c = customers.find((x) => x.id === patch.selected_customer_id);
    if (c) customer.candidates = [{ id: c.id, name: c.name, role_tag: c.role_tag ?? null, balance_paisa: c.balance_paisa, score: 1 }, ...customer.candidates].slice(0, 4);
  }
  const lines = (patch.lines ?? p.lines).map((l) => (l.kind === "new_sku" ? { ...l, confidence: l.price_known ? 1 : l.confidence } : l));
  return settle({
    lines,
    discount_paisa: patch.discount_paisa ?? p.discount_paisa,
    cash_paid_paisa:
      patch.cash_paid_paisa !== undefined
        ? patch.cash_paid_paisa
        : p.cash_explicit
          ? p.cash_paid_paisa + p.change_due_paisa
          : null,
    payment_mode: patch.payment_mode ?? p.payment_mode,
    customer,
    customers,
    confidence: 1, // human-reviewed
  });
}

export function buildPaymentProposal(parsed: ParsedTurn, customers: CustomerRow[]): PaymentProposal {
  const customer = buildCustomerBlock(parsed.customer_mention, customers);
  const amount = parsed.payment_amount_rupees ? rupeesToPaisa(parsed.payment_amount_rupees) : 0;
  const selected = customers.find((c) => c.id === customer.selected_id) ?? null;
  const reasons: TierReason[] = [];
  if (!customer.selected_id) reasons.push("UDHAAR_REQUIRES_CUSTOMER");
  if (customer.ambiguous) reasons.push("AMBIGUOUS_CUSTOMER");
  return {
    kind: "payment",
    amount_paisa: amount,
    customer,
    new_balance_paisa: selected ? selected.balance_paisa - amount : null,
    tier: 2,
    tier_reasons: reasons,
  };
}

/** Wire payload for /api/transactions/commit — server recomputes everything again. */
export function toCommitInput(p: SaleProposal, idempotencyKey: string, auditMeta: Record<string, unknown>): CommitSaleInput {
  return {
    idempotency_key: idempotencyKey,
    customer_id: p.customer.selected_id,
    discount_paisa: p.discount_paisa,
    cash_paid_paisa: p.cash_paid_paisa,
    lines: p.lines.map((l) =>
      l.kind === "catalog"
        ? {
            product_id: l.product_id,
            qty_base_units: l.value_first ? null : l.qty_base_units,
            value_paisa: l.value_first ? l.value_paisa : null,
            spoken: l.spoken,
          }
        : {
            new_sku: {
              name: l.name,
              base_unit: l.base_unit,
              pack_size_base_units: l.pack_size_base_units,
              unit_price_paisa: l.unit_price_paisa,
            },
            qty_base_units: l.qty_base_units,
            value_paisa: null,
            spoken: l.spoken,
          },
    ),
    audit_meta: auditMeta,
  };
}

/** A human summary like "375g Cheeni, Khula Oil (Rs. 250)". */
export function summarizeLines(lines: Pick<ProposalLine, "name" | "qty_base_units" | "base_unit" | "value_first" | "line_total_paisa">[]): string {
  return lines
    .map((l) => (l.value_first ? `${l.name} (Rs. ${l.line_total_paisa / 100})` : `${formatBaseQty(l.qty_base_units, l.base_unit)} ${l.name}`))
    .join(", ");
}
