import { createQueueService, MAX_QUEUE_ATTEMPTS, type QueueRepository, type QueuedTurn } from "@/core/offline/queue";

function makeMemoryRepo() {
  const rows = new Map<string, QueuedTurn>();
  const repo: QueueRepository = {
    async insert(item) {
      rows.set(item.key, { ...item });
    },
    async list(shopId) {
      const all = Array.from(rows.values()).filter((r) => !shopId || r.shop_id === shopId);
      return all.sort((a, b) => a.created_at - b.created_at);
    },
    async update(key, patch) {
      const existing = rows.get(key);
      if (!existing) return;
      rows.set(key, { ...existing, ...patch });
    },
    async remove(key) {
      rows.delete(key);
    },
  };
  return { rows, repo };
}

describe("offline FIFO turn queue", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("flushes turns in strict chronological order preserving original idempotency keys", async () => {
    const { repo } = makeMemoryRepo();
    const queue = createQueueService(repo);

    let tick = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      tick += 100;
      return tick;
    });

    await queue.enqueue({ key: "turn-first", shop_id: "shop-1", kind: "text", text: "ek kilo cheeni cash" });
    await queue.enqueue({ key: "turn-second", shop_id: "shop-1", kind: "text", text: "Bilal ne 500 jama karwaye" });
    await queue.enqueue({ key: "turn-other-shop", shop_id: "shop-2", kind: "text", text: "other" });

    const seenKeys: string[] = [];
    const res = await queue.flush("shop-1", async (q) => {
      seenKeys.push(q.key);
      if (q.key === "turn-second") {
        return { status: "review", patch: { review_kind: "payment" } };
      }
      return "done";
    });

    expect(seenKeys).toEqual(["turn-first", "turn-second"]);
    expect(res).toEqual({ done: 1, review: 1, failed: 0 });

    const inbox = await queue.reviewInbox("shop-1");
    expect(inbox.map((x) => ({ key: x.key, kind: x.review_kind }))).toEqual([
      { key: "turn-second", kind: "payment" },
    ]);
    expect(await queue.list("shop-2")).toHaveLength(1);
  });

  it("stops flush on first failure, counts attempts, and marks failed after MAX_QUEUE_ATTEMPTS", async () => {
    const { repo } = makeMemoryRepo();
    const queue = createQueueService(repo);

    let tick = 1_700_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      tick += 50;
      return tick;
    });

    await queue.enqueue({ key: "turn-fail", shop_id: "shop-1", kind: "text", text: "2 sabun cash" });
    await queue.enqueue({ key: "turn-blocked", shop_id: "shop-1", kind: "text", text: "1 kilo atta cash" });

    for (let i = 1; i <= MAX_QUEUE_ATTEMPTS; i++) {
      const processed: string[] = [];
      const res = await queue.flush("shop-1", async (q) => {
        processed.push(q.key);
        throw new Error(`network down #${i}`);
      });
      // Must halt before processing turn-blocked so chronological order is never violated.
      expect(processed).toEqual(["turn-fail"]);
      expect(res.failed).toBe(1);
    }

    const items = await queue.list("shop-1");
    const first = items.find((i) => i.key === "turn-fail")!;
    const second = items.find((i) => i.key === "turn-blocked")!;
    expect(first.status).toBe("failed");
    expect(first.attempts).toBe(MAX_QUEUE_ATTEMPTS);
    expect(second.status).toBe("pending");
    expect(second.attempts).toBe(0);
    expect(await queue.pendingCount("shop-1")).toBe(1);

    await queue.retryFailed("turn-fail");
    const afterRetry = (await queue.list("shop-1")).find((i) => i.key === "turn-fail")!;
    expect(afterRetry.status).toBe("pending");
    expect(afterRetry.attempts).toBe(0);
    expect(await queue.pendingCount("shop-1")).toBe(2);
  });
});
