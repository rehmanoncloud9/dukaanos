import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { ApiError } from "@/lib/api/http";
import { env } from "@/lib/env";

let client: GoogleGenAI | null = null;

export function genai(): GoogleGenAI {
  if (!env.geminiKey()) throw new ApiError("AI_UNAVAILABLE", "GEMINI_API_KEY is not configured");
  client ??= new GoogleGenAI({ apiKey: env.geminiKey() });
  return client;
}

export interface ModelCallResult {
  response: GenerateContentResponse;
  model: string;
  latency_ms: number;
  attempts: Array<{ model: string; ok: boolean; error?: string; ms: number }>;
}

function isRetryable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /abort|timeout|429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|500|INTERNAL|deadline|fetch failed|ECONNRESET|not found|404/i.test(msg);
}

/**
 * Call the pinned model with a hard timeout (default 6 s); on timeout/429/5xx fall back to
 * AI_FALLBACK_MODEL. Never fabricates a result — throws AI_UNAVAILABLE / AI_TIMEOUT instead.
 */
export async function generateWithFallback(
  primary: string,
  params: Omit<GenerateContentParameters, "model">,
  timeoutMs = env.aiTimeoutMs(),
): Promise<ModelCallResult> {
  const chain = [primary, env.fallbackModel()].filter((m, i, a) => m && a.indexOf(m) === i);
  const attempts: ModelCallResult["attempts"] = [];
  const t0 = Date.now();
  let lastErr: unknown;
  for (const model of chain) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const ta = Date.now();
    try {
      const response = await genai().models.generateContent({
        ...params,
        model,
        config: { ...(params.config ?? {}), abortSignal: ctrl.signal },
      });
      attempts.push({ model, ok: true, ms: Date.now() - ta });
      return { response, model, latency_ms: Date.now() - t0, attempts };
    } catch (e) {
      lastErr = e;
      attempts.push({ model, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e), ms: Date.now() - ta });
      if (!isRetryable(e)) break;
    } finally {
      clearTimeout(timer);
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const timedOut = /abort|timeout|deadline/i.test(msg);
  throw new ApiError(timedOut ? "AI_TIMEOUT" : /429|RESOURCE_EXHAUSTED/.test(msg) ? "RATE_LIMITED" : "AI_UNAVAILABLE", msg, { attempts });
}

export function responseText(r: GenerateContentResponse): string {
  return r.text ?? "";
}

export function parseModelJson<T>(r: GenerateContentResponse): T {
  const raw = responseText(r).trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError("AI_UNAVAILABLE", "Model returned non-JSON output", { raw: raw.slice(0, 400) });
  }
}

/** Startup/Health: confirm pinned models exist for this key (Dec 1 cutover audit). */
export async function listModelIds(): Promise<string[]> {
  const pager = await genai().models.list({ config: { pageSize: 200 } });
  const ids: string[] = [];
  for await (const m of pager) {
    if (m.name) ids.push(m.name.replace(/^models\//, ""));
  }
  return ids;
}
