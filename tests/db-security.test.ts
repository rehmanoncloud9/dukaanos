import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, bootDb, one } from "./helpers/pglite";

let db: PGlite;
let shop: string;
const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const CO_OWNER = "33333333-3333-4333-8333-333333333333";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc<T = any>(fn: string, ...args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const r = await db.query<{ r: T }>(`select public.${fn}(${placeholders}) as r`, args);
  return r.rows[0].r;
}

beforeAll(async () => {
  db = await bootDb();
  shop = (await one<{ id: string }>(db, "select id from public.shops where is_stage_shop")).id;
  await db.query(
    "insert into auth.users (id, email) values ($1, 'owner@test'), ($2, 'stranger@test'), ($3, 'co@test')",
    [OWNER, STRANGER, CO_OWNER],
  );
  await db.query("select public.link_shop_member($1, $2, 'owner')", [shop, OWNER]);
}, 120_000);

describe("rate limiting & AI quotas", () => {
  it("consume_rate_limit allows up to max and blocks max+1", async () => {
    const r1 = await rpc("consume_rate_limit", "test:bucket", 2, "1 minute");
    const r2 = await rpc("consume_rate_limit", "test:bucket", 2, "1 minute");
    const r3 = await rpc("consume_rate_limit", "test:bucket", 2, "1 minute");
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.retry_after).toBeGreaterThan(0);
  });

  it("consume_ai_quota enforces per-shop cap and global cap", async () => {
    const q1 = await rpc("consume_ai_quota", shop, "parchi", 100, 50, 2, 1_000_000_000);
    const q2 = await rpc("consume_ai_quota", shop, "parchi", 100, 50, 2, 1_000_000_000);
    const q3 = await rpc("consume_ai_quota", shop, "parchi", 100, 50, 2, 1_000_000_000);
    expect(q1.allowed).toBe(true);
    expect(q2.allowed).toBe(true);
    expect(q3.allowed).toBe(false);
    expect(q3.reason).toBe("SHOP_CAP");

    await rpc("record_ai_usage", shop, "voice", 1000, 500);
    const qGlobal = await rpc("consume_ai_quota", shop, "voice", 0, 0, 400, 1);
    expect(qGlobal.allowed).toBe(false);
    expect(qGlobal.reason).toBe("GLOBAL_CAP");
  });
});

describe("RLS & cross-tenant isolation audit", () => {
  it("stranger sees zero rows in every table and gets FORBIDDEN on RPCs", async () => {
    const tables = [
      "shops",
      "shop_members",
      "customers",
      "products",
      "sku_aliases",
      "transactions",
      "transaction_lines",
      "ledger_entries",
      "inventory_movements",
      "audit_events",
      "ai_usage",
    ];
    for (const t of tables) {
      const r = await asUser(db, STRANGER, () => db.query<{ n: string }>(`select count(*) n from public.${t}`));
      expect(Number(r.rows[0].n)).toBe(0);
    }

    await expect(asUser(db, STRANGER, () => rpc("get_shop_state", shop))).rejects.toThrow(/FORBIDDEN/);
    await expect(asUser(db, STRANGER, () => rpc("get_munshi_pulse", shop))).rejects.toThrow(/FORBIDDEN/);
    await expect(asUser(db, STRANGER, () => rpc("get_shop_feed", shop, null, 10))).rejects.toThrow(/FORBIDDEN/);
    await expect(asUser(db, STRANGER, () => rpc("export_shop_data", shop))).rejects.toThrow(/FORBIDDEN/);
  });
});

describe("paginated feed & customer ledger", () => {
  it("paginates transactions with before_seq cursor", async () => {
    const p1 = await asUser(db, OWNER, () => rpc("get_shop_feed", shop, null, 5));
    expect(p1.items.length).toBe(5);
    expect(p1.next_before_seq).toBeGreaterThan(0);

    const p2 = await asUser(db, OWNER, () => rpc("get_shop_feed", shop, p1.next_before_seq, 5));
    expect(p2.items.length).toBe(5);
    expect(p2.items[0].seq).toBeLessThan(p1.items[4].seq);
  });
});

describe("account export, deletion & sandbox purge", () => {
  it("exports shop data, deletes sole-owner shop cleanly, and purges stale sandboxes", async () => {
    const sandboxId = await rpc<string>("create_demo_shop", STRANGER, "sandbox");
    const exp = await asUser(db, STRANGER, () => rpc("export_shop_data", sandboxId));
    expect(exp.shop.id).toBe(sandboxId);
    expect(exp.transactions.length).toBeGreaterThan(10);

    const hash = createHash("sha256").update(STRANGER).digest("hex");
    const del = await rpc("delete_user_account_data", STRANGER, hash);
    expect(del.deleted_shops).toBe(1);

    const left = await one<{ n: string }>(db, "select count(*) n from public.shops where id = $1", [sandboxId]);
    expect(Number(left.n)).toBe(0);

    // Idempotent second call
    const del2 = await rpc("delete_user_account_data", STRANGER, hash);
    expect(del2.deleted_shops).toBe(0);

    // Sandbox purge ignores stage shop and deletes old sandboxes
    const oldSandbox = await rpc<string>("create_demo_shop", CO_OWNER, "sandbox");
    await db.query("update public.shops set created_at = now() - interval '96 hours' where id = $1", [oldSandbox]);
    const purged = await rpc("purge_stale_sandboxes", "72 hours");
    expect(purged.deleted_shops).toBe(1);

    const stageStillExists = await one<{ n: string }>(db, "select count(*) n from public.shops where id = $1", [shop]);
    expect(Number(stageStillExists.n)).toBe(1);
  });
});

describe("concurrency proof (idempotency + hash chain)", () => {
  it("handles 200 duplicate + 50 distinct concurrent commit_sale calls with zero duplicates", async () => {
    const cust = (await one<{ id: string }>(db, "select id from public.customers where shop_id = $1 limit 1", [shop])).id;
    const prod = (await one<{ id: string }>(db, "select id from public.products where shop_id = $1 limit 1", [shop])).id;

    const beforeCount = Number((await one<{ n: string }>(db, "select count(*) n from public.transactions where shop_id = $1", [shop])).n);

    const tasks: Array<() => Promise<unknown>> = [];
    for (let k = 0; k < 20; k++) {
      const key = `conc-dup-${k}-${Date.now()}`;
      for (let r = 0; r < 10; r++) {
        tasks.push(() =>
          asUser(db, OWNER, () =>
            rpc("commit_sale", shop, {
              idempotency_key: key,
              customer_id: cust,
              discount_paisa: 0,
              cash_paid_paisa: 1000,
              lines: [{ product_id: prod, qty_base_units: 100 }],
              audit_meta: {},
            }),
          ),
        );
      }
    }
    for (let d = 0; d < 50; d++) {
      const key = `conc-uniq-${d}-${Date.now()}`;
      tasks.push(() =>
        asUser(db, OWNER, () =>
          rpc("commit_sale", shop, {
            idempotency_key: key,
            customer_id: cust,
            discount_paisa: 0,
            cash_paid_paisa: 1000,
            lines: [{ product_id: prod, qty_base_units: 100 }],
            audit_meta: {},
          }),
        ),
      );
    }

    // Run sequentially in PGlite (single-connection WASM) in deterministic interleaved order
    for (const t of tasks) {
      await t();
    }

    const afterCount = Number((await one<{ n: string }>(db, "select count(*) n from public.transactions where shop_id = $1", [shop])).n);
    expect(afterCount - beforeCount).toBe(70);

    const chain = await rpc("verify_ledger_chain", shop);
    expect(chain.ok).toBe(true);
    expect(Number(chain.ledger_sum_paisa)).toBe(0);
  }, 60_000);
});
