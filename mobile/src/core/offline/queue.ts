import type { FeedTx, PaymentProposal, SaleProposal, TurnTrace } from "@/core/api/types";
import { deleteQueueFile, getMobileDb } from "./db";

export type QueuedTurnStatus = "pending" | "review" | "failed";
export type QueuedTurnKind = "audio" | "text";
export type ReviewKind = "sale" | "payment" | "reversal";

export interface QueuedTurn {
  key: string;
  shop_id: string;
  kind: QueuedTurnKind;
  file_uri?: string | null;
  mime?: string | null;
  text?: string | null;
  created_at: number;
  attempts: number;
  status: QueuedTurnStatus;
  last_error?: string | null;
  review_kind?: ReviewKind | null;
  proposal?: SaleProposal | PaymentProposal | null;
  target?: FeedTx | null;
  trace?: TurnTrace | null;
}

export type FlushOutcome =
  | "done"
  | "review"
  | { status: "review"; patch?: Partial<QueuedTurn> };

export interface QueueRepository {
  insert(item: QueuedTurn): Promise<void>;
  list(shopId?: string): Promise<QueuedTurn[]>;
  update(key: string, patch: Partial<QueuedTurn>): Promise<void>;
  remove(key: string): Promise<void>;
}

interface SqlitePendingRow {
  key: string;
  shop_id: string;
  kind: string;
  file_uri: string | null;
  mime: string | null;
  text: string | null;
  created_at: number;
  attempts: number;
  status: string;
  last_error: string | null;
  review_kind: string | null;
  proposal_json: string | null;
  target_json: string | null;
  trace_json: string | null;
}

function fromRow(r: SqlitePendingRow): QueuedTurn {
  return {
    key: r.key,
    shop_id: r.shop_id,
    kind: r.kind === "audio" ? "audio" : "text",
    file_uri: r.file_uri,
    mime: r.mime,
    text: r.text,
    created_at: r.created_at,
    attempts: r.attempts,
    status: r.status === "review" || r.status === "failed" ? r.status : "pending",
    last_error: r.last_error,
    review_kind: (r.review_kind as ReviewKind | null) ?? null,
    proposal: r.proposal_json ? (JSON.parse(r.proposal_json) as SaleProposal | PaymentProposal) : null,
    target: r.target_json ? (JSON.parse(r.target_json) as FeedTx) : null,
    trace: r.trace_json ? (JSON.parse(r.trace_json) as TurnTrace) : null,
  };
}

export const sqliteQueueRepo: QueueRepository = {
  async insert(item) {
    getMobileDb().runSync(
      `INSERT OR REPLACE INTO pending_turns
       (key, shop_id, kind, file_uri, mime, text, created_at, attempts, status, last_error, review_kind, proposal_json, target_json, trace_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.key,
        item.shop_id,
        item.kind,
        item.file_uri ?? null,
        item.mime ?? null,
        item.text ?? null,
        item.created_at,
        item.attempts,
        item.status,
        item.last_error ?? null,
        item.review_kind ?? null,
        item.proposal ? JSON.stringify(item.proposal) : null,
        item.target ? JSON.stringify(item.target) : null,
        item.trace ? JSON.stringify(item.trace) : null,
      ],
    );
  },

  async list(shopId) {
    const db = getMobileDb();
    const rows = shopId
      ? db.getAllSync<SqlitePendingRow>("SELECT * FROM pending_turns WHERE shop_id = ? ORDER BY created_at ASC", [shopId])
      : db.getAllSync<SqlitePendingRow>("SELECT * FROM pending_turns ORDER BY created_at ASC");
    return rows.map(fromRow);
  },

  async update(key, patch) {
    const db = getMobileDb();
    const current = db.getFirstSync<SqlitePendingRow>("SELECT * FROM pending_turns WHERE key = ?", [key]);
    if (!current) return;
    const merged: QueuedTurn = { ...fromRow(current), ...patch };
    await this.insert(merged);
  },

  async remove(key) {
    const db = getMobileDb();
    const current = db.getFirstSync<SqlitePendingRow>("SELECT file_uri FROM pending_turns WHERE key = ?", [key]);
    db.runSync("DELETE FROM pending_turns WHERE key = ?", [key]);
    if (current?.file_uri) deleteQueueFile(current.file_uri);
  },
};

export const MAX_QUEUE_ATTEMPTS = 5;

export function createQueueService(repo: QueueRepository = sqliteQueueRepo) {
  return {
    async enqueue(item: {
      key: string;
      shop_id: string;
      kind: QueuedTurnKind;
      file_uri?: string | null;
      mime?: string | null;
      text?: string | null;
    }): Promise<QueuedTurn> {
      const record: QueuedTurn = {
        key: item.key,
        shop_id: item.shop_id,
        kind: item.kind,
        file_uri: item.file_uri ?? null,
        mime: item.mime ?? null,
        text: item.text ?? null,
        created_at: Date.now(),
        attempts: 0,
        status: "pending",
      };
      await repo.insert(record);
      return record;
    },

    list(shopId?: string) {
      return repo.list(shopId);
    },

    async pendingCount(shopId?: string): Promise<number> {
      const items = await repo.list(shopId);
      return items.filter((q) => q.status !== "failed").length;
    },

    async reviewInbox(shopId?: string): Promise<QueuedTurn[]> {
      const items = await repo.list(shopId);
      return items.filter((q) => q.status === "review");
    },

    dequeue(key: string) {
      return repo.remove(key);
    },

    async retryFailed(key: string) {
      await repo.update(key, { status: "pending", attempts: 0, last_error: null });
    },

    async flush(
      shopId: string,
      processTurn: (q: QueuedTurn) => Promise<FlushOutcome>,
    ): Promise<{ done: number; review: number; failed: number }> {
      const out = { done: 0, review: 0, failed: 0 };
      const items = await repo.list(shopId);
      for (const q of items) {
        if (q.status !== "pending") continue;
        try {
          const outcome = await processTurn(q);
          if (outcome === "done") {
            await repo.remove(q.key);
            out.done += 1;
          } else {
            const patch = typeof outcome === "object" && outcome.patch ? outcome.patch : {};
            await repo.update(q.key, { ...patch, status: "review", last_error: null });
            out.review += 1;
          }
        } catch (err) {
          const attempts = q.attempts + 1;
          const nextStatus: QueuedTurnStatus = attempts >= MAX_QUEUE_ATTEMPTS ? "failed" : "pending";
          await repo.update(q.key, {
            attempts,
            status: nextStatus,
            last_error: err instanceof Error ? err.message : String(err),
          });
          out.failed += 1;
          break; // Maintain strict chronological order across turns.
        }
      }
      return out;
    },
  };
}

export const queueService = createQueueService();
