import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, bootDb, one } from "./helpers/pglite";

let db: PGlite;
let shop: string;
const ids: Record<string, string> = {};
const JUDGE = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";

async function rpc<T = any>(fn: string, ...args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const r = await db.query<{ r: T }>(`select public.${fn}(${placeholders}) as r`, args);
  return r.rows[0].r;
}

beforeAll(async () => {
  db = await bootDb();
  shop = (await one<{ id: string }>(db, "select id from public.shops where is_stage_shop")).id;
  const prods = await db.query<{ sku_code: string; id: string }>("select sku_code, id from public.products where shop_id = $1", [shop]);
  for (const p of prods.rows) ids[p.sku_code] = p.id;
  const custs = await db.query<{ code: string; id: string }>("select code, id from public.customers where shop_id = $1", [shop]);
  for (const c of custs.rows) ids[c.code] = c.id;
  await db.query("insert into auth.users (id, email) values ($1, 'judge@test'), ($2, 'stranger@test')", [JUDGE, STRANGER]);
  await db.query("select public.link_shop_member($1, $2, 'judge')", [shop, JUDGE]);
}, 120_000);

describe("seeded demo shop", () => {
  it("has the canonical balances derived purely from the ledger", async () => {
    const r = await db.query<{ code: string; balance_paisa: string }>(
      "select code, balance_paisa from public.customers where shop_id = $1 order by code", [shop]);
    const bal = Object.fromEntries(r.rows.map((x) => [x.code, Number(x.balance_paisa)]));
    expect(bal).toEqual({ ALI_DRIVER: 0, ALI_TAILOR: 65000, BILAL: 635000, CHHOTE_ALI: 140000, TARIQ_B: 0, TARIQ_M: 90000 });
  });
  it("has 100+ dialect aliases", async () => {
    const r = await one<{ n: string }>(db, "select count(*) n from public.sku_aliases where shop_id = $1", [shop]);
    expect(Number(r.n)).toBeGreaterThanOrEqual(100);
  });
  it("lands stock on the catalog targets", async () => {
    const r = await one<{ stock_base_units: string }>(db, "select stock_base_units from public.products where id = $1", [ids.CHEENI]);
    expect(Number(r.stock_base_units)).toBe(4200);
  });
  it("Pulse flags both seeded stockout items (Cheeni + Dalda)", async () => {
    const p = await asUser(db, JUDGE, () => rpc("get_munshi_pulse", shop));
    const stock = p.stockout.items.map((x: any) => x.name).sort();
    expect(stock).toEqual(["Cheeni (Sugar)", "Dalda Oil 5L"]);
    expect(p.overdue.count).toBe(3);
  });
  it("ledger sums to zero and the SHA-256 chain verifies", async () => {
    const v = await rpc("verify_ledger_chain", shop);
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThan(150);
    expect(Number(v.ledger_sum_paisa)).toBe(0);
  });
});

describe("commit_sale — Demo Act 1", () => {
  let res: any;
  const key = "golden-act1-0001";
  const payload = () => ({
    idempotency_key: key,
    customer_id: ids.CHHOTE_ALI,
    discount_paisa: 3000,
    cash_paid_paisa: 40000,
    lines: [
      { product_id: ids.CHEENI, qty_base_units: 375, spoken: "dedh pao cheeni" },
      { new_sku: { name: "Khula Oil", base_unit: "ml", pack_size_base_units: 1000, unit_price_paisa: 25000 }, qty_base_units: 1000, spoken: "khula oil" },
    ],
    audit_meta: { transcript: "Chhote Ali ko dedh pao cheeni…" },
  });

  it("commits a balanced, hash-chained sale with deterministic math", async () => {
    res = await asUser(db, JUDGE, () => rpc("commit_sale", shop, payload()));
    expect(res.status).toBe("COMMITTED");
    expect(res.totals.subtotal_paisa).toBe(31000);
    expect(res.totals.total_paisa).toBe(28000);
    expect(res.totals.credit_paisa).toBe(-12000);
    expect(res.customer.balance_paisa).toBe(128000);
    expect(res.entry_hash).toMatch(/^[0-9a-f]{64}$/);
    const sum = res.journal.reduce((s: number, j: any) => s + (j.side === "DR" ? j.amount_paisa : -j.amount_paisa), 0);
    expect(sum).toBe(0);
  });

  it("Replay Test: same idempotency_key → 200 Deduplicated, 0 duplicate rows", async () => {
    const again = await asUser(db, JUDGE, () => rpc("commit_sale", shop, payload()));
    expect(again.deduplicated).toBe(true);
    expect(again.status).toBe("REPLAY_DEDUPLICATED");
    expect(again.duplicate_rows).toBe(0);
    expect(again.transaction_id).toBe(res.transaction_id);
    const c = await one<{ balance_paisa: string }>(db, "select balance_paisa from public.customers where id = $1", [ids.CHHOTE_ALI]);
    expect(Number(c.balance_paisa)).toBe(128000);
  });

  it("QuickAdd created the SKU atomically", async () => {
    const p = await one<{ n: string }>(db, "select count(*) n from public.products where shop_id = $1 and name = 'Khula Oil' and is_quick_added", [shop]);
    expect(Number(p.n)).toBe(1);
  });

  it("reverse_transaction mirrors the ledger and restores the balance; double reversal is blocked", async () => {
    const rev = await asUser(db, JUDGE, () =>
      rpc("reverse_transaction", shop, { idempotency_key: "undo-act1-0001", transaction_id: res.transaction_id }));
    expect(rev.type).toBe("reversal");
    expect(rev.customer.balance_paisa).toBe(140000);
    await expect(asUser(db, JUDGE, () =>
      rpc("reverse_transaction", shop, { idempotency_key: "undo-act1-0002", transaction_id: res.transaction_id }))).rejects.toThrow(/ALREADY_REVERSED/);
    const s = await one<{ stock_base_units: string }>(db, "select stock_base_units from public.products where id = $1", [ids.CHEENI]);
    expect(Number(s.stock_base_units)).toBe(4200);
  });
});

describe("guards", () => {
  it("UDHAAR_REQUIRES_CUSTOMER", async () => {
    await expect(asUser(db, JUDGE, () => rpc("commit_sale", shop, {
      idempotency_key: "udhaar-no-cust-1", customer_id: null, cash_paid_paisa: 0,
      lines: [{ product_id: ids.ATTA, qty_base_units: 1000 }],
    }))).rejects.toThrow(/UDHAAR_REQUIRES_CUSTOMER/);
  });
  it("value-first: '250 ka' sells exactly Rs. 250", async () => {
    const r = await asUser(db, JUDGE, () => rpc("commit_sale", shop, {
      idempotency_key: "value-first-0001", lines: [{ product_id: ids.CHEENI, value_paisa: 25000 }],
    }));
    expect(r.totals.total_paisa).toBe(25000);
    expect(r.lines[0].qty_base_units).toBe(1563);
  });
  it("soft NEGATIVE_STOCK warning never blocks", async () => {
    const r = await asUser(db, JUDGE, () => rpc("commit_sale", shop, {
      idempotency_key: "neg-stock-00001", lines: [{ product_id: ids.ATTA, qty_base_units: 50000 }],
    }));
    expect(r.status).toBe("COMMITTED");
    expect(r.warnings[0].code).toBe("NEGATIVE_STOCK");
  });
  it("balances cannot be edited directly", async () => {
    await expect(db.query("update public.customers set balance_paisa = 0 where id = $1", [ids.BILAL])).rejects.toThrow(/BALANCE_IS_LEDGER_DERIVED/);
  });
  it("financial history is append-only", async () => {
    await expect(db.query("delete from public.transactions where shop_id = $1", [shop])).rejects.toThrow(/IMMUTABLE_LEDGER/);
  });
  it("record_payment (Wasooli) decrements the balance", async () => {
    const r = await asUser(db, JUDGE, () => rpc("record_payment", shop, {
      idempotency_key: "wasooli-bilal-1", customer_id: ids.BILAL, amount_paisa: 150000,
    }));
    expect(r.customer.balance_paisa).toBe(485000);
  });
  it("record_purchase restocks, creates new SKUs and reports math_check", async () => {
    const r = await asUser(db, JUDGE, () => rpc("record_purchase", shop, {
      idempotency_key: "parchi-0000001", supplier_name: "Al-Madina Wholesale", cash_paid_paisa: 1000000,
      stated_total_paisa: 1367000,
      lines: [
        { product_id: ids.SURF, qty_base_units: 10, line_total_paisa: 480000 },
        { product_id: ids.DALDA, qty_base_units: 15000, line_total_paisa: 735000 },
        { new_sku: { name: "Tapal Danedar 900g", base_unit: "pcs", pack_size_base_units: 1 }, qty_base_units: 1, line_total_paisa: 152000, spoken: "tapal danedar 900g" },
      ],
    }));
    expect(r.totals.total_paisa).toBe(1367000);
    expect(r.math_check.passed).toBe(true);
    expect(r.new_skus).toBe(1);
    expect(r.totals.credit_paisa).toBe(367000);
  });
});

describe("RLS & isolation", () => {
  it("a non-member sees nothing and cannot write", async () => {
    const rows = await asUser(db, STRANGER, async () => (await db.query("select * from public.customers")).rows);
    expect(rows.length).toBe(0);
    await expect(asUser(db, STRANGER, () => rpc("commit_sale", shop, {
      idempotency_key: "stranger-00001", lines: [{ product_id: ids.ATTA, qty_base_units: 1000 }],
    }))).rejects.toThrow(/FORBIDDEN/);
  });
  it("members read but cannot write tables directly", async () => {
    const rows = await asUser(db, JUDGE, async () => (await db.query("select id from public.customers")).rows);
    expect(rows.length).toBe(6);
    await expect(asUser(db, JUDGE, () => db.query("insert into public.ledger_entries (transaction_id, shop_id, account_code, amount_paisa) values (gen_random_uuid(), $1, '1010', 100)", [shop]))).rejects.toThrow();
  });
  it("authenticated users cannot reset the demo shop", async () => {
    await expect(asUser(db, JUDGE, () => rpc("reset_demo_shop", shop))).rejects.toThrow(/permission denied/);
  });
});

describe("Munshi Pulse", () => {
  it("flags 15+ day overdue udhaar, 2-day stockouts and today's galla in SQL", async () => {
    const p = await asUser(db, JUDGE, () => rpc("get_munshi_pulse", shop));
    const names = p.overdue.items.map((x: any) => x.name).sort();
    expect(names).toEqual(["Ali Tailor", "Bilal Ahmed", "Chhote Ali"]);
    const stock = p.stockout.items.map((x: any) => x.name);
    expect(stock).toContain("Cheeni (Sugar)");
    expect(p.galla.sales_count).toBeGreaterThan(10);
    expect(p.llm_cost_rs).toBe(0);
  });
  it("shop state + trade summary", async () => {
    const s = await asUser(db, JUDGE, () => rpc("get_shop_state", shop));
    expect(s.feed.length).toBeGreaterThan(10);
    expect(s.products.length).toBeGreaterThanOrEqual(25);
    const t = await asUser(db, JUDGE, () => rpc("get_trade_summary", shop, 30));
    expect(Number(t.gmv_paisa)).toBeGreaterThan(0);
    expect(t.ledger_balanced).toBe(true);
    expect(t.head_entry_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("tamper evidence", () => {
  it("demo_tamper breaks the chain; reset_demo_shop restores it", async () => {
    const t = await rpc("demo_tamper", shop);
    const v = await rpc("verify_ledger_chain", shop);
    expect(v.ok).toBe(false);
    expect(v.code).toBe("CHAIN_BROKEN");
    expect(v.first_broken_seq).toBe(t.tampered_seq);
    await rpc("reset_demo_shop", shop);
    const v2 = await rpc("verify_ledger_chain", shop);
    expect(v2.ok).toBe(true);
  }, 120_000);
});
