"use client";

import { accessToken } from "./supabase";

export class ClientApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown, public network = false) {
    super(message);
  }
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
    throw new ClientApiError(err?.code ?? `HTTP_${res.status}`, err?.message ?? (text.slice(0, 200) || res.statusText), res.status, err?.details);
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
  switch (e.code) {
    case "UDHAAR_REQUIRES_CUSTOMER":
      return "Udhaar ke liye customer chunein — pick a customer first";
    case "AUDIO_TOO_LARGE":
      return "Clip bohat lambi hai (max 4 MB)";
    case "AI_TIMEOUT":
    case "AI_UNAVAILABLE":
    case "RATE_LIMITED":
      return "Munshi abhi masroof hai — draft mehfooz hai, 1-tap retry";
    case "ALREADY_REVERSED":
      return "Yeh entry pehle hi wapas ho chuki hai";
    case "FORBIDDEN":
      return "Is dukaan ki ijazat nahi (RLS)";
    case "AUTH_REQUIRED":
      return "Dobara sign in karein";
    case "OFFLINE":
    case "NETWORK":
      return "Offline — IndexedDB mein mehfooz";
    default:
      return e.message;
  }
}
