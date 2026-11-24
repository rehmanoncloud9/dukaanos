import { z } from "zod";
import type { CommitResponse } from "@/lib/api/contracts";
import { handle, ok, parseJson } from "@/lib/api/http";
import { requireShopContext } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { rpc } from "@/lib/supabase/server";

export const maxDuration = 60;

const Int = z.number().int();

const Body = z.object({
  idempotency_key: z.string().min(8).max(120),
  customer_id: z.string().uuid().nullable(),
  discount_paisa: Int.min(0).default(0),
  cash_paid_paisa: Int.min(0).nullable(),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid().nullable().optional(),
        new_sku: z
          .object({
            name: z.string().trim().min(1).max(80),
            base_unit: z.enum(["g", "ml", "pcs"]),
            pack_size_base_units: Int.positive(),
            unit_price_paisa: Int.min(0),
            cost_price_paisa: Int.min(0).optional(),
          })
          .nullable()
          .optional(),
        qty_base_units: Int.positive().nullable().optional(),
        value_paisa: Int.positive().nullable().optional(),
        spoken: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(40),
  audit_meta: z.record(z.string(), z.unknown()).default({}),
});

/** commit_sale — the ONLY way a sale reaches the books (server recomputes every paisa). */
export const POST = handle(async (req: Request) => {
  const t0 = Date.now();
  const { sb, shopId, userId } = await requireShopContext(req);
  await enforceRateLimit(`write:${userId}`, 120, "1 minute");
  const body = await parseJson(req, Body);
  const res = await rpc<CommitResponse>(sb, "commit_sale", {
    p_shop_id: shopId,
    p_payload: { ...body, audit_meta: { ...body.audit_meta, user_agent: req.headers.get("user-agent")?.slice(0, 120) } },
  });
  return ok({ ...res, api_ms: Date.now() - t0 });
});
