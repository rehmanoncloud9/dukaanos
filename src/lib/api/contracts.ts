/** Wire types shared by API routes and the PWA (no server-only imports here). */
import type { BaseUnit } from "@/lib/domain/desi-units";
import type { Catalog, CustomerRow, PaymentProposal, ProductRow, SaleProposal } from "@/lib/domain/types";

export interface JournalRow {
  account_code: string;
  account_name: string;
  side: "DR" | "CR";
  amount_paisa: number;
  customer_id?: string | null;
}

export interface CommitResponse {
  status: "COMMITTED" | "REPLAY_DEDUPLICATED";
  http: number;
  deduplicated: boolean;
  duplicate_rows: number;
  rows_for_key: number;
  type: "sale" | "payment" | "purchase" | "reversal";
  transaction_id: string;
  seq: number;
  prev_hash: string;
  entry_hash: string;
  created_at: string;
  rls_shop_id: string;
  totals: Record<string, number>;
  journal: JournalRow[];
  delta: number;
  warnings: Array<{ code: "NEGATIVE_STOCK"; product_id: string; name: string; stock_after: number; base_unit: BaseUnit }>;
  credit_warning?: { code: "CREDIT_LIMIT_EXCEEDED"; customer_id: string; name: string; balance_after_paisa: number; credit_limit_paisa: number } | null;
  customer?: { id: string; name: string; role_tag: string | null; phone: string | null; balance_paisa: number } | null;
  lines?: Array<Record<string, unknown>>;
  math_check?: { stated_total_paisa: number | null; computed_total_paisa: number; passed: boolean; delta_paisa: number };
  reversed_transaction_id?: string;
  rpc_ms: number;
  api_ms?: number;
}

export interface FeedTx {
  id: string;
  seq: number;
  type: "sale" | "payment" | "purchase" | "reversal";
  customer_id: string | null;
  customer_name: string | null;
  customer_role: string | null;
  supplier_name: string | null;
  reversed_transaction_id: string | null;
  subtotal_paisa: number;
  discount_paisa: number;
  total_paisa: number;
  cash_paid_paisa: number;
  credit_paisa: number;
  entry_hash: string;
  prev_hash: string;
  created_at: string;
  audit_meta: Record<string, unknown>;
  idempotency_key: string;
  is_reversed: boolean;
  lines: Array<{ name: string; qty_base_units: number; base_unit: BaseUnit; line_total_paisa: number; value_first: boolean; product_id: string | null }>;
}

export interface StateCustomer extends CustomerRow {
  code: string | null;
  days_overdue: number | null;
  credit_limit_paisa?: number | null;
}

export interface StateProduct extends ProductRow {
  sku_code: string;
  is_quick_added: boolean;
  sold_7d: number;
  days_left: number | null;
}

export interface Galla {
  cash_sales_paisa: number;
  sales_count: number;
  cash_sales_count: number;
  udhaar_paisa: number;
  udhaar_accounts: number;
  gross_sales_paisa: number;
  wasooli_paisa: number;
  purchases_cash_paisa: number;
  cash_in_galla_paisa: number;
  est_margin_paisa: number;
}

export interface ShopState {
  shop: { id: string; name: string; owner_name: string | null; phone: string | null; city: string | null; is_demo_shop: boolean; is_stage_shop: boolean; active_since: string };
  today: Galla;
  feed: FeedTx[];
  customers: StateCustomer[];
  products: StateProduct[];
  chain_head: { seq: number; entry_hash: string } | null;
  sql_ms: number;
}

export interface Pulse {
  overdue: {
    count: number;
    total_paisa: number;
    items: Array<{ id: string; name: string; role_tag: string | null; phone: string | null; balance_paisa: number; last_paid_at: string | null; oldest_unpaid_at: string; days_overdue: number }>;
  };
  stockout: {
    count: number;
    items: Array<{ id: string; name: string; name_ur: string | null; base_unit: BaseUnit; pack_size_base_units: number; stock_base_units: number; sold_7d: number; daily_avg: number; days_left: number; suggested_base_units: number }>;
  };
  galla: Galla;
  generated_at: string;
  sql_ms: number;
  llm_cost_rs: 0;
  api_ms?: number;
}

export interface PakPhoneTrace {
  ms_total: number;
  items: Array<{ spoken: string; matched: string; product: string | null; score: number; key: string; ms: number; formula: string }>;
  customer: { mention: string; candidates: Array<{ name: string; score: number }>; ms: number } | null;
}

export interface TurnTrace {
  transcript: string;
  transcript_roman?: string;
  source: "regex" | "model" | "rules";
  model: string | null;
  latency_ms: number;
  api_ms: number;
  attempts: Array<{ model: string; ok: boolean; error?: string; ms: number }>;
  pakphone: PakPhoneTrace | null;
  degraded_reason?: string;
  intent: string;
}

export type TurnResponse =
  | { kind: "sale"; proposal: SaleProposal; trace: TurnTrace }
  | { kind: "payment"; proposal: PaymentProposal; trace: TurnTrace }
  | { kind: "reversal"; target: FeedTx | null; trace: TurnTrace }
  | { kind: "pulse"; pulse: Pulse; trace: TurnTrace }
  | { kind: "answer"; answer: string; proposal: SaleProposal | PaymentProposal | null; tools: Array<{ name: string; ms: number }>; trace: TurnTrace }
  | { kind: "purchase"; trace: TurnTrace }
  | { kind: "unknown"; trace: TurnTrace };

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function stateToCatalog(s: Pick<ShopState, "products" | "customers">): Catalog {
  return {
    products: s.products.map((p) => ({ ...p, aliases: p.aliases ?? [] })),
    customers: s.customers.map((c) => ({ ...c, aliases: c.aliases ?? [] })),
  };
}
