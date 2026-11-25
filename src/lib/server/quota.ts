import { ApiError } from "@/lib/api/http";
import { env } from "@/lib/env";
import { estimateCostPkrMicros } from "@/lib/ai/pricing";
import { adminClient, rpc } from "@/lib/supabase/server";

export type AiKind = "voice" | "parchi" | "qa" | "tts";

export interface TokenReservation {
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
}

interface QuotaResult {
  allowed: boolean;
  remaining: number;
  retry_after: number;
  reason?: string;
}

export interface QuotaLease extends QuotaResult {
  reservation: TokenReservation;
}

const RESERVATION_TOKENS: Record<AiKind, TokenReservation> = {
  voice: { input_tokens: 20_000, output_tokens: 1_024, cost_micros: 0 },
  parchi: { input_tokens: 32_768, output_tokens: 4_096, cost_micros: 0 },
  qa: { input_tokens: 16_384, output_tokens: 1_024, cost_micros: 0 },
  tts: { input_tokens: 1_024, output_tokens: 4_096, cost_micros: 0 },
};

function capForKind(kind: AiKind): number {
  switch (kind) {
    case "voice": return env.aiCapVoice();
    case "parchi": return env.aiCapParchi();
    case "qa": return env.aiCapQa();
    case "tts": return env.aiCapTts();
  }
}

/** Reserve one call and a conservative token allowance before calling Gemini. */
export async function checkQuota(shopId: string, kind: AiKind, model: string): Promise<QuotaLease> {
  const tokenReservation = RESERVATION_TOKENS[kind];
  const reservation = {
    ...tokenReservation,
    cost_micros: estimateCostPkrMicros(
      model,
      { ...tokenReservation, cached_input_tokens: 0 },
      env.aiUsdToPkrRate(),
    ).costPkrMicros,
  };
  const globalCapMicros = Math.round(env.aiGlobalDailyPkrCap() * 1_000_000);
  const res = await rpc<QuotaResult>(adminClient(), "consume_ai_quota", {
    p_shop_id: shopId,
    p_kind: kind,
    p_tokens_in: reservation.input_tokens,
    p_tokens_out: reservation.output_tokens,
    p_shop_cap: capForKind(kind),
    p_global_cap_micros: globalCapMicros,
    p_reservation_cost_micros: reservation.cost_micros,
  });
  if (!res.allowed) {
    throw new ApiError("RATE_LIMITED", "Daily AI usage limit reached — try again tomorrow", {
      retry_after: res.retry_after,
      kind,
      reason: res.reason ?? "CAP_EXCEEDED",
    });
  }
  return { ...res, reservation };
}

/**
 * Settle a reserved call with SDK token metadata. Failed generation releases its
 * estimate with zero actual tokens; telemetry failure leaves the safe reservation.
 */
export async function recordUsage(
  shopId: string,
  kind: AiKind,
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens: number },
  reservation: TokenReservation,
  model: string,
  costMicros: number,
  costBasis: "sdk_usage" | "reservation_upper_bound",
): Promise<void> {
  try {
    await rpc(adminClient(), "record_ai_usage", {
      p_shop_id: shopId,
      p_kind: kind,
      p_tokens_in: Math.max(0, Math.round(usage.input_tokens)),
      p_tokens_out: Math.max(0, Math.round(usage.output_tokens)),
      p_cached_tokens: Math.max(0, Math.round(usage.cached_input_tokens)),
      p_model: model,
      p_reserved_tokens_in: reservation.input_tokens,
      p_reserved_tokens_out: reservation.output_tokens,
      p_reserved_cost_micros: reservation.cost_micros,
      p_est_cost_micros: costMicros,
      p_cost_basis: costBasis,
    });
  } catch (error) {
    // Keep logs free of prompts, media, transcripts, and customer data.
    console.warn("[quota] usage settlement failed", error instanceof Error ? error.name : "unknown");
  }
}

