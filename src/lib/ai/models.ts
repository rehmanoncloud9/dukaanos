import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { ApiError } from "@/lib/api/http";
import { env } from "@/lib/env";
import { checkQuota, recordUsage, type AiKind, type TokenReservation } from "@/lib/server/quota";
import { estimateCostPkrMicros } from "./pricing";

let client: GoogleGenAI | null = null;

export function genai(): GoogleGenAI {
  if (!env.geminiKey()) throw new ApiError("AI_UNAVAILABLE", "GEMINI_API_KEY is not configured");
  client ??= new GoogleGenAI({ apiKey: env.geminiKey() });
  return client;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  available: boolean;
}

export interface ModelCallResult {
  response: GenerateContentResponse;
  model: string;
  latency_ms: number;
  usage: TokenUsage;
  attempts: Array<{ model: string; ok: boolean; error?: string; ms: number }>;
}

export interface ModelCallBilling {
  shopId?: string;
  kind: AiKind;
}

const ZERO_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, available: false };

function safeTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Read SDK usage metadata defensively; missing counts remain zero, never guessed. */
export function tokenUsage(response: GenerateContentResponse): TokenUsage {
  const responseValue: unknown = response;
  if (!responseValue || typeof responseValue !== "object") return { ...ZERO_USAGE };
  const metadata = (responseValue as Record<string, unknown>).usageMetadata;
  if (!metadata || typeof metadata !== "object") return { ...ZERO_USAGE };
  const usage = metadata as Record<string, unknown>;
  const output = safeTokenCount(usage.candidatesTokenCount) + safeTokenCount(usage.thoughtsTokenCount);
  const knownCounts = [usage.promptTokenCount, usage.candidatesTokenCount, usage.thoughtsTokenCount, usage.cachedContentTokenCount, usage.totalCachedTokens, usage.total_cached_tokens];
  const available = knownCounts.some((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  return {
    input_tokens: safeTokenCount(usage.promptTokenCount),
    output_tokens: Number.isSafeInteger(output) ? output : 0,
    cached_input_tokens: safeTokenCount(usage.cachedContentTokenCount ?? usage.totalCachedTokens ?? usage.total_cached_tokens),
    available,
  };
}

function reportedModel(response: GenerateContentResponse, requested: string): string {
  const responseValue: unknown = response;
  if (!responseValue || typeof responseValue !== "object") return requested;
  const value = (responseValue as Record<string, unknown>).modelVersion;
  return typeof value === "string" && value.trim() ? value.replace(/^models\//, "").slice(0, 120) : requested;
}

function apiError(error: unknown, attempts: ModelCallResult["attempts"]): ApiError {
  const message = error instanceof Error ? error.message : String(error);
  const timedOut = /abort|timeout|deadline/i.test(message);
  const limited = /429|RESOURCE_EXHAUSTED/i.test(message);
  const code = timedOut ? "AI_TIMEOUT" : limited ? "RATE_LIMITED" : "AI_UNAVAILABLE";
  const safeMessage = timedOut ? "AI request timed out" : limited ? "AI provider rate limit reached" : "AI request failed";
  return new ApiError(code, safeMessage, { attempts });
}

/**
 * Make one request to the selected, configured Google model. No second model is
 * tried on failure. When a shop is supplied, reserve quota before the call and
 * settle SDK token usage immediately after a response is received.
 */
export async function generateContentOnce(
  model: string,
  params: Omit<GenerateContentParameters, "model">,
  timeoutMs = env.aiTimeoutMs(),
  billing?: ModelCallBilling,
): Promise<ModelCallResult> {
  const started = Date.now();
  let reservation: TokenReservation | null = null;
  if (billing?.shopId) reservation = (await checkQuota(billing.shopId, billing.kind, model)).reservation;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, Math.min(timeoutMs, 60_000)));
  const attempts: ModelCallResult["attempts"] = [];
  const attemptStarted = Date.now();
  try {
    const response = await genai().models.generateContent({
      ...params,
      model,
      config: { ...(params.config ?? {}), abortSignal: controller.signal },
    });
    const actualModel = reportedModel(response, model);
    const usage = tokenUsage(response);
    attempts.push({ model: actualModel, ok: true, ms: Date.now() - attemptStarted });
    if (billing?.shopId && reservation) {
      const estimate = env.aiBillingMode() === "free"
        ? 0
        : usage.available
          ? estimateCostPkrMicros(actualModel, usage, env.aiUsdToPkrRate()).costPkrMicros
          : reservation.cost_micros;
      await recordUsage(
        billing.shopId,
        billing.kind,
        usage,
        reservation,
        actualModel,
        estimate,
        usage.available ? "sdk_usage" : "reservation_upper_bound",
      );
    }
    return { response, model: actualModel, latency_ms: Date.now() - started, usage, attempts };
  } catch (error) {
    attempts.push({ model, ok: false, error: error instanceof Error ? error.name : "unknown", ms: Date.now() - attemptStarted });
    if (billing?.shopId && reservation) {
      await recordUsage(billing.shopId, billing.kind, ZERO_USAGE, reservation, model, reservation.cost_micros, "reservation_upper_bound");
    }
    throw apiError(error, attempts);
  } finally {
    clearTimeout(timeout);
  }
}

export function responseText(response: GenerateContentResponse): string {
  return response.text ?? "";
}

/** Return untrusted model JSON for mandatory caller-side Zod validation. */
export function parseModelJson(response: GenerateContentResponse): unknown {
  const raw = responseText(response).trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError("AI_UNAVAILABLE", "Model returned non-JSON output", { output_length: raw.length });
  }
}

/** Startup/health probe for the two explicitly configured production models. */
export async function listModelIds(): Promise<string[]> {
  const pager = await genai().models.list({ config: { pageSize: 200 } });
  const ids: string[] = [];
  for await (const model of pager) if (model.name) ids.push(model.name.replace(/^models\//, ""));
  return ids;
}
