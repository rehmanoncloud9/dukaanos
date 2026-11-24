import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError, handle, ok } from "@/lib/api/http";
import { requireUser } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { adminClient, rpc, userClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const Body = z.object({ password: z.string().min(1).optional() }).optional();

/**
 * POST /api/account/delete — PDPB + Google Play account deletion.
 * Requires recent auth (JWT issued < 5 min ago) OR password re-entry.
 */
export const POST = handle(async (req: Request) => {
  const { userId, iat } = await requireUser(req);
  await enforceRateLimit(`acct_delete:${userId}`, 5, "1 hour");

  let password: string | undefined;
  try {
    const raw = await req.json();
    const parsed = Body.safeParse(raw);
    if (parsed.success) password = parsed.data?.password;
  } catch {
    // empty body allowed when JWT is recent
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const isRecent = iat !== undefined && nowSec - iat <= 300;

  const admin = adminClient();
  if (!isRecent) {
    if (!password) {
      throw new ApiError("RECENT_AUTH_REQUIRED", "Please re-enter your password or sign in again to delete your account");
    }
    const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(userId);
    const email = userRes?.user?.email;
    if (userErr || !email) {
      throw new ApiError("AUTH_REQUIRED", "Unable to verify account");
    }
    const { error: signInErr } = await userClient("").auth.signInWithPassword({ email, password });
    if (signInErr) {
      throw new ApiError("RECENT_AUTH_REQUIRED", "Incorrect password");
    }
  }

  const userIdHash = createHash("sha256").update(userId).digest("hex");
  const result = await rpc<{ deleted_shops: number; removed_memberships: number }>(
    admin,
    "delete_user_account_data",
    { p_user_id: userId, p_user_id_hash: userIdHash },
  );

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr && !/not found/i.test(delErr.message)) {
    throw new ApiError("INTERNAL", "Failed to delete auth user", delErr.message);
  }

  return ok({ ok: true, ...result });
});
