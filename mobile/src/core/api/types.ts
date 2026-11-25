import type { BaseUnit } from "@domain/desi-units";
import type { PaymentProposal, SaleProposal } from "@domain/types";
import type { CommitResponse, FeedTx, JournalRow, PakPhoneTrace, Pulse, ShopState, TurnResponse, TurnTrace } from "@contracts";
import type { TradeSummary } from "@passport";

export interface MyShop {
  id: string;
  name: string;
  city: string | null;
  role: string;
  is_demo_shop: boolean;
  is_stage_shop: boolean;
}

export interface AppConfigResponse {
  min_supported_app_version: string;
  latest_app_version: string;
  features: {
    voice_enabled: boolean;
    parchi_ocr_enabled: boolean;
    tts_enabled: boolean;
    offline_queue_enabled: boolean;
    [key: string]: boolean | undefined;
  };
  turnstile_site_key: string | null;
  verify_public_key: string | null;
}

export interface XRayDoc {
  transaction: {
    id: string;
    seq: number;
    type: "sale" | "payment" | "purchase" | "reversal";
    total_paisa: number;
    discount_paisa: number;
    entry_hash: string;
    prev_hash: string;
    idempotency_key: string;
    created_at: string;
    audit_meta: Record<string, unknown> & {
      replay_payload?: Record<string, unknown>;
      transcript?: string;
      transcript_roman?: string;
      model?: string;
      latency_ms?: number;
      pakphone?: PakPhoneTrace;
      source?: string;
    };
  };
  journal: JournalRow[];
  delta: number;
  hash_valid: boolean;
  rows_for_key: number;
  rls_shop_id: string;
  reversed_by: string | null;
}

export interface ChainVerifyResponse {
  ok: boolean;
  code: string;
  checked: number;
  ms: number;
  first_broken_seq?: number;
  api_ms?: number;
}

export interface FeedPage {
  items: FeedTx[];
  next_before_seq: number | null;
  api_ms?: number;
}

export interface CustomerLedgerPage {
  customer?: {
    id: string;
    name: string;
    role_tag: string | null;
    phone: string | null;
    balance_paisa: number;
    credit_limit_paisa?: number | null;
  };
  items: FeedTx[];
  next_before_seq: number | null;
  api_ms?: number;
}

export interface TradeSummaryResponse {
  summary: TradeSummary;
  payload: Record<string, unknown>;
  token: string;
  verify_url: string;
  signature_hex: string;
  public_key_hex: string;
  chain: { ok: boolean; checked: number };
  disclaimer: string;
  api_ms?: number;
}

export interface ParchiParseLine {
  key: string;
  raw: {
    name: string;
    quantity: string | null;
    unit: string | null;
    rate: string | null;
    line_total: string | null;
  };
  written_name: string;
  match_status: "matched" | "new_sku";
  product_id: string | null;
  name: string;
  match_score: number;
  base_unit: BaseUnit;
  pack_size_base_units: number;
  conversion_unresolved: boolean;
  qty_number: number | null;
  unit: string | null;
  qty_base_units: number | null;
  rate_paisa: number | null;
  written_total_paisa: number | null;
  computed_total_paisa: number | null;
  line_total_paisa: number | null;
  math_mismatch: boolean;
  manual_review_required: boolean;
  issues: string[];
  low_confidence: boolean;
  confidence: number;
}

export interface ParchiParseResponse {
  supplier_name: string;
  bill_date: string | null;
  legibility: "good" | "fair" | "poor";
  lines: ParchiParseLine[];
  math_check: {
    passed: boolean;
    checked: boolean;
    extracted_total_paisa: number | null;
    computed_total_paisa: number | null;
    delta_paisa: number | null;
  };
  manual_review_required: boolean;
  new_sku_count: number;
  mismatch_count: number;
  model: string;
  latency_ms: number;
  write_tools_bound: 0;
  api_ms?: number;
}

export interface SandboxCredentials {
  email: string;
  password: string;
  shop_id: string;
}

export interface PaymentInput {
  idempotency_key: string;
  customer_id: string;
  amount_paisa: number;
  audit_meta: Record<string, unknown>;
}

export interface ReverseInput {
  idempotency_key: string;
  transaction_id: string | null;
  reason?: string;
  audit_meta: Record<string, unknown>;
}

export interface PurchaseInput {
  idempotency_key: string;
  supplier_name: string;
  cash_paid_paisa: number | null;
  stated_total_paisa?: number | null;
  lines: {
    product_id?: string | null;
    new_sku?: {
      name: string;
      base_unit: BaseUnit;
      pack_size_base_units: number;
      unit_price_paisa?: number | null;
    } | null;
    qty_base_units: number;
    line_total_paisa: number;
    spoken?: string;
  }[];
  audit_meta: Record<string, unknown>;
}

export type { CommitResponse, FeedTx, JournalRow, PakPhoneTrace, PaymentProposal, Pulse, SaleProposal, ShopState, TurnResponse, TurnTrace };
