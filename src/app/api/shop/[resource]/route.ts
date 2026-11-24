import { z } from "zod";
import { ApiError, handle, ok, parseJson } from "@/lib/api/http";
import { loadState, numify } from "@/lib/api/shop";
import { requireShopContext } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { rpc } from "@/lib/supabase/server";

export const maxDuration = 60;

type Ctx = { params: Promise<{ resource: string }> };

/**
 * GET /api/shop/state            — one round-trip PWA state (feed, khata, maal, today's galla)
 * GET /api/shop/pulse            — get_munshi_pulse (<40 ms SQL, Rs. 0 LLM)
 * GET /api/shop/chain            — verify_ledger_chain (recomputes every SHA-256 link)
 * GET /api/shop/xray?id          — X-Ray for one transaction (journal, Δ, hash recompute, rows_for_key)
 * GET /api/shop/customer-ledger  — paginated khata history for a customer
 * GET /api/shop/feed             — paginated transaction feed for infinite scroll
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const t0 = Date.now();
  const { resource } = await ctx.params;
  const { sb, shopId } = await requireShopContext(req);
  const url = new URL(req.url);

  switch (resource) {
    case "state":
      return ok({ ...(await loadState(sb, shopId)), api_ms: Date.now() - t0 });
    case "pulse":
      return ok({ ...numify(await rpc<Record<string, unknown>>(sb, "get_munshi_pulse", { p_shop_id: shopId })), api_ms: Date.now() - t0 });
    case "chain":
      return ok({ ...(await rpc<Record<string, unknown>>(sb, "verify_ledger_chain", { p_shop_id: shopId })), api_ms: Date.now() - t0 });
    case "xray": {
      const id = url.searchParams.get("id");
      if (!id) throw new ApiError("BAD_REQUEST", "id required");
      return ok({ ...numify(await rpc<Record<string, unknown>>(sb, "get_transaction_xray", { p_shop_id: shopId, p_transaction_id: id })), api_ms: Date.now() - t0 });
    }
    case "customer-ledger": {
      const customerId = url.searchParams.get("customer_id");
      if (!customerId || !/^[0-9a-f-]{36}$/i.test(customerId)) throw new ApiError("BAD_REQUEST", "customer_id required");
      const beforeSeq = url.searchParams.get("before_seq");
      const limit = url.searchParams.get("limit");
      const data = await rpc<Record<string, unknown>>(sb, "get_customer_ledger", {
        p_shop_id: shopId,
        p_customer_id: customerId,
        p_before_seq: beforeSeq ? Number(beforeSeq) : null,
        p_limit: limit ? Number(limit) : 50,
      });
      return ok({ ...numify(data), api_ms: Date.now() - t0 });
    }
    case "feed": {
      const beforeSeq = url.searchParams.get("before_seq");
      const limit = url.searchParams.get("limit");
      const data = await rpc<Record<string, unknown>>(sb, "get_shop_feed", {
        p_shop_id: shopId,
        p_before_seq: beforeSeq ? Number(beforeSeq) : null,
        p_limit: limit ? Number(limit) : 40,
      });
      return ok({ ...numify(data), api_ms: Date.now() - t0 });
    }
    default:
      throw new ApiError("BAD_REQUEST", `Unknown resource "${resource}"`, undefined, 404);
  }
});

const AddCustomer = z.object({ name: z.string().trim().min(1).max(60), phone: z.string().max(20).optional(), role_tag: z.string().max(40).optional() });
const UpdateCustomer = z.object({ customer_id: z.string().uuid(), phone: z.string().max(20).optional(), role_tag: z.string().max(40).optional() });
const CreditLimit = z.object({ customer_id: z.string().uuid(), credit_limit_paisa: z.number().int().min(0).nullable() });
const Price = z.object({ product_id: z.string().uuid(), unit_price_paisa: z.number().int().min(0) });
const Alias = z.object({ product_id: z.string().uuid(), alias: z.string().trim().min(1).max(60) });

/** Non-financial shop admin (still RPC-only, still membership-checked in Postgres). */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { resource } = await ctx.params;
  const { sb, shopId, userId } = await requireShopContext(req);
  await enforceRateLimit(`write:${userId}`, 120, "1 minute");

  switch (resource) {
    case "customer": {
      const b = await parseJson(req, AddCustomer);
      return ok(await rpc(sb, "add_customer", { p_shop_id: shopId, p_name: b.name, p_phone: b.phone ?? null, p_role_tag: b.role_tag ?? null }));
    }
    case "customer-update": {
      const b = await parseJson(req, UpdateCustomer);
      return ok(await rpc(sb, "update_customer", { p_shop_id: shopId, p_customer_id: b.customer_id, p_phone: b.phone ?? null, p_role_tag: b.role_tag ?? null }));
    }
    case "customer-credit-limit": {
      const b = await parseJson(req, CreditLimit);
      return ok(await rpc(sb, "update_customer_credit_limit", {
        p_shop_id: shopId,
        p_customer_id: b.customer_id,
        p_credit_limit_paisa: b.credit_limit_paisa,
      }));
    }
    case "price": {
      const b = await parseJson(req, Price);
      return ok(await rpc(sb, "update_product_price", { p_shop_id: shopId, p_product_id: b.product_id, p_unit_price_paisa: b.unit_price_paisa }));
    }
    case "alias": {
      const b = await parseJson(req, Alias);
      await rpc(sb, "add_alias", { p_shop_id: shopId, p_product_id: b.product_id, p_alias: b.alias });
      return ok({ ok: true });
    }
    default:
      throw new ApiError("BAD_REQUEST", `Unknown resource "${resource}"`, undefined, 404);
  }
});
