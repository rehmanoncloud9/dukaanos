import { handle, ok } from "@/lib/api/http";
import { requireUser } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { rpc, userClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * GET /api/account/export — JSON export of all shops the authenticated user belongs to.
 */
export const GET = handle(async (req: Request) => {
  const { userId, token } = await requireUser(req);
  await enforceRateLimit(`acct_export:${userId}`, 10, "1 hour");

  const sb = userClient(token);
  const shops = await rpc<Array<{ id: string }>>(sb, "my_shops", {});
  const exported = await Promise.all(
    shops.map((s) => rpc<Record<string, unknown>>(sb, "export_shop_data", { p_shop_id: s.id })),
  );

  return ok({
    exported_at: new Date().toISOString(),
    shops_count: exported.length,
    shops: exported,
  });
});
