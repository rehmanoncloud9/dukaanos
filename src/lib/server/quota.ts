import { ApiError } from "@/lib/api/http";
import { env } from "@/lib/env";
import { adminClient, rpc } from "@/lib/supabase/server";

export type AiKind = "voice" | "parchi" | "qa" | "tts";

interface QuotaResult {
  allowed: boolean;
  remaining: number;
  retry_after: number;
  reason?: string;
}

function capForKind(kind: AiKind): number {
  switch (kind) {
    case "voice":
      return env.aiCapVoice();
    case "parchi":
      return env.aiCapParchi();
    case "qa":
      return env.aiCapQa();
    case "tts":
      return env.aiCapTts();
  }
}

/**
 * Checks and reserves 1 call against the shop's daily AI cap and global daily PKR cap.
 * Throws 429 RATE_LIMITED with `retry_after` when exceeded.
 */
export async function checkQuota(shopId: string, kind: AiKind): Promise<QuotaResult> {
  const admin = adminClient();
  const globalCapMicros = Math.round(env.aiGlobalDailyPkrCap() * 1_000_000);
  const res = await rpc<QuotaResult>(admin, "consume_ai_quota", {
    p_shop_id: shopId,
    p_kind: kind,
    p_tokens_in: 0,
    p_tokens_out: 0,
    p_shop_cap: capForKind(kind),
    p_global_cap_micros: globalCapMicros,
  });
  if (!res.allowed) {
    throw new ApiError(
      "RATE_LIMITED",
      "Daily AI usage limit reached — try again tomorrow",
      { retry_after: res.retry_after, kind, reason: res.reason ?? "CAP_EXCEEDED" },
    );
  }
  return res;
}

/**
 * Records token usage and estimated PKR cost after a Gemini call completes.
 * Best-effort: never fails the user request if telemetry logging encounters a transient error.
 */
export async function recordUsage(shopId: string, kind: AiKind, tokensIn: number, tokensOut: number): Promise<void> {
  try {
    const admin = adminClient();
    await rpc(admin, "record_ai_usage", {
      p_shop_id: shopId,
      p_kind: kind,
      p_tokens_in: Math.max(0, Math.round(tokensIn)),
      p_tokens_out: Math.max(0, Math.round(tokensOut)),
    });
  } catch (err) {
    console.warn("[quota] recordUsage failed", err instanceof Error ? err.message : String(err));
  }
}
