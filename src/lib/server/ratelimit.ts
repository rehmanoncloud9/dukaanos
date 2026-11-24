import { ApiError } from "@/lib/api/http";
import { adminClient, rpc } from "@/lib/supabase/server";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retry_after: number;
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "local"
  );
}

/**
 * Persistent Postgres-backed rate limiter (service-role only).
 * Throws 429 RATE_LIMITED when the bucket exceeds `max` within `windowInterval`.
 */
export async function enforceRateLimit(bucket: string, max: number, windowInterval: string): Promise<RateLimitResult> {
  const admin = adminClient();
  const res = await rpc<RateLimitResult>(admin, "consume_rate_limit", {
    p_bucket: bucket,
    p_max: max,
    p_window: windowInterval,
  });
  if (!res.allowed) {
    throw new ApiError(
      "RATE_LIMITED",
      "Too many requests — please try again shortly",
      { retry_after: res.retry_after },
    );
  }
  return res;
}
