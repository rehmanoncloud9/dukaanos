import { ApiError, handle, ok } from "@/lib/api/http";
import { enforceRateLimit, getClientIp } from "@/lib/server/ratelimit";
import { adminClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * Public read-only revocation check for /verify (never required for offline Ed25519 verification).
 * GET /api/reports/passport-status?sid=<8hex>&pn=<nonce>
 */
export const GET = handle(async (req: Request) => {
  await enforceRateLimit(`passport_status:${getClientIp(req)}`, 120, "1 minute");
  const url = new URL(req.url);
  const sid = (url.searchParams.get("sid") ?? "").toLowerCase().trim();
  const pnRaw = url.searchParams.get("pn");
  if (!/^[0-9a-f]{8}$/.test(sid)) throw new ApiError("BAD_REQUEST", "Invalid shop prefix");
  const pn = pnRaw === null ? null : Number(pnRaw);
  if (pn !== null && (!Number.isInteger(pn) || pn < 0)) throw new ApiError("BAD_REQUEST", "Invalid nonce");

  const start = `${sid}-0000-0000-0000-000000000000`;
  const end = `${sid}-ffff-ffff-ffff-ffffffffffff`;
  const { data, error } = await adminClient()
    .from("shops")
    .select("passport_nonce")
    .gte("id", start)
    .lte("id", end)
    .limit(1)
    .maybeSingle();

  if (error || !data) return ok({ found: false, revoked: false });
  const current = Number((data as { passport_nonce: number }).passport_nonce ?? 0);
  return ok({ found: true, current_nonce: current, revoked: pn !== null && current !== pn });
});
