"use client";
/**
 * Offline IndexedDB queue (idb-keyval). Captures audio Blob / typed text + idempotency_key when the
 * network is down, badges "Pending Sync", and flushes sequentially on reconnect with the ORIGINAL key
 * so a retry can never double-post (the RPC dedupes on (shop_id, idempotency_key)).
 */
import { createStore, del, entries, get, set } from "idb-keyval";
import type { FeedTx, PromiseProposal, ShopState, TurnTrace } from "@/lib/api/contracts";
import type { BaseUnit } from "@/lib/domain/desi-units";
import type { PaymentProposal, SaleProposal } from "@/lib/domain/types";

export interface QueuedTurn {
  idempotency_key: string;
  shop_id: string;
  kind: "audio" | "text";
  blob?: Blob;
  mime?: string;
  text?: string;
  ambient?: boolean;
  created_at: number;
  seq_local?: number;
  attempts: number;
  status: "pending" | "review" | "failed";
  last_error?: string;
  review_kind?: "sale" | "payment" | "reversal" | "promise";
  proposal?: SaleProposal | PaymentProposal | PromiseProposal;
  target?: FeedTx | null;
  trace?: TurnTrace | null;
}

const pending = typeof indexedDB !== "undefined" ? createStore("dukaanos-queue", "pending") : undefined;
const commits = typeof indexedDB !== "undefined" ? createStore("dukaanos-commits", "commits") : undefined;
const replays = typeof indexedDB !== "undefined" ? createStore("dukaanos-replays", "clips") : undefined;

let localSeqCounter = 0;
let sequenceDbPromise: Promise<IDBDatabase | null> | null = null;

function openSequenceDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (sequenceDbPromise) return sequenceDbPromise;
  sequenceDbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open("dukaanos-operation-order", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("sequence")) request.result.createObjectStore("sequence");
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return sequenceDbPromise;
}

async function nextLocalSequence(): Promise<number> {
  const db = await openSequenceDb();
  if (!db) {
    localSeqCounter = Math.max(Date.now() * 1000, localSeqCounter + 1);
    return localSeqCounter;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction("sequence", "readwrite");
      const store = tx.objectStore("sequence");
      const request = store.get("counter");
      let next = 0;
      request.onsuccess = () => {
        const previous = typeof request.result === "number" ? request.result : 0;
        next = Math.max(Date.now() * 1000, previous + 1);
        store.put(next, "counter");
      };
      tx.oncomplete = () => resolve(next);
      tx.onerror = () => {
        localSeqCounter = Math.max(Date.now() * 1000, localSeqCounter + 1);
        resolve(localSeqCounter);
      };
      tx.onabort = () => {
        localSeqCounter = Math.max(Date.now() * 1000, localSeqCounter + 1);
        resolve(localSeqCounter);
      };
    } catch {
      localSeqCounter = Math.max(Date.now() * 1000, localSeqCounter + 1);
      resolve(localSeqCounter);
    }
  });
}

export async function enqueue(item: Omit<QueuedTurn, "attempts" | "status" | "created_at" | "seq_local">): Promise<void> {
  const now = Date.now();
  const seq_local = await nextLocalSequence();
  await set(item.idempotency_key, { ...item, attempts: 0, status: "pending", created_at: now, seq_local } satisfies QueuedTurn, pending);
}

export async function listQueue(shopId?: string): Promise<QueuedTurn[]> {
  const all = (await entries<string, QueuedTurn>(pending)).map(([, v]) => v);
  return all
    .filter((q) => !shopId || q.shop_id === shopId)
    .sort((a, b) => (a.seq_local ?? a.created_at * 1000) - (b.seq_local ?? b.created_at * 1000));
}

export async function updateQueued(key: string, patch: Partial<QueuedTurn>): Promise<void> {
  const cur = await get<QueuedTurn>(key, pending);
  if (cur) await set(key, { ...cur, ...patch }, pending);
}

/** Retry a failed turn in place so it keeps its original FIFO position and idempotency key. */
export async function resetQueuedTurnForRetry(key: string): Promise<void> {
  const cur = await get<QueuedTurn>(key, pending);
  if (cur) await set(key, { ...cur, status: "pending", attempts: 0, last_error: undefined }, pending);
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

/** Conflict codes where remote state diverged and the record must be retained safely for review without overwriting history. */
export const CONFLICT_ERROR_CODES = ["ALREADY_REVERSED", "UDHAAR_REQUIRES_CUSTOMER", "CREDIT_LIMIT_EXCEEDED", "MATH_MISMATCH", "CHAIN_BROKEN"];

export function isPermanentFailure(e: unknown): boolean {
  const code = e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : null;
  return typeof code === "string" && (PERMANENT_ERROR_CODES.includes(code) || CONFLICT_ERROR_CODES.includes(code));
}

export function isConflictFailure(e: unknown): boolean {
  const code = e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : null;
  return typeof code === "string" && CONFLICT_ERROR_CODES.includes(code);
}

export type FlushOutcome =
  | "done"
  | "review"
  | { status: "review"; patch?: Partial<QueuedTurn> };

/** Sequential flush. `process` returns "done" (remove), "review" (keep for human) or throws (retry later). */
export async function flushQueue(shopId: string, process: (q: QueuedTurn) => Promise<FlushOutcome>): Promise<{ done: number; review: number; failed: number }> {
  const out = { done: 0, review: 0, failed: 0 };
  for (const q of await listQueue(shopId)) {
    if (q.status !== "pending") break;
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
      // Keep later writes behind the failed operation until the owner retries or discards it.
      break;
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

/* ── Offline-safe FIFO commit queue (never computes seq/entry_hash offline) ── */
export interface OptimisticDelta {
  type: "sale" | "payment" | "purchase" | "reversal";
  customer_id?: string | null;
  customer_name?: string | null;
  supplier_name?: string | null;
  total_paisa: number;
  cash_paid_paisa: number;
  credit_paisa: number;
  discount_paisa?: number;
  lines?: Array<{
    product_id: string | null;
    name: string;
    qty_base_units: number;
    base_unit: BaseUnit;
    line_total_paisa: number;
    value_first: boolean;
  }>;
  reversed_transaction_id?: string | null;
  label: string;
}

export interface QueuedCommit {
  idempotency_key: string;
  shop_id: string;
  endpoint: string;
  payload: Record<string, unknown>;
  optimistic: OptimisticDelta;
  created_at: number;
  seq_local?: number;
  attempts: number;
  status: "pending" | "failed" | "conflict";
  last_error?: string;
  conflict_reason?: string;
}

export async function enqueueCommit(item: Omit<QueuedCommit, "attempts" | "status" | "created_at" | "seq_local">): Promise<void> {
  if (!commits) return;
  const now = Date.now();
  const seq_local = await nextLocalSequence();
  await set(item.idempotency_key, { ...item, attempts: 0, status: "pending", created_at: now, seq_local } satisfies QueuedCommit, commits);
}

export async function listCommits(shopId?: string): Promise<QueuedCommit[]> {
  if (!commits) return [];
  const all = (await entries<string, QueuedCommit>(commits)).map(([, v]) => v);
  return all
    .filter((c) => !shopId || c.shop_id === shopId)
    .sort((a, b) => (a.seq_local ?? a.created_at * 1000) - (b.seq_local ?? b.created_at * 1000));
}

export async function dequeueCommit(key: string): Promise<void> {
  if (!commits) return;
  await del(key, commits);
}

export async function resetCommitForRetry(key: string): Promise<void> {
  if (!commits) return;
  const cur = await get<QueuedCommit>(key, commits);
  if (cur) await set(key, { ...cur, status: "pending", attempts: 0, last_error: undefined } satisfies QueuedCommit, commits);
}

/** Strict FIFO flush of queued commits. Preserves original idempotency_key so retries cannot double-post. */
export async function flushCommits(
  shopId: string,
  send: (c: QueuedCommit) => Promise<unknown>,
): Promise<{ done: number; failed: number }> {
  const out = { done: 0, failed: 0 };
  for (const c of await listCommits(shopId)) {
    if (c.status !== "pending") break;
    try {
      await send(c);
      await dequeueCommit(c.idempotency_key);
      out.done++;
    } catch (e) {
      const attempts = c.attempts + 1;
      const permanent = isPermanentFailure(e);
      const conflict = isConflictFailure(e);
      if (commits) {
        await set(
          c.idempotency_key,
          {
            ...c,
            attempts,
            last_error: e instanceof Error ? e.message : String(e),
            conflict_reason: conflict ? (e instanceof Error ? e.message : String(e)) : undefined,
            status: conflict ? "conflict" : permanent || attempts >= 8 ? "failed" : "pending",
          } satisfies QueuedCommit,
          commits,
        );
      }
      out.failed++;
      break; // strict FIFO: the owner retries or discards a failed operation before later writes.
    }
  }
  return out;
}

/**
 * Flush text/audio turns and direct ledger writes in one local FIFO. A turn requiring
 * review blocks later ledger writes until the shopkeeper resolves it.
 */
export async function flushOperations(
  shopId: string,
  processTurn: (turn: QueuedTurn) => Promise<FlushOutcome>,
  sendCommit: (commit: QueuedCommit) => Promise<unknown>,
): Promise<{ done: number; review: number; failed: number }> {
  const out = { done: 0, review: 0, failed: 0 };
  const [turns, commitsForShop] = await Promise.all([listQueue(shopId), listCommits(shopId)]);
  const operations = [
    ...turns.map((turn) => ({ kind: "turn" as const, order: turn.seq_local ?? turn.created_at * 1000, turn })),
    ...commitsForShop.map((commit) => ({ kind: "commit" as const, order: commit.seq_local ?? commit.created_at * 1000, commit })),
  ].sort((a, b) => a.order - b.order || a.kind.localeCompare(b.kind));

  for (const operation of operations) {
    if (operation.kind === "turn") {
      const turn = operation.turn;
      // A failed item or a proposal awaiting owner review holds its place in
      // the FIFO. The owner can retry, review, or discard it from the queue.
      if (turn.status !== "pending") break;
      try {
        const result = await processTurn(turn);
        if (result === "done") {
          await dequeue(turn.idempotency_key);
          out.done++;
          continue;
        }
        const patch = typeof result === "object" && result.patch ? result.patch : {};
        await updateQueued(turn.idempotency_key, { ...patch, status: "review" });
        out.review++;
        break;
      } catch (error) {
        const attempts = turn.attempts + 1;
        const permanent = isPermanentFailure(error);
        await updateQueued(turn.idempotency_key, {
          attempts,
          last_error: error instanceof Error ? error.message : String(error),
          status: permanent || attempts >= 5 ? "failed" : "pending",
        });
        out.failed++;
        break;
      }
    }

    const commit = operation.commit;
    if (commit.status !== "pending") break;
    try {
      await sendCommit(commit);
      await dequeueCommit(commit.idempotency_key);
      out.done++;
    } catch (error) {
      const attempts = commit.attempts + 1;
      const permanent = isPermanentFailure(error);
      const conflict = isConflictFailure(error);
      if (commits) {
        await set(commit.idempotency_key, {
          ...commit,
          attempts,
          last_error: error instanceof Error ? error.message : String(error),
          conflict_reason: conflict ? (error instanceof Error ? error.message : String(error)) : undefined,
          status: conflict ? "conflict" : permanent || attempts >= 8 ? "failed" : "pending",
        } satisfies QueuedCommit, commits);
      }
      out.failed++;
      break;
    }
  }
  return out;
}

/** Pure optimistic overlay over cached ShopState. Never fabricates seq or entry_hash. */
export function applyOptimisticOverlay(state: ShopState | null, pendingCommits: QueuedCommit[]): ShopState | null {
  if (!state || pendingCommits.length === 0) return state;
  const active = pendingCommits.filter((c) => c.status === "pending");
  if (active.length === 0) return state;

  const today = { ...state.today };
  const customers = state.customers.map((c) => ({ ...c }));
  const products = state.products.map((p) => ({ ...p }));
  const pendingFeed: FeedTx[] = [];

  active.forEach((c, idx) => {
    const o = c.optimistic;
    if (o.type === "sale") {
      today.sales_count += 1;
      today.gross_sales_paisa += o.total_paisa;
      today.cash_sales_paisa += o.cash_paid_paisa;
      today.udhaar_paisa += o.credit_paisa;
      today.cash_in_galla_paisa += o.cash_paid_paisa;
      if (o.cash_paid_paisa > 0 && o.credit_paisa === 0) today.cash_sales_count += 1;
      if (o.customer_id && o.customer_name && !customers.some((x) => x.id === o.customer_id)) {
        customers.push({
          id: o.customer_id,
          code: null,
          name: o.customer_name,
          role_tag: null,
          phone: null,
          aliases: [],
          balance_paisa: 0,
          last_paid_at: null,
          oldest_unpaid_at: null,
          days_overdue: null,
        });
      }
      if (o.customer_id && o.credit_paisa !== 0) {
        const cust = customers.find((x) => x.id === o.customer_id);
        if (cust) cust.balance_paisa += o.credit_paisa;
      }
      for (const l of o.lines ?? []) {
        if (!l.product_id) continue;
        const prod = products.find((p) => p.id === l.product_id);
        if (prod) prod.stock_base_units -= l.qty_base_units; // soft negative stock allowed
      }
    } else if (o.type === "payment") {
      today.wasooli_paisa += o.cash_paid_paisa;
      today.cash_in_galla_paisa += o.cash_paid_paisa;
      if (o.customer_id) {
        const cust = customers.find((x) => x.id === o.customer_id);
        if (cust) cust.balance_paisa -= o.cash_paid_paisa;
      }
    } else if (o.type === "purchase") {
      today.purchases_cash_paisa += o.cash_paid_paisa;
      today.cash_in_galla_paisa -= o.cash_paid_paisa;
      for (const l of o.lines ?? []) {
        if (!l.product_id) continue;
        const prod = products.find((p) => p.id === l.product_id);
        if (prod) {
          prod.stock_base_units += l.qty_base_units;
          prod.is_quick_added = false;
        }
      }
    }

    pendingFeed.unshift({
      id: c.idempotency_key,
      seq: -(idx + 1),
      type: o.type,
      customer_id: o.customer_id ?? null,
      customer_name: o.customer_name ?? null,
      customer_role: null,
      supplier_name: o.supplier_name ?? null,
      reversed_transaction_id: o.reversed_transaction_id ?? null,
      subtotal_paisa: o.total_paisa + (o.discount_paisa ?? 0),
      discount_paisa: o.discount_paisa ?? 0,
      total_paisa: o.total_paisa,
      cash_paid_paisa: o.cash_paid_paisa,
      credit_paisa: o.credit_paisa,
      entry_hash: "pending",
      prev_hash: "pending",
      created_at: new Date(c.created_at).toISOString(),
      audit_meta: { pending_sync: true, label: o.label },
      idempotency_key: c.idempotency_key,
      is_reversed: false,
      lines: o.lines ?? [],
    });
  });

  return {
    ...state,
    today,
    customers,
    products,
    feed: [...pendingFeed, ...state.feed],
  };
}
