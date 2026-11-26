"use client";

import { accessToken, browserSupabase, supabaseConfigured } from "./supabase";

export class ClientApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown, public network = false) {
    super(message);
  }
}

let onAuthExpired: (() => void) | null = null;
let onShopForbidden: (() => void) | null = null;
export function registerAuthHandlers(handlers: { onAuthExpired?: () => void; onShopForbidden?: () => void }) {
  onAuthExpired = handlers.onAuthExpired ?? null;
  onShopForbidden = handlers.onShopForbidden ?? null;
}

let simulateOffline = false;
const listeners = new Set<(offline: boolean) => void>();

/** "Simulate Offline" — hidden stage backup: behaves exactly like Wi-Fi OFF for the app. */
export function setSimulateOffline(v: boolean) {
  simulateOffline = v;
  listeners.forEach((l) => l(isOffline()));
}
export function isSimulatedOffline() {
  return simulateOffline;
}
export function isOffline(): boolean {
  return simulateOffline || (typeof navigator !== "undefined" && navigator.onLine === false);
}
export function onOfflineChange(fn: (offline: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let currentShop: string | null = null;
export function setApiShop(id: string | null) {
  currentShop = id;
}

export interface ApiOpts {
  method?: "GET" | "POST";
  json?: unknown;
  form?: FormData;
  auth?: boolean;
  shop?: boolean;
  raw?: boolean;
  timeoutMs?: number;
  _retried?: boolean;
}

export async function api<T>(path: string, opts: ApiOpts = {}): Promise<T> {
  if (isOffline()) throw new ClientApiError("OFFLINE", "You are offline", 0, undefined, true);
  const headers: Record<string, string> = {};
  if (opts.auth !== false) {
    const tok = await accessToken();
    if (tok) headers.authorization = `Bearer ${tok}`;
  }
  if (opts.shop !== false && currentShop) headers["x-shop-id"] = currentShop;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000);
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: ctrl.signal });
  } catch (e) {
    throw new ClientApiError("NETWORK", e instanceof Error ? e.message : "Network error", 0, undefined, true);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && opts.auth !== false && !opts._retried && supabaseConfigured()) {
    try {
      const { data, error } = await browserSupabase().auth.refreshSession();
      if (!error && data.session?.access_token) {
        return api<T>(path, { ...opts, _retried: true });
      }
    } catch {
      /* fall through to AUTH_REQUIRED */
    }
    onAuthExpired?.();
  }
  if (opts.raw) {
    if (!res.ok) throw new ClientApiError("HTTP_" + res.status, res.statusText, res.status);
    return res as unknown as T;
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-json */
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const code = err?.code ?? `HTTP_${res.status}`;
    if (res.status === 401 || code === "AUTH_REQUIRED") onAuthExpired?.();
    if (res.status === 403 && code === "FORBIDDEN") onShopForbidden?.();
    throw new ClientApiError(code, err?.message ?? (text.slice(0, 200) || res.statusText), res.status, err?.details);
  }
  return data as T;
}

export function newKey(prefix = "k"): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${r}`;
}

/** Human copy for canonical error codes (Roman Urdu + English). */
export function friendlyError(e: unknown): string {
  if (!(e instanceof ClientApiError)) return e instanceof Error ? e.message : "Kuch ghalat ho gaya";
  const details = (e.details && typeof e.details === "object" ? e.details : null) as Record<string, unknown> | null;
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
    case "AI_QUOTA_EXCEEDED":
      return "Aaj ki AI limit poori ho gayi — kal dobara try karein";
    case "AI_TIMEOUT":
    case "AI_UNAVAILABLE":
      return "Munshi abhi masroof hai — draft mehfooz hai, 1-tap retry";
    case "AI_REJECTED":
      return "Awaaz process nahi ho saki — neeche type kar dein (Settings → health check)";
    case "AI_NOT_CONFIGURED":
      return "AI set up nahi — typed entry chal rahi hai (AI key missing on server)";
    case "RATE_LIMITED": {
      const sec = typeof details?.retry_after_s === "number" ? details.retry_after_s : typeof details?.retryAfter === "number" ? details.retryAfter : null;
      return sec ? `Bohat tez requests — ${sec}s baad dobara try karein` : "Thori der baad dobara try karein (rate limited)";
    }
    case "TURNSTILE_FAILED":
      return "Human verification fail hui — page refresh kar ke dobara try karein";
    case "ORIGIN_FORBIDDEN":
      return "Request origin ijazat-shuda nahi";
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
      return "Session khatam ho gaya — dobara sign in karein (draft mehfooz hai)";
    case "OFFLINE":
    case "NETWORK":
      return "Offline — IndexedDB mein mehfooz";
    default:
      return e.message;
  }
}
