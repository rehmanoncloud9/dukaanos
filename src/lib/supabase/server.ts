import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiError, bearer, fromDbError, shopIdFrom } from "@/lib/api/http";
import { env } from "@/lib/env";

function assertConfigured() {
  if (!env.supabaseUrl() || !env.supabaseAnonKey()) {
    throw new ApiError("SERVER_MISCONFIGURED", "Supabase URL / anon key missing in .env.local");
  }
}

/** A client that acts AS the signed-in user: RLS + is_shop_member apply inside Postgres. */
export function userClient(token: string): SupabaseClient {
  assertConfigured();
  return createClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Service-role client — server only, used for demo provisioning/reset. Never sent to the browser. */
export function adminClient(): SupabaseClient {
  assertConfigured();
  if (!env.supabaseServiceKey()) throw new ApiError("SERVER_MISCONFIGURED", "SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function rpc<T = unknown>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as T;
}

/** Common preamble for authenticated, shop-scoped routes. */
export function shopContext(req: Request) {
  const token = bearer(req);
  const shopId = shopIdFrom(req);
  const sb = userClient(token);
  return { token, shopId, sb };
}
