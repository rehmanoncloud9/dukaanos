import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { z } from "zod";
import type { CommitSaleInput } from "@domain/types";
import { getAccessToken, mobileSupabase, supabaseConfigured } from "@/core/auth/supabase";
import { configStatus } from "@/core/config";
import type {
  AppConfigResponse,
  ChainVerifyResponse,
  CommitResponse,
  CustomerLedgerPage,
  FeedPage,
  MyShop,
  ParchiParseResponse,
  PaymentInput,
  Pulse,
  PurchaseInput,
  ReverseInput,
  SandboxCredentials,
  ShopState,
  TradeSummaryResponse,
  TurnResponse,
  XRayDoc,
} from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter?: number;
  readonly details?: unknown;
  readonly network: boolean;

  constructor(code: string, status: number, message: string, opts?: { retryAfter?: number; details?: unknown; network?: boolean }) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfter = opts?.retryAfter;
    this.details = opts?.details;
    this.network = Boolean(opts?.network);
  }
}

const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

let currentShopId: string | null = null;
let offlineCheck: () => boolean = () => false;
let onAuthExpiredHandler: (() => void) | null = null;
let onShopForbiddenHandler: (() => void) | null = null;

export function setApiShopId(shopId: string | null) {
  currentShopId = shopId;
}

export function getApiShopId(): string | null {
  return currentShopId;
}

export function setApiOfflineDetector(fn: () => boolean) {
  offlineCheck = fn;
}

export function registerApiAuthHandlers(handlers: { onAuthExpired?: () => void; onShopForbidden?: () => void }) {
  onAuthExpiredHandler = handlers.onAuthExpired ?? null;
  onShopForbiddenHandler = handlers.onShopForbidden ?? null;
}

export function newIdempotencyKey(prefix = "m"): string {
  return `${prefix}-${Crypto.randomUUID()}`;
}

function clientHeader(): string {
  const version = Application.nativeApplicationVersion ?? "1.0.0";
  return `dukaanos-mobile/${version} (${Platform.OS})`;
}

export interface RequestOptions {
  method?: "GET" | "POST";
  json?: unknown;
  form?: FormData;
  auth?: boolean;
  shop?: boolean;
  shopId?: string | null;
  timeoutMs?: number;
  rawBytes?: boolean;
  _retried?: boolean;
}

function extractRetryAfter(details: unknown, res: Response): number | undefined {
  if (details && typeof details === "object") {
    const rec = details as Record<string, unknown>;
    if (typeof rec.retry_after_s === "number") return rec.retry_after_s;
    if (typeof rec.retryAfter === "number") return rec.retryAfter;
    if (typeof rec.retry_after === "number") return rec.retry_after;
  }
  const header = res.headers.get("retry-after");
  if (header && /^\d+$/.test(header.trim())) return Number(header.trim());
  return undefined;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (offlineCheck()) {
    throw new ApiError("OFFLINE", 0, "Device is offline", { network: true });
  }
  const base = configStatus.config?.apiUrl;
  if (!base) {
    throw new ApiError("SERVER_MISCONFIGURED", 0, "EXPO_PUBLIC_API_URL is not configured");
  }

  const headers: Record<string, string> = {
    "x-client": clientHeader(),
  };

  if (opts.auth !== false) {
    const token = await getAccessToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }

  const targetShop = opts.shopId !== undefined ? opts.shopId : currentShopId;
  if (opts.shop !== false && targetShop) {
    headers["x-shop-id"] = targetShop;
  }

  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  const method = opts.method ?? (body ? "POST" : "GET");
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    throw new ApiError(
      isAbort ? "AI_TIMEOUT" : "NETWORK",
      0,
      isAbort ? "Request timed out" : err instanceof Error ? err.message : "Network error",
      { network: !isAbort },
    );
  } finally {
    clearTimeout(timer);
  }

  // Never retry writes automatically — only refresh once on 401 and replay the same request
  // (writes remain safe because callers attach a deterministic idempotency_key).
  if (res.status === 401 && opts.auth !== false && !opts._retried && supabaseConfigured()) {
    try {
      const { data, error } = await mobileSupabase().auth.refreshSession();
      if (!error && data.session?.access_token) {
        return request<T>(path, { ...opts, _retried: true });
      }
    } catch {
      // Fall through to AUTH_REQUIRED handling below.
    }
  }

  if (opts.rawBytes) {
    if (!res.ok) {
      throw new ApiError(`HTTP_${res.status}`, res.status, res.statusText || `HTTP ${res.status}`);
    }
    return (await res.arrayBuffer()) as unknown as T;
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const env = ErrorEnvelopeSchema.safeParse(parsed);
    const code = env.success ? env.data.error.code : `HTTP_${res.status}`;
    const msg = env.success ? env.data.error.message : text.slice(0, 200) || res.statusText || `HTTP ${res.status}`;
    const details = env.success ? env.data.error.details : undefined;
    const retryAfter = extractRetryAfter(details, res);
    if (res.status === 401 || code === "AUTH_REQUIRED") onAuthExpiredHandler?.();
    if (res.status === 403 && code === "FORBIDDEN") onShopForbiddenHandler?.();
    throw new ApiError(code, res.status, msg, { retryAfter, details });
  }

  return parsed as T;
}

export function friendlyApiError(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : "Kuch ghalat ho gaya";
  switch (e.code) {
    case "UDHAAR_REQUIRES_CUSTOMER":
      return "Udhaar ke liye customer chunein — pick a customer first";
    case "CREDIT_LIMIT_EXCEEDED":
      return "Customer ki udhaar limit poori ho chuki hai — wasooli ya limit barhaein";
    case "AUDIO_TOO_LARGE":
      return "Clip bohat lambi hai (max 4 MB)";
    case "PAYLOAD_TOO_LARGE":
    case "IMAGE_TOO_LARGE":
      return "File bohat badi hai — chhoti photo ya clip bhejein";
    case "UNSUPPORTED_MEDIA":
      return "Audio ya photo format support nahi hai";
    case "AI_QUOTA_EXCEEDED":
      return "Aaj ki AI limit poori ho gayi — kal dobara try karein";
    case "AI_TIMEOUT":
    case "AI_UNAVAILABLE":
      return "Munshi abhi masroof hai — draft mehfooz hai, retry karein";
    case "RATE_LIMITED":
      return e.retryAfter ? `Bohat tez requests — ${e.retryAfter}s baad dobara try karein` : "Thori der baad dobara try karein";
    case "TURNSTILE_FAILED":
      return "Human verification fail hui — dobara try karein";
    case "NEGATIVE_STOCK":
      return "Stock kam hai — Maal tab mein restock karein";
    case "MATH_MISMATCH":
      return "Items ka total aur bill match nahi kar raha";
    case "CHAIN_BROKEN":
      return "SHA-256 ledger chain verification fail hui";
    case "REPLAY_DEDUPLICATED":
      return "Yeh entry pehle hi save ho chuki hai (0 duplicates)";
    case "ALREADY_REVERSED":
      return "Yeh entry pehle hi wapas ho chuki hai";
    case "FORBIDDEN":
      return "Is dukaan ki ijazat nahi — dobara shop chunein";
    case "AUTH_REQUIRED":
      return "Session khatam ho gaya — dobara sign in karein";
    case "OFFLINE":
    case "NETWORK":
      return "Offline — queue mein mehfooz";
    default:
      return e.message;
  }
}

export const apiClient = {
  turn(input: { audioUri?: string; mimeType?: string; text?: string }, shopId?: string) {
    if (input.audioUri) {
      const form = new FormData();
      const mime = input.mimeType ?? "audio/mp4";
      const ext = mime.includes("webm") ? "webm" : mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : "m4a";
      form.append("audio", {
        uri: input.audioUri,
        name: `clip.${ext}`,
        type: mime,
      } as unknown as Blob);
      if (input.text?.trim()) form.append("text", input.text.trim());
      return request<TurnResponse>("/api/munshi/turn", { form, timeoutMs: 60_000, shopId });
    }
    return request<TurnResponse>("/api/munshi/turn", {
      json: { text: input.text?.trim() ?? "" },
      timeoutMs: 60_000,
      shopId,
    });
  },

  commit(payload: CommitSaleInput, shopId?: string) {
    return request<CommitResponse>("/api/transactions/commit", { json: payload, shopId });
  },

  reverse(payload: ReverseInput, shopId?: string) {
    return request<CommitResponse>("/api/transactions/reverse", { json: payload, shopId });
  },

  payment(payload: PaymentInput, shopId?: string) {
    return request<CommitResponse>("/api/transactions/payment", { json: payload, shopId });
  },

  purchase(payload: PurchaseInput, shopId?: string) {
    return request<CommitResponse>("/api/transactions/purchase", { json: payload, shopId });
  },

  parchiParse(fileUri: string, mimeType = "image/jpeg", shopId?: string) {
    const form = new FormData();
    const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
    form.append("image", {
      uri: fileUri,
      name: `parchi.${ext}`,
      type: mimeType,
    } as unknown as Blob);
    return request<ParchiParseResponse>("/api/parchi/parse", { form, timeoutMs: 60_000, shopId });
  },

  shopState(shopId?: string) {
    return request<ShopState>("/api/shop/state", { shopId });
  },

  feed(beforeSeq?: number | null, limit = 40, shopId?: string) {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (beforeSeq !== undefined && beforeSeq !== null) qs.set("before_seq", String(beforeSeq));
    return request<FeedPage>(`/api/shop/feed?${qs.toString()}`, { shopId });
  },

  customerLedger(customerId: string, beforeSeq?: number | null, limit = 50, shopId?: string) {
    const qs = new URLSearchParams({ customer_id: customerId, limit: String(limit) });
    if (beforeSeq !== undefined && beforeSeq !== null) qs.set("before_seq", String(beforeSeq));
    return request<CustomerLedgerPage>(`/api/shop/customer-ledger?${qs.toString()}`, { shopId });
  },

  pulse(shopId?: string) {
    return request<Pulse>("/api/shop/pulse", { shopId });
  },

  chain(shopId?: string) {
    return request<ChainVerifyResponse>("/api/shop/chain", { shopId });
  },

  xray(txId: string, shopId?: string) {
    return request<XRayDoc>(`/api/shop/xray?id=${encodeURIComponent(txId)}`, { shopId });
  },

  tradeSummary(days = 30, shopId?: string) {
    return request<TradeSummaryResponse>(`/api/reports/trade-summary?days=${days}`, { shopId });
  },

  addCustomer(body: { name: string; phone?: string; role_tag?: string }, shopId?: string) {
    return request<{ id: string }>("/api/shop/customer", { json: body, shopId });
  },

  updateCustomer(body: { customer_id: string; phone?: string; role_tag?: string }, shopId?: string) {
    return request<{ ok: boolean }>("/api/shop/customer-update", { json: body, shopId });
  },

  updateCustomerCreditLimit(body: { customer_id: string; credit_limit_paisa: number | null }, shopId?: string) {
    return request<{ ok: boolean }>("/api/shop/customer-credit-limit", { json: body, shopId });
  },

  updatePrice(body: { product_id: string; unit_price_paisa: number }, shopId?: string) {
    return request<{ ok: boolean }>("/api/shop/price", { json: body, shopId });
  },

  addAlias(body: { product_id: string; alias: string }, shopId?: string) {
    return request<{ ok: boolean }>("/api/shop/alias", { json: body, shopId });
  },

  demoSandbox(turnstileToken?: string) {
    return request<SandboxCredentials>("/api/demo/sandbox", {
      json: turnstileToken ? { turnstile_token: turnstileToken } : {},
      auth: false,
      shop: false,
      timeoutMs: 60_000,
    });
  },

  demoReset(shopId: string, secret?: string) {
    return request<{ ok: boolean; via: string; ms: number }>("/api/demo/reset", {
      json: { shop_id: shopId, ...(secret ? { secret } : {}) },
      shopId,
      timeoutMs: 120_000,
    });
  },

  demoTamper(shopId: string, secret?: string) {
    return request<{ ok: boolean; via: string; result: { tampered_seq?: number } }>("/api/demo/tamper", {
      json: { shop_id: shopId, ...(secret ? { secret } : {}) },
      shopId,
    });
  },

  accountExport() {
    return request<Record<string, unknown>>("/api/account/export", { shop: false });
  },

  accountDelete(password?: string) {
    return request<{ ok: boolean; deleted_shops: number; removed_memberships: number }>("/api/account/delete", {
      json: password ? { password } : {},
      shop: false,
    });
  },

  appConfig() {
    return request<AppConfigResponse>("/api/app-config", { auth: false, shop: false });
  },

  health() {
    return request<{ ok: boolean }>("/api/system/health", { auth: false, shop: false });
  },

  shops() {
    return request<MyShop[]>("/api/system/shops", { shop: false });
  },

  createShop(body: { name: string; owner_name?: string; phone?: string; city?: string }) {
    return request<{ shop_id: string }>("/api/system/shops", { json: body, shop: false });
  },

  tts(text: string, shopId?: string) {
    return request<ArrayBuffer>("/api/system/tts", {
      json: { text },
      rawBytes: true,
      timeoutMs: 8_000,
      shopId,
    });
  },
};
