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

/** Human copy for canonical error codes (100% Urdu script). */
export function friendlyError(e: unknown): string {
  if (!(e instanceof ClientApiError)) return e instanceof Error ? "کچھ غلط ہو گیا، دوبارہ کوشش کریں" : "کچھ غلط ہو گیا";
  const details = (e.details && typeof e.details === "object" ? e.details : null) as Record<string, unknown> | null;
  switch (e.code) {
    case "UDHAAR_REQUIRES_CUSTOMER":
      return "ادھار کے لیے پہلے گاہک منتخب کریں";
    case "CREDIT_LIMIT_EXCEEDED":
      return "گاہک کی ادھار حد پوری ہو چکی ہے — وصولی کریں یا حد بڑھائیں";
    case "AUDIO_TOO_LARGE":
      return "آواز کی کلپ بہت لمبی ہے";
    case "PAYLOAD_TOO_LARGE":
    case "IMAGE_TOO_LARGE":
      return "تصویر یا فائل بہت بڑی ہے — چھوٹی تصویر بھیجیں";
    case "AI_QUOTA_EXCEEDED":
      return "آج کی اے آئی حد پوری ہو گئی — کل دوبارہ کوشش کریں";
    case "AI_TIMEOUT":
    case "AI_UNAVAILABLE":
      return "منشی ابھی مصروف ہے — اندراج محفوظ ہے، دوبارہ کوشش کریں";
    case "AI_REJECTED":
      return "آواز سمجھ نہیں آ سکی — نیچے ٹائپ کر دیں";
    case "AI_NOT_CONFIGURED":
      return "آواز کی سہولت ابھی تیار نہیں — تحریری اندراج محفوظ ہے";
    case "RATE_LIMITED": {
      const sec = typeof details?.retry_after_s === "number" ? details.retry_after_s : typeof details?.retryAfter === "number" ? details.retryAfter : null;
      return sec ? `بہت تیز درخواستیں — ${sec} سیکنڈ بعد کوشش کریں` : "تھوڑی دیر بعد دوبارہ کوشش کریں";
    }
    case "TURNSTILE_FAILED":
      return "تصدیق ناکام ہوئی — صفحہ دوبارہ لوڈ کریں";
    case "ORIGIN_FORBIDDEN":
      return "درخواست کی اجازت نہیں";
    case "NEGATIVE_STOCK":
      return "گودام میں مال کم ہے — گودام میں اسٹاک بڑھائیں";
    case "MATH_MISMATCH":
      return "اشیاء کا کل اور بل آپس میں نہیں مل رہے";
    case "CHAIN_BROKEN":
      return "حساب کا ریکارڈ تصدیق نہیں ہو سکا";
    case "REPLAY_DEDUPLICATED":
      return "یہ اندراج پہلے محفوظ ہو چکا ہے، دوبارہ نہیں لکھا گیا";
    case "ALREADY_REVERSED":
      return "یہ اندراج پہلے ہی واپس ہو چکا ہے";
    case "FORBIDDEN":
      return "اس دکان تک رسائی نہیں — اپنی دکان منتخب کریں";
    case "AUTH_REQUIRED":
      return "دوبارہ داخل ہوں — آپ کا اندراج فون میں محفوظ ہے";
    case "OFFLINE":
    case "NETWORK":
      return "انٹرنیٹ نہیں — اندراج فون میں محفوظ ہے";
    default:
      return "کام مکمل نہیں ہوا — دوبارہ کوشش کریں";
  }
}
