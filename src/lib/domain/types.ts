import type { BaseUnit } from "./desi-units";

export type Intent = "sale" | "payment" | "reversal" | "pulse" | "purchase" | "question" | "unknown";
export type PaymentMode = "cash" | "udhaar" | "split" | "unspecified";

/** What the LLM (or the rule-based fallback) is allowed to propose. Mentions only — no arithmetic. */
export interface ParsedItem {
  /** item as spoken, e.g. "cheeni", "khula oil", "sarson da tail" */
  spoken: string;
  /** quantity phrase as spoken, e.g. "dedh pao", "2", "ek darjan"; null if value-first or absent */
  quantity_phrase: string | null;
  /** value-first rupees ("250 ka khula oil" → 250) */
  value_rupees: number | null;
  /** Unmodified evidence for a value-first amount, when supplied by extraction. */
  value_phrase?: string | null;
  /** Extraction could not reconcile a spoken number with its raw phrase. */
  number_unresolved?: boolean;
  is_loose: boolean;
  confidence: number;
}

export interface ParsedTurn {
  intent: Intent;
  transcript: string;
  customer_mention: string | null;
  items: ParsedItem[];
  discount_rupees: number | null;
  discount_phrase?: string | null;
  cash_paid_rupees: number | null;
  cash_phrase?: string | null;
  payment_mode: PaymentMode;
  /** amount for intent = payment ("Bilal ne 1500 jama karwaye") */
  payment_amount_rupees: number | null;
  payment_amount_phrase?: string | null;
  /** free-form question for the agent model (intent = question) */
  question: string | null;
  confidence: number;
  /** Set only after raw number evidence passes deterministic validation. */
  tier1_evidence_verified?: boolean;
  /** Non-item numeric evidence was present but could not be reconciled. */
  number_unresolved?: boolean;
}

export interface ProductRow {
  id: string;
  name: string;
  name_ur?: string | null;
  base_unit: BaseUnit;
  pack_size_base_units: number;
  unit_price_paisa: number;
  cost_price_paisa: number;
  stock_base_units: number;
  reorder_level_base_units?: number | null;
  aliases: string[];
}

export interface CustomerRow {
  id: string;
  name: string;
  role_tag?: string | null;
  phone?: string | null;
  balance_paisa: number;
  aliases: string[];
  last_paid_at?: string | null;
  oldest_unpaid_at?: string | null;
}

export interface Catalog {
  products: ProductRow[];
  customers: CustomerRow[];
}

export interface MatchTrace {
  score: number;
  matched: string;
  ms: number;
  key: string;
}

export interface NewSkuSpec {
  name: string;
  base_unit: BaseUnit;
  pack_size_base_units: number;
  unit_price_paisa: number;
  cost_price_paisa?: number;
}

export interface ProposalLine {
  key: string;
  kind: "catalog" | "new_sku";
  product_id: string | null;
  name: string;
  spoken: string;
  quantity_phrase: string | null;
  base_unit: BaseUnit;
  pack_size_base_units: number;
  unit_price_paisa: number;
  qty_base_units: number;
  line_total_paisa: number;
  value_first: boolean;
  value_paisa: number | null;
  is_loose: boolean;
  formula: string;
  match: MatchTrace | null;
  confidence: number;
  /** projected stock after this sale (null for new SKUs) */
  stock_after: number | null;
  /** false for a QuickAdd SKU whose price the shopkeeper has not confirmed */
  price_known: boolean;
  /** The displayed quantity/amount still needs an explicit human correction. */
  number_unresolved?: boolean;
}

export interface CustomerCandidate {
  id: string;
  name: string;
  role_tag: string | null;
  balance_paisa: number;
  score: number;
}

export type TierReason =
  | "UDHAAR"
  | "DISCOUNT"
  | "LOW_CONFIDENCE"
  | "AMBIGUOUS_CUSTOMER"
  | "NEW_SKU"
  | "NO_ITEMS"
  | "UDHAAR_REQUIRES_CUSTOMER"
  | "OVERPAYMENT_TO_KHATA"
  | "NEGATIVE_STOCK"
  | "UNRESOLVED_NUMBER"
  | "UNVERIFIED_EXTRACTION"
  | "EXPLICIT_CASH_REQUIRED";

export interface StockWarning {
  code: "NEGATIVE_STOCK";
  product_id: string;
  name: string;
  stock_after: number;
  base_unit: BaseUnit;
}

export interface SaleProposal {
  kind: "sale";
  lines: ProposalLine[];
  subtotal_paisa: number;
  discount_paisa: number;
  total_paisa: number;
  cash_paid_paisa: number;
  /** true when the cash figure was stated ("400 cash diya") rather than implied */
  cash_explicit: boolean;
  /** total − cash. Negative means the extra cash settles existing khata. */
  credit_paisa: number;
  change_due_paisa: number;
  payment_mode: PaymentMode;
  customer: {
    mention: string | null;
    candidates: CustomerCandidate[];
    selected_id: string | null;
    ambiguous: boolean;
    match_ms: number;
  };
  new_balance_paisa: number | null;
  tier: 1 | 2;
  tier_reasons: TierReason[];
  warnings: StockWarning[];
  confidence: number;
}

export interface PaymentProposal {
  kind: "payment";
  amount_paisa: number;
  customer: SaleProposal["customer"];
  new_balance_paisa: number | null;
  tier: 2;
  tier_reasons: TierReason[];
}

export interface CommitLineInput {
  product_id?: string | null;
  new_sku?: NewSkuSpec | null;
  qty_base_units?: number | null;
  value_paisa?: number | null;
  spoken?: string;
}

export interface CommitSaleInput {
  idempotency_key: string;
  customer_id: string | null;
  lines: CommitLineInput[];
  discount_paisa: number;
  cash_paid_paisa: number;
  audit_meta: Record<string, unknown>;
}
