import { z } from "zod";
import type { CommitResponse } from "@/lib/api/contracts";
import { ApiError, handle, ok, parseJson } from "@/lib/api/http";
import { requireShopContext } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { rpc } from "@/lib/supabase/server";

export const maxDuration = 60;

const Int = z.number().int();
const Key = z.string().min(8).max(120);
const Meta = z.record(z.string(), z.unknown()).default({});

/** POST /api/transactions/reverse — Undo (5 s toast), "pichli entry wapas", or any feed row. */
const ReverseBody = z.object({
  idempotency_key: Key,
  transaction_id: z.string().uuid().nullable(),
  reason: z.string().max(80).optional(),
  audit_meta: Meta,
});

/** POST /api/transactions/payment — Wasooli (record_payment). */
const PaymentBody = z.object({
  idempotency_key: Key,
  customer_id: z.string().uuid(),
  amount_paisa: Int.positive(),
  audit_meta: Meta,
});

/** POST /api/transactions/purchase — Parchi Restock Commit (record_purchase). */
const PurchaseBody = z.object({
  idempotency_key: Key,
  supplier_name: z.string().trim().max(80).default("Wholesale"),
  cash_paid_paisa: Int.min(0).nullable(),
  stated_total_paisa: Int.min(0).nullable().optional(),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid().nullable().optional(),
        new_sku: z
          .object({
            name: z.string().trim().min(1).max(80),
            base_unit: z.enum(["g", "ml", "pcs"]),
            pack_size_base_units: Int.positive(),
            unit_price_paisa: Int.min(0).nullable().optional(),
          })
          .nullable()
          .optional(),
        qty_base_units: Int.positive(),
        line_total_paisa: Int.min(0),
        spoken: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(60),
  audit_meta: Meta,
});

const ReturnBody = z.object({
  idempotency_key: Key,
  customer_id: z.string().uuid().nullable().optional(),
  cash_refund_paisa: Int.min(0).nullable().optional(),
  reason: z.string().max(80).optional(),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        qty_base_units: Int.positive(),
        refund_paisa: Int.positive().optional(),
        spoken: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(40),
  audit_meta: Meta,
});

const AdjustBody = z.object({
  idempotency_key: Key,
  product_id: z.string().uuid(),
  delta_base_units: Int.refine((n) => n !== 0, "delta_base_units must be non-zero"),
  reason: z.enum(["wastage", "spoilage", "personal_use", "stock_count", "damaged", "other"]).default("wastage"),
  audit_meta: Meta,
});

const WriteOffBody = z.object({
  idempotency_key: Key,
  customer_id: z.string().uuid(),
  amount_paisa: Int.positive(),
  reason: z.string().max(80).optional(),
  audit_meta: Meta,
});

const ROUTES = {
  reverse: { fn: "reverse_transaction", schema: ReverseBody },
  payment: { fn: "record_payment", schema: PaymentBody },
  purchase: { fn: "record_purchase", schema: PurchaseBody },
  return: { fn: "record_return", schema: ReturnBody },
  adjust: { fn: "adjust_stock", schema: AdjustBody },
  "write-off": { fn: "write_off_udhaar", schema: WriteOffBody },
} as const;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ action: string }> }) => {
  const t0 = Date.now();
  const { action } = await ctx.params;
  const route = ROUTES[action as keyof typeof ROUTES];
  if (!route) throw new ApiError("BAD_REQUEST", `Unknown transaction action "${action}"`, undefined, 404);
  const { sb, shopId, userId } = await requireShopContext(req);
  await enforceRateLimit(`write:${userId}`, 120, "1 minute");
  const body = await parseJson(req, route.schema as z.ZodType<Record<string, unknown>>);
  const res = await rpc<CommitResponse>(sb, route.fn, { p_shop_id: shopId, p_payload: body });
  return ok({ ...res, api_ms: Date.now() - t0 });
});
