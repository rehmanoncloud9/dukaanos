"use client";
/**
 * Offline IndexedDB queue (idb-keyval). Captures audio Blob / typed text + idempotency_key when the
 * network is down, badges "Pending Sync", and flushes sequentially on reconnect with the ORIGINAL key
 * so a retry can never double-post (the RPC dedupes on (shop_id, idempotency_key)).
 */
import { createStore, del, entries, get, set } from "idb-keyval";
import type { FeedTx, PromiseProposal, TurnTrace } from "@/lib/api/contracts";
import type { PaymentProposal, SaleProposal } from "@/lib/domain/types";

export interface QueuedTurn {
  idempotency_key: string;
  shop_id: string;
  kind: "audio" | "text";
  blob?: Blob;
  mime?: string;
  text?: string;
  created_at: number;
  attempts: number;
  status: "pending" | "review" | "failed";
  last_error?: string;
  review_kind?: "sale" | "payment" | "reversal" | "promise";
  proposal?: SaleProposal | PaymentProposal | PromiseProposal;
  target?: FeedTx | null;
  trace?: TurnTrace | null;
}

const pending = typeof indexedDB !== "undefined" ? createStore("dukaanos-queue", "pending") : undefined;
const replays = typeof indexedDB !== "undefined" ? createStore("dukaanos-replays", "clips") : undefined;

export async function enqueue(item: Omit<QueuedTurn, "attempts" | "status" | "created_at">): Promise<void> {
  await set(item.idempotency_key, { ...item, attempts: 0, status: "pending", created_at: Date.now() } satisfies QueuedTurn, pending);
}

export async function listQueue(shopId?: string): Promise<QueuedTurn[]> {
  const all = (await entries<string, QueuedTurn>(pending)).map(([, v]) => v);
  return all.filter((q) => !shopId || q.shop_id === shopId).sort((a, b) => a.created_at - b.created_at);
}

export async function updateQueued(key: string, patch: Partial<QueuedTurn>): Promise<void> {
  const cur = await get<QueuedTurn>(key, pending);
  if (cur) await set(key, { ...cur, ...patch }, pending);
}

export async function dequeue(key: string): Promise<void> {
  await del(key, pending);
}

export async function pendingCount(shopId?: string): Promise<number> {
  return (await listQueue(shopId)).filter((q) => q.status !== "failed").length;
}

export async function reviewCount(shopId?: string): Promise<number> {
  return (await listQueue(shopId)).filter((q) => q.status === "review").length;
}

/** Errors that will fail identically on every retry (bad key, unknown model, unsupported audio). */
export const PERMANENT_ERROR_CODES = ["AI_REJECTED", "AI_NOT_CONFIGURED", "AUDIO_TOO_LARGE", "UNSUPPORTED_MEDIA", "BAD_REQUEST"];

export function isPermanentFailure(e: unknown): boolean {
  const code = e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : null;
  return typeof code === "string" && PERMANENT_ERROR_CODES.includes(code);
}

export type FlushOutcome =
  | "done"
  | "review"
  | { status: "review"; patch?: Partial<QueuedTurn> };

/** Sequential flush. `process` returns "done" (remove), "review" (keep for human) or throws (retry later). */
export async function flushQueue(shopId: string, process: (q: QueuedTurn) => Promise<FlushOutcome>): Promise<{ done: number; review: number; failed: number }> {
  const out = { done: 0, review: 0, failed: 0 };
  for (const q of await listQueue(shopId)) {
    if (q.status !== "pending") continue;
    try {
      const r = await process(q);
      if (r === "done") {
        await dequeue(q.idempotency_key);
        out.done++;
      } else {
        const patch = typeof r === "object" && r.patch ? r.patch : {};
        await updateQueued(q.idempotency_key, { ...patch, status: "review" });
        out.review++;
      }
    } catch (e) {
      const attempts = q.attempts + 1;
      const permanent = isPermanentFailure(e);
      await updateQueued(q.idempotency_key, { attempts, last_error: e instanceof Error ? e.message : String(e), status: permanent || attempts >= 5 ? "failed" : "pending" });
      out.failed++;
      if (permanent) continue; // a rejected clip must not block the rest of the queue
      break; // keep order: stop on first transient failure, retry on next reconnect
    }
  }
  return out;
}

/* ── Real-audio replay library (2 s logo long-press on stage) ── */
export interface ReplayClip {
  id: string;
  blob: Blob;
  mime: string;
  transcript: string;
  created_at: number;
}

export async function saveReplay(clip: ReplayClip): Promise<void> {
  await set(clip.id, clip, replays);
  const all = (await entries<string, ReplayClip>(replays)).map(([, v]) => v).sort((a, b) => b.created_at - a.created_at);
  for (const old of all.slice(12)) await del(old.id, replays);
}

export async function listReplays(): Promise<ReplayClip[]> {
  return (await entries<string, ReplayClip>(replays)).map(([, v]) => v).sort((a, b) => b.created_at - a.created_at);
}
