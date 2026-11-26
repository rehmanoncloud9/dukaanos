import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, bootDb, one } from "./helpers/pglite";

/**
 * Mutual Khata (Bharosa Layer) on a real Postgres: customer attestations are hash-chained,
 * idempotent, impossible for the shopkeeper to forge, and feed the signed trade summary.
 */
let db: PGlite;
let shop: string;
const ids: Record<string, string> = {};
const OWNER = "33333333-3333-4333-8333-333333333333";
let udhaarTx: string;

async function rpc<T = any>(fn: string, ...args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const r = await db.query<{ r: T }>(`select public.${fn}(${placeholders}) as r`, args);
  return r.rows[0].r;
}

/** Run as the API's service_role client (what /api/khata/attest uses after verifying the signed link). */
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false); set role service_role;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
  }
}

beforeAll(async () => {
  db = await bootDb();
  shop = (await one<{ id: string }>(db, "select id from public.shops where is_stage_shop")).id;
  const prods = await db.query<{ sku_code: string; id: string }>("select sku_code, id from public.products where shop_id = $1", [shop]);
  for (const p of prods.rows) ids[p.sku_code] = p.id;
  const custs = await db.query<{ code: string; id: string }>("select code, id from public.customers where shop_id = $1", [shop]);
  for (const c of custs.rows) ids[c.code] = c.id;
  await db.query("insert into auth.users (id, email) values ($1, 'owner@test')", [OWNER]);
  await db.query("select public.link_shop_member($1, $2, 'owner')", [shop, OWNER]);
  const sale = await asUser(db, OWNER, () => rpc("commit_sale", shop, {
    idempotency_key: "mk-udhaar-1",
    customer_id: ids.CHHOTE_ALI,
    cash_paid_paisa: 0,
    lines: [{ product_id: ids.CHEENI, qty_base_units: 2000, spoken: "do kilo cheeni" }],
  }));
  udhaarTx = sale.transaction_id;
}, 120_000);

describe("Mutual Khata — trust boundary", () => {
  it("a shopkeeper cannot forge a customer confirmation", async () => {
    await expect(asUser(db, OWNER, () => rpc("record_attestation", shop, ids.CHHOTE_ALI, {
      idempotency_key: "forge-1", kind: "confirm", transaction_id: udhaarTx,
    }))).rejects.toThrow(/FORBIDDEN/);
  });

  it("members cannot insert attestations directly", async () => {
    await expect(asUser(db, OWNER, () => db.query(
      `insert into public.attestations (shop_id, seq, customer_id, kind, source, idempotency_key, prev_hash, entry_hash, promise_date)
       values ($1, 999, $2, 'promise', 'shopkeeper', 'direct', 'x', 'y', current_date)`, [shop, ids.CHHOTE_ALI],
    ))).rejects.toThrow();
  });

  it("the shopkeeper may record a verbal wada (promise) only", async () => {
    const r = await asUser(db, OWNER, () => rpc("record_attestation", shop, ids.CHHOTE_ALI, {
      idempotency_key: "wada-shopkeeper-1", kind: "promise",
      promise_date: new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10),
    }));
    expect(r.ok).toBe(true);
    expect(r.source).toBe("shopkeeper");
  });
});

describe("Mutual Khata — customer attestation via signed link (service_role)", () => {
  it("statement lists the udhaar entry as pending", async () => {
    const s = await asService(() => rpc("get_customer_statement", shop, ids.CHHOTE_ALI, 30));
    expect(s.customer.name).toBe("Chhote Ali");
    const e = s.entries.find((x: any) => x.transaction_id === udhaarTx);
    expect(e.status).toBe("pending");
    expect(Number(e.credit_paisa)).toBeGreaterThan(0);
    expect(s.promise.state).toBe("open");
  });

  it("confirm is hash-chained to the transaction and idempotent", async () => {
    const payload = { idempotency_key: "cust-confirm-1", kind: "confirm", transaction_id: udhaarTx };
    const a = await asService(() => rpc("record_attestation", shop, ids.CHHOTE_ALI, payload));
    expect(a.deduplicated).toBe(false);
    expect(a.source).toBe("customer");
    const tx = await one<{ entry_hash: string }>(db, "select entry_hash from public.transactions where id = $1", [udhaarTx]);
    expect(a.tx_entry_hash).toBe(tx.entry_hash);
    const again = await asService(() => rpc("record_attestation", shop, ids.CHHOTE_ALI, payload));
    expect(again.deduplicated).toBe(true);
    expect(again.entry_hash).toBe(a.entry_hash);
    const n = await one<{ n: string }>(db, "select count(*) n from public.attestations where idempotency_key = 'cust-confirm-1'");
    expect(Number(n.n)).toBe(1);
  });

  it("rejects attesting another customer's transaction", async () => {
    await expect(asService(() => rpc("record_attestation", shop, ids.BILAL, {
      idempotency_key: "wrong-cust-1", kind: "confirm", transaction_id: udhaarTx,
    }))).rejects.toThrow(/TX_NOT_FOUND/);
  });

  it("records a payment claim and a dispute; latest answer wins", async () => {
    const claim = await asService(() => rpc("record_attestation", shop, ids.CHHOTE_ALI, {
      idempotency_key: "claim-1", kind: "paid_claim", amount_paisa: 50000,
    }));
    expect(claim.ok).toBe(true);
    const dispute = await asService(() => rpc("record_attestation", shop, ids.CHHOTE_ALI, {
      idempotency_key: "cust-dispute-1", kind: "dispute", transaction_id: udhaarTx, note: "Maine 1 kilo liya tha",
    }));
    expect(dispute.kind).toBe("dispute");
    const s = await asService(() => rpc("get_customer_statement", shop, ids.CHHOTE_ALI, 30));
    expect(s.entries.find((x: any) => x.transaction_id === udhaarTx).status).toBe("dispute");
    expect(s.paid_claims.length).toBe(1);
    // flip back to confirm for the metrics below
    await asService(() => rpc("record_attestation", shop, ids.CHHOTE_ALI, {
      idempotency_key: "cust-confirm-2", kind: "confirm", transaction_id: udhaarTx,
    }));
  });

  it("rejects promises outside the next 90 days", async () => {
    await expect(asService(() => rpc("record_attestation", shop, ids.CHHOTE_ALI, {
      idempotency_key: "wada-far", kind: "promise", promise_date: "2099-01-01",
    }))).rejects.toThrow(/90 days/);
  });
});

describe("Mutual Khata — chain, overview, trade summary", () => {
  it("attestation chain verifies", async () => {
    const v = await asUser(db, OWNER, () => rpc("verify_attestation_chain", shop));
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(5);
  });

  it("Khata overview badges per customer", async () => {
    const o = await asUser(db, OWNER, () => rpc("get_bharosa_overview", shop));
    const ali = o.find((x: any) => x.customer_id === ids.CHHOTE_ALI);
    expect(ali.confirmed).toBeGreaterThanOrEqual(1);
    expect(ali.promise_state).toBe("open");
    expect(Number(ali.paid_claim_paisa)).toBe(50000);
  });

  it("trade summary carries verified-receivable metrics", async () => {
    const t = await asUser(db, OWNER, () => rpc("get_trade_summary", shop, 30));
    expect(t.bharosa.confirmed_entries).toBeGreaterThanOrEqual(1);
    expect(Number(t.bharosa.credit_entries)).toBeGreaterThanOrEqual(Number(t.bharosa.confirmed_entries));
    expect(t.bharosa.attestations_total).toBe(4);
    expect(t.bharosa.attestation_head_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tampering with an attested transaction breaks the attestation chain", async () => {
    await db.exec(`select set_config('dukaan.maintenance', 'on', false);`);
    await db.query("update public.transactions set entry_hash = repeat('f', 64) where id = $1", [udhaarTx]);
    await db.exec(`select set_config('dukaan.maintenance', 'off', false);`);
    const v = await asUser(db, OWNER, () => rpc("verify_attestation_chain", shop));
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("ATTESTED_TX_CHANGED");
  });

  it("attestations are append-only and reset_demo_shop clears them", async () => {
    await expect(db.query("delete from public.attestations where shop_id = $1", [shop])).rejects.toThrow(/IMMUTABLE_LEDGER/);
    await rpc("reset_demo_shop", shop);
    const n = await one<{ n: string }>(db, "select count(*) n from public.attestations where shop_id = $1", [shop]);
    expect(Number(n.n)).toBe(0);
    expect((await rpc("verify_ledger_chain", shop)).ok).toBe(true);
  });
});

describe("Supplier Price Memory (7F)", () => {
  it("flags a wholesale rise, its margin hit, and a margin-keeping price", async () => {
    // the previous test reset the demo shop, so product ids are new — look SURF up again
    const pid = (await one<{ id: string }>(db, "select id from public.products where shop_id = $1 and sku_code = 'SURF'", [shop])).id;
    const prod = await one<{ unit_price_paisa: string; pack_size_base_units: string }>(db,
      "select unit_price_paisa, pack_size_base_units from public.products where id = $1", [pid]);
    const pack = Number(prod.pack_size_base_units);
    // two parchis: 10 packs at Rs 400, then 10 packs at Rs 432 (+8%)
    for (const [k, total] of [["parchi-pm-0001", 400000], ["parchi-pm-0002", 432000]] as const) {
      await asUser(db, OWNER, () => rpc("record_purchase", shop, {
        idempotency_key: k, supplier_name: "Al-Madina Wholesale", cash_paid_paisa: total, stated_total_paisa: total,
        lines: [{ product_id: pid, qty_base_units: 10 * pack, line_total_paisa: total }],
      }));
    }
    const mem = await asUser(db, OWNER, () => rpc("get_price_memory", shop, 1));
    const surf = mem.find((x: any) => x.product_id === pid);
    expect(Number(surf.prev_cost_paisa)).toBe(40000);
    expect(Number(surf.last_cost_paisa)).toBe(43200);
    expect(surf.change_bp).toBe(800);
    expect(surf.margin_now_bp).toBeLessThan(surf.margin_before_bp);
    const retail = Number(prod.unit_price_paisa);
    if (surf.suggested_price_paisa !== null) {
      expect(Number(surf.suggested_price_paisa) % 500).toBe(0);
      expect(Number(surf.suggested_price_paisa)).toBeGreaterThan(retail);
    }
    await expect(asUser(db, "44444444-4444-4444-8444-444444444444", () => rpc("get_price_memory", shop, 1))).rejects.toThrow(/FORBIDDEN/);
  });
});
