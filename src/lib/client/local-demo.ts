/**
 * Deterministic in-memory & IndexedDB Demo Shop State for zero-config / private-window mode.
 * Replays DEMO_SHOP, DEMO_PRODUCTS, DEMO_CUSTOMERS, and buildDemoHistory() identically to
 * the PostgreSQL seed migration so the full app works 100% free without Supabase or Gemini keys.
 */

import type { CommitResponse, FeedTx, Galla, ShopState, StateCustomer, StateProduct } from "@/lib/api/contracts";
import { buildDemoHistory, DEMO_CUSTOMERS, DEMO_PRODUCTS, DEMO_SHOP, type DemoWhen } from "@/lib/domain/demo-data";
import { mulDiv } from "@/lib/domain/money";

export const LOCAL_DEMO_SHOP_ID = "local-demo-shop";

function eventDate(when: DemoWhen, nowMs: number, day0Ms: number): Date {
  if ("ago" in when) {
    const candidate = nowMs - when.ago * 60_000;
    const minToday = day0Ms + Math.max(1, 200 - when.ago) * 1000;
    return new Date(Math.max(candidate, minToday));
  }
  return new Date(day0Ms - when.d * 86_400_000 + when.m * 60_000);
}

function fakeHash(seq: number, label: string): string {
  let h1 = (0x811c9dc5 ^ seq) >>> 0;
  let h2 = (0x9e3779b9 ^ (seq * 31)) >>> 0;
  for (let i = 0; i < label.length; i++) {
    const c = label.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return (
    h1.toString(16).padStart(8, "0") +
    h2.toString(16).padStart(8, "0") +
    (h1 ^ h2).toString(16).padStart(8, "0") +
    seq.toString(16).padStart(8, "0")
  ).repeat(2);
}

export function buildLocalDemoShopState(nowMs = Date.now()): ShopState {
  const now = new Date(nowMs);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const day0Ms = dayStart.getTime();
  const sevenDaysAgoMs = nowMs - 7 * 86_400_000;

  const productsByCode = new Map<string, StateProduct>();
  const productsById = new Map<string, StateProduct>();

  DEMO_PRODUCTS.forEach((p, idx) => {
    const id = `demo-prod-${idx + 1}-${p.code.toLowerCase()}`;
    const row: StateProduct = {
      id,
      sku_code: p.code,
      name: p.name,
      name_ur: p.name_ur,
      base_unit: p.base_unit,
      pack_size_base_units: p.pack,
      unit_price_paisa: p.price_rs * 100,
      cost_price_paisa: p.cost_rs * 100,
      stock_base_units: p.stock_target,
      reorder_level_base_units: p.reorder,
      aliases: [...p.aliases],
      is_quick_added: false,
      sold_7d: 0,
      days_left: null,
      created_at: new Date(nowMs - 142 * 86_400_000).toISOString(),
      last_sold_at: null,
    };
    productsByCode.set(p.code, row);
    productsById.set(id, row);
  });

  const customersByCode = new Map<string, StateCustomer>();
  const customersById = new Map<string, StateCustomer>();

  DEMO_CUSTOMERS.forEach((c, idx) => {
    const id = `demo-cust-${idx + 1}-${c.code.toLowerCase()}`;
    const row: StateCustomer = {
      id,
      code: c.code,
      name: c.name,
      role_tag: c.role_tag,
      phone: c.phone,
      aliases: [...c.aliases],
      balance_paisa: 0,
      last_paid_at: null,
      oldest_unpaid_at: null,
      days_overdue: null,
      credit_limit_paisa: null,
    };
    customersByCode.set(c.code, row);
    customersById.set(id, row);
  });

  // Track FIFO unpaid credit tranches per customer to compute exact oldest_unpaid_at and days_overdue
  const creditLots = new Map<string, Array<{ remaining: number; atIso: string }>>();

  const history = buildDemoHistory();
  const feedChronological: FeedTx[] = [];
  let seq = 0;
  let prevHash = "0".repeat(64);

  const today: Galla = {
    cash_sales_paisa: 0,
    sales_count: 0,
    cash_sales_count: 0,
    udhaar_paisa: 0,
    udhaar_accounts: 0,
    gross_sales_paisa: 0,
    wasooli_paisa: 0,
    purchases_cash_paisa: 0,
    cash_in_galla_paisa: 0,
    est_margin_paisa: 0,
  };
  const todayUdhaarCustomerIds = new Set<string>();

  for (const ev of history) {
    seq += 1;
    const atDate = eventDate(ev.at, nowMs, day0Ms);
    const atIso = atDate.toISOString();
    const isToday = atDate.getTime() >= day0Ms;
    const isLast7d = atDate.getTime() >= sevenDaysAgoMs;

    if (ev.kind === "sale") {
      const cust = ev.customer ? customersByCode.get(ev.customer) ?? null : null;
      const txLines: FeedTx["lines"] = [];
      let subtotal = 0;
      let costTotal = 0;

      for (const l of ev.lines) {
        const prod = productsByCode.get(l.p);
        if (!prod) continue;
        let qtyBase = l.q ?? 0;
        let lineTotal = l.v ?? 0;
        const valueFirst = l.v !== undefined && l.q === undefined;
        if (valueFirst) {
          qtyBase = Math.max(1, Math.round((lineTotal * prod.pack_size_base_units) / prod.unit_price_paisa));
        } else {
          lineTotal = mulDiv(qtyBase, prod.unit_price_paisa, prod.pack_size_base_units);
        }
        const lineCost = mulDiv(qtyBase, prod.cost_price_paisa, prod.pack_size_base_units);
        subtotal += lineTotal;
        costTotal += lineCost;
        if (isLast7d) {
          prod.sold_7d += qtyBase;
        }
        prod.last_sold_at = atIso;
        txLines.push({
          name: prod.name,
          qty_base_units: qtyBase,
          base_unit: prod.base_unit,
          line_total_paisa: lineTotal,
          value_first: valueFirst,
          product_id: prod.id,
        });
      }

      const discount = ev.disc ?? 0;
      const total = Math.max(0, subtotal - discount);
      const cashPaid = ev.cash !== undefined ? ev.cash : total;
      const credit = total - cashPaid;

      if (cust && credit > 0) {
        cust.balance_paisa += credit;
        const lots = creditLots.get(cust.id) ?? [];
        lots.push({ remaining: credit, atIso });
        creditLots.set(cust.id, lots);
      }

      if (isToday) {
        today.sales_count += 1;
        today.gross_sales_paisa += total;
        today.cash_sales_paisa += cashPaid;
        today.cash_in_galla_paisa += cashPaid;
        today.est_margin_paisa += Math.max(0, total - costTotal);
        if (credit === 0 && cashPaid > 0) {
          today.cash_sales_count += 1;
        }
        if (credit > 0) {
          today.udhaar_paisa += credit;
          if (cust) todayUdhaarCustomerIds.add(cust.id);
        }
      }

      const entryHash = fakeHash(seq, `sale-${total}-${atIso}`);
      feedChronological.push({
        id: `demo-tx-${seq}`,
        seq,
        type: "sale",
        customer_id: cust?.id ?? null,
        customer_name: cust?.name ?? null,
        customer_role: cust?.role_tag ?? null,
        supplier_name: null,
        reversed_transaction_id: null,
        subtotal_paisa: subtotal,
        discount_paisa: discount,
        total_paisa: total,
        cash_paid_paisa: cashPaid,
        credit_paisa: credit,
        entry_hash: entryHash,
        prev_hash: prevHash,
        created_at: atIso,
        audit_meta: { source: "seed", channel: "counter" },
        idempotency_key: `seed-demo-${seq}`,
        is_reversed: false,
        lines: txLines,
      });
      prevHash = entryHash;
    } else if (ev.kind === "payment") {
      const cust = customersByCode.get(ev.customer);
      if (!cust) continue;
      const amount = ev.amount;
      cust.balance_paisa = Math.max(0, cust.balance_paisa - amount);
      cust.last_paid_at = atIso;

      let toSettle = amount;
      const lots = creditLots.get(cust.id) ?? [];
      while (toSettle > 0 && lots.length > 0) {
        if (lots[0].remaining <= toSettle) {
          toSettle -= lots[0].remaining;
          lots.shift();
        } else {
          lots[0].remaining -= toSettle;
          toSettle = 0;
        }
      }

      if (isToday) {
        today.wasooli_paisa += amount;
        today.cash_in_galla_paisa += amount;
      }

      const entryHash = fakeHash(seq, `payment-${amount}-${atIso}`);
      feedChronological.push({
        id: `demo-tx-${seq}`,
        seq,
        type: "payment",
        customer_id: cust.id,
        customer_name: cust.name,
        customer_role: cust.role_tag ?? null,
        supplier_name: null,
        reversed_transaction_id: null,
        subtotal_paisa: amount,
        discount_paisa: 0,
        total_paisa: amount,
        cash_paid_paisa: amount,
        credit_paisa: 0,
        entry_hash: entryHash,
        prev_hash: prevHash,
        created_at: atIso,
        audit_meta: { source: "seed", channel: "wasooli" },
        idempotency_key: `seed-demo-${seq}`,
        is_reversed: false,
        lines: [],
      });
      prevHash = entryHash;
    } else if (ev.kind === "purchase") {
      const txLines: FeedTx["lines"] = [];
      let total = 0;
      for (const l of ev.lines) {
        const prod = productsByCode.get(l.p);
        if (!prod) continue;
        total += l.cost;
        txLines.push({
          name: prod.name,
          qty_base_units: l.q,
          base_unit: prod.base_unit,
          line_total_paisa: l.cost,
          value_first: false,
          product_id: prod.id,
        });
      }
      const cashPaid = ev.cash;
      const credit = Math.max(0, total - cashPaid);
      if (isToday) {
        today.purchases_cash_paisa += cashPaid;
        today.cash_in_galla_paisa -= cashPaid;
      }
      const entryHash = fakeHash(seq, `purchase-${total}-${atIso}`);
      feedChronological.push({
        id: `demo-tx-${seq}`,
        seq,
        type: "purchase",
        customer_id: null,
        customer_name: null,
        customer_role: null,
        supplier_name: ev.supplier,
        reversed_transaction_id: null,
        subtotal_paisa: total,
        discount_paisa: 0,
        total_paisa: total,
        cash_paid_paisa: cashPaid,
        credit_paisa: credit,
        entry_hash: entryHash,
        prev_hash: prevHash,
        created_at: atIso,
        audit_meta: { source: "seed", channel: "parchi" },
        idempotency_key: `seed-demo-${seq}`,
        is_reversed: false,
        lines: txLines,
      });
      prevHash = entryHash;
    }
  }

  today.udhaar_accounts = todayUdhaarCustomerIds.size;

  // Finalize customer overdue ages
  const customers: StateCustomer[] = [];
  for (const cust of customersById.values()) {
    const lots = creditLots.get(cust.id) ?? [];
    if (cust.balance_paisa > 0 && lots.length > 0) {
      cust.oldest_unpaid_at = lots[0].atIso;
      const days = Math.max(0, Math.floor((nowMs - new Date(lots[0].atIso).getTime()) / 86_400_000));
      cust.days_overdue = days;
    } else {
      cust.oldest_unpaid_at = null;
      cust.days_overdue = null;
    }
    customers.push(cust);
  }

  // Finalize product days_left based on 7-day velocity
  const products: StateProduct[] = [];
  for (const prod of productsById.values()) {
    if (prod.sold_7d > 0) {
      const dailyAvg = prod.sold_7d / 7;
      prod.days_left = Math.max(0, Math.round((prod.stock_base_units / dailyAvg) * 10) / 10);
    } else {
      prod.days_left = null;
    }
    products.push(prod);
  }

  const feed = feedChronological.slice().reverse();

  return {
    shop: {
      id: LOCAL_DEMO_SHOP_ID,
      name: DEMO_SHOP.name,
      owner_name: DEMO_SHOP.owner_name,
      phone: DEMO_SHOP.phone,
      city: DEMO_SHOP.city,
      is_demo_shop: true,
      is_stage_shop: false,
      active_since: new Date(nowMs - DEMO_SHOP.active_since_days * 86_400_000).toISOString(),
    },
    today,
    feed,
    customers,
    products,
    chain_head: { seq, entry_hash: prevHash },
    sql_ms: 1,
  };
}

/**
 * Applies a sale, payment, purchase, or reversal directly to the local ShopState
 * when running in zero-config local demo mode, returning both the updated state
 * and a valid CommitResponse.
 */
export function applyLocalDemoMutation(
  state: ShopState,
  endpoint: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): { nextState: ShopState; response: CommitResponse } {
  const nextSeq = (state.chain_head?.seq ?? 0) + 1;
  const prevHash = state.chain_head?.entry_hash ?? "0".repeat(64);
  const nowIso = new Date().toISOString();
  const entryHash = fakeHash(nextSeq, `${endpoint}-${idempotencyKey}-${nowIso}`);

  const today = { ...state.today };
  const customers = state.customers.map((c) => ({ ...c }));
  const products = state.products.map((p) => ({ ...p }));
  const feed = state.feed.map((t) => ({ ...t }));
  const warnings: CommitResponse["warnings"] = [];

  if (endpoint === "/api/transactions/commit") {
    const customerId = (typeof payload.customer_id === "string" && payload.customer_id)
      || (typeof payload.new_customer_id === "string" && payload.new_customer_id)
      || null;
    const newCustomerName = typeof payload.new_customer_name === "string" ? payload.new_customer_name.trim() : null;
    let cust = customerId ? customers.find((c) => c.id === customerId) ?? null : null;
    if (!cust && customerId && newCustomerName) {
      cust = {
        id: customerId,
        code: null,
        name: newCustomerName,
        role_tag: null,
        phone: null,
        aliases: [newCustomerName.toLowerCase()],
        balance_paisa: 0,
        last_paid_at: null,
        oldest_unpaid_at: nowIso,
        days_overdue: 0,
      };
      customers.push(cust);
    }

    const rawLines = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
    const txLines: FeedTx["lines"] = [];
    let subtotal = 0;
    let costTotal = 0;

    for (const rl of rawLines) {
      let prod = typeof rl.product_id === "string" ? products.find((p) => p.id === rl.product_id) ?? null : null;
      if (!prod && rl.new_sku && typeof rl.new_sku === "object") {
        const spec = rl.new_sku as { name?: string; base_unit?: "g" | "ml" | "pcs"; pack_size_base_units?: number; unit_price_paisa?: number };
        const id = `demo-quick-${Date.now().toString(36)}-${products.length + 1}`;
        prod = {
          id,
          sku_code: `QUICK_${products.length + 1}`,
          name: spec.name || "Quick Item",
          name_ur: spec.name || "نیا سامان",
          base_unit: spec.base_unit ?? "pcs",
          pack_size_base_units: spec.pack_size_base_units ?? 1,
          unit_price_paisa: spec.unit_price_paisa ?? 0,
          cost_price_paisa: Math.round((spec.unit_price_paisa ?? 0) * 0.9),
          stock_base_units: 0,
          reorder_level_base_units: 0,
          aliases: [String(spec.name || "").toLowerCase()],
          is_quick_added: true,
          sold_7d: 0,
          days_left: null,
          created_at: nowIso,
          last_sold_at: nowIso,
        };
        products.push(prod);
      }
      if (!prod) continue;

      const valueFirst = typeof rl.value_paisa === "number" && rl.value_paisa > 0;
      const qtyBase = typeof rl.qty_base_units === "number" && rl.qty_base_units > 0
        ? rl.qty_base_units
        : valueFirst && prod.unit_price_paisa > 0
          ? Math.max(1, Math.round(((rl.value_paisa as number) * prod.pack_size_base_units) / prod.unit_price_paisa))
          : prod.pack_size_base_units;
      const lineTotal = valueFirst
        ? (rl.value_paisa as number)
        : mulDiv(qtyBase, prod.unit_price_paisa, prod.pack_size_base_units);

      prod.stock_base_units -= qtyBase;
      prod.sold_7d += qtyBase;
      prod.last_sold_at = nowIso;
      if (prod.stock_base_units < 0) {
        warnings.push({
          code: "NEGATIVE_STOCK",
          product_id: prod.id,
          name: prod.name_ur || prod.name,
          stock_after: prod.stock_base_units,
          base_unit: prod.base_unit,
        });
      }

      subtotal += lineTotal;
      costTotal += mulDiv(qtyBase, prod.cost_price_paisa, prod.pack_size_base_units);
      txLines.push({
        name: prod.name,
        qty_base_units: qtyBase,
        base_unit: prod.base_unit,
        line_total_paisa: lineTotal,
        value_first: valueFirst,
        product_id: prod.id,
      });
    }

    const discount = Number(payload.discount_paisa ?? 0) || 0;
    const total = Math.max(0, subtotal - discount);
    const cashPaid = typeof payload.cash_paid_paisa === "number" ? payload.cash_paid_paisa : total;
    const credit = total - cashPaid;

    if (cust && credit !== 0) {
      cust.balance_paisa += credit;
      if (cust.balance_paisa > 0 && !cust.oldest_unpaid_at) {
        cust.oldest_unpaid_at = nowIso;
        cust.days_overdue = 0;
      }
    }

    today.sales_count += 1;
    today.gross_sales_paisa += total;
    today.cash_sales_paisa += cashPaid;
    today.cash_in_galla_paisa += cashPaid;
    today.est_margin_paisa += Math.max(0, total - costTotal);
    if (credit === 0 && cashPaid > 0) today.cash_sales_count += 1;
    if (credit > 0) {
      today.udhaar_paisa += credit;
    }

    const tx: FeedTx = {
      id: idempotencyKey,
      seq: nextSeq,
      type: "sale",
      customer_id: cust?.id ?? null,
      customer_name: cust?.name ?? null,
      customer_role: cust?.role_tag ?? null,
      supplier_name: null,
      reversed_transaction_id: null,
      subtotal_paisa: subtotal,
      discount_paisa: discount,
      total_paisa: total,
      cash_paid_paisa: cashPaid,
      credit_paisa: credit,
      entry_hash: entryHash,
      prev_hash: prevHash,
      created_at: nowIso,
      audit_meta: (payload.audit_meta as Record<string, unknown>) ?? {},
      idempotency_key: idempotencyKey,
      is_reversed: false,
      lines: txLines,
    };
    feed.unshift(tx);

    return {
      nextState: {
        ...state,
        today,
        customers,
        products,
        feed,
        chain_head: { seq: nextSeq, entry_hash: entryHash },
      },
      response: {
        status: "COMMITTED",
        http: 200,
        deduplicated: false,
        duplicate_rows: 0,
        rows_for_key: 1,
        type: "sale",
        transaction_id: idempotencyKey,
        seq: nextSeq,
        prev_hash: prevHash,
        entry_hash: entryHash,
        created_at: nowIso,
        rls_shop_id: state.shop.id,
        totals: { subtotal_paisa: subtotal, discount_paisa: discount, total_paisa: total, cash_paid_paisa: cashPaid, credit_paisa: credit },
        journal: [
          ...(cashPaid > 0 ? [{ account_code: "1010", account_name: "Cash in Galla", side: "DR" as const, amount_paisa: cashPaid }] : []),
          ...(credit > 0 ? [{ account_code: "1100", account_name: "Accounts Receivable (Khata)", side: "DR" as const, amount_paisa: credit, customer_id: cust?.id ?? null }] : []),
          { account_code: "4010", account_name: "Sales Revenue", side: "CR" as const, amount_paisa: total },
        ],
        delta: 0,
        warnings,
        customer: cust ? { id: cust.id, name: cust.name, role_tag: cust.role_tag ?? null, phone: cust.phone ?? null, balance_paisa: cust.balance_paisa } : null,
        rpc_ms: 1,
      },
    };
  }

  if (endpoint === "/api/transactions/payment") {
    const customerId = String(payload.customer_id ?? "");
    const amountPaisa = Number(payload.amount_paisa ?? 0) || 0;
    const cust = customers.find((c) => c.id === customerId) ?? null;
    if (cust) {
      cust.balance_paisa -= amountPaisa;
      cust.last_paid_at = nowIso;
      if (cust.balance_paisa <= 0) {
        cust.days_overdue = null;
        cust.oldest_unpaid_at = null;
      }
    }
    today.wasooli_paisa += amountPaisa;
    today.cash_in_galla_paisa += amountPaisa;

    const tx: FeedTx = {
      id: idempotencyKey,
      seq: nextSeq,
      type: "payment",
      customer_id: cust?.id ?? null,
      customer_name: cust?.name ?? null,
      customer_role: cust?.role_tag ?? null,
      supplier_name: null,
      reversed_transaction_id: null,
      subtotal_paisa: amountPaisa,
      discount_paisa: 0,
      total_paisa: amountPaisa,
      cash_paid_paisa: amountPaisa,
      credit_paisa: 0,
      entry_hash: entryHash,
      prev_hash: prevHash,
      created_at: nowIso,
      audit_meta: (payload.audit_meta as Record<string, unknown>) ?? {},
      idempotency_key: idempotencyKey,
      is_reversed: false,
      lines: [],
    };
    feed.unshift(tx);

    return {
      nextState: {
        ...state,
        today,
        customers,
        products,
        feed,
        chain_head: { seq: nextSeq, entry_hash: entryHash },
      },
      response: {
        status: "COMMITTED",
        http: 200,
        deduplicated: false,
        duplicate_rows: 0,
        rows_for_key: 1,
        type: "payment",
        transaction_id: idempotencyKey,
        seq: nextSeq,
        prev_hash: prevHash,
        entry_hash: entryHash,
        created_at: nowIso,
        rls_shop_id: state.shop.id,
        totals: { total_paisa: amountPaisa, cash_paid_paisa: amountPaisa, credit_paisa: 0 },
        journal: [
          { account_code: "1010", account_name: "Cash in Galla", side: "DR", amount_paisa: amountPaisa },
          { account_code: "1100", account_name: "Accounts Receivable (Khata)", side: "CR", amount_paisa: amountPaisa, customer_id: cust?.id ?? null },
        ],
        delta: 0,
        warnings: [],
        customer: cust ? { id: cust.id, name: cust.name, role_tag: cust.role_tag ?? null, phone: cust.phone ?? null, balance_paisa: cust.balance_paisa } : null,
        rpc_ms: 1,
      },
    };
  }

  if (endpoint === "/api/transactions/reverse") {
    const targetId = typeof payload.transaction_id === "string" ? payload.transaction_id : null;
    const target = (targetId ? feed.find((t) => t.id === targetId) : feed.find((t) => t.type !== "reversal" && !t.is_reversed)) ?? null;
    if (target && !target.is_reversed) {
      target.is_reversed = true;
      if (target.type === "sale") {
        today.sales_count = Math.max(0, today.sales_count - 1);
        today.gross_sales_paisa = Math.max(0, today.gross_sales_paisa - target.total_paisa);
        today.cash_sales_paisa = Math.max(0, today.cash_sales_paisa - target.cash_paid_paisa);
        today.cash_in_galla_paisa -= target.cash_paid_paisa;
        today.udhaar_paisa = Math.max(0, today.udhaar_paisa - target.credit_paisa);
        if (target.customer_id && target.credit_paisa !== 0) {
          const cust = customers.find((c) => c.id === target.customer_id);
          if (cust) cust.balance_paisa -= target.credit_paisa;
        }
        for (const l of target.lines) {
          if (!l.product_id) continue;
          const prod = products.find((p) => p.id === l.product_id);
          if (prod) prod.stock_base_units += l.qty_base_units;
        }
      } else if (target.type === "payment") {
        today.wasooli_paisa = Math.max(0, today.wasooli_paisa - target.total_paisa);
        today.cash_in_galla_paisa -= target.total_paisa;
        if (target.customer_id) {
          const cust = customers.find((c) => c.id === target.customer_id);
          if (cust) cust.balance_paisa += target.total_paisa;
        }
      }
    }

    const amount = target?.total_paisa ?? 0;
    const tx: FeedTx = {
      id: idempotencyKey,
      seq: nextSeq,
      type: "reversal",
      customer_id: target?.customer_id ?? null,
      customer_name: target?.customer_name ?? null,
      customer_role: target?.customer_role ?? null,
      supplier_name: target?.supplier_name ?? null,
      reversed_transaction_id: target?.id ?? null,
      subtotal_paisa: amount,
      discount_paisa: 0,
      total_paisa: amount,
      cash_paid_paisa: target?.cash_paid_paisa ?? 0,
      credit_paisa: target?.credit_paisa ?? 0,
      entry_hash: entryHash,
      prev_hash: prevHash,
      created_at: nowIso,
      audit_meta: { reversed_type: target?.type ?? "sale" },
      idempotency_key: idempotencyKey,
      is_reversed: false,
      lines: target?.lines ?? [],
    };
    feed.unshift(tx);

    return {
      nextState: {
        ...state,
        today,
        customers,
        products,
        feed,
        chain_head: { seq: nextSeq, entry_hash: entryHash },
      },
      response: {
        status: "COMMITTED",
        http: 200,
        deduplicated: false,
        duplicate_rows: 0,
        rows_for_key: 1,
        type: "reversal",
        transaction_id: idempotencyKey,
        seq: nextSeq,
        prev_hash: prevHash,
        entry_hash: entryHash,
        created_at: nowIso,
        rls_shop_id: state.shop.id,
        totals: { total_paisa: amount, cash_paid_paisa: 0, credit_paisa: 0 },
        journal: [],
        delta: 0,
        warnings: [],
        reversed_transaction_id: target?.id,
        rpc_ms: 1,
      },
    };
  }

  // Default: purchase
  const supplierName = typeof payload.supplier_name === "string" ? payload.supplier_name : "Wholesale";
  const rawLines = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
  const txLines: FeedTx["lines"] = [];
  let total = 0;

  for (const rl of rawLines) {
    let prod = typeof rl.product_id === "string" ? products.find((p) => p.id === rl.product_id) ?? null : null;
    const qtyBase = Number(rl.qty_base_units ?? 0) || 0;
    const lineTotal = Number(rl.line_total_paisa ?? 0) || 0;
    if (!prod && rl.new_sku && typeof rl.new_sku === "object") {
      const spec = rl.new_sku as { name?: string; base_unit?: "g" | "ml" | "pcs"; pack_size_base_units?: number };
      const id = `demo-pur-${Date.now().toString(36)}-${products.length + 1}`;
      const pack = spec.pack_size_base_units ?? 1;
      const unitCost = qtyBase > 0 ? Math.round((lineTotal * pack) / qtyBase) : lineTotal;
      prod = {
        id,
        sku_code: `PUR_${products.length + 1}`,
        name: spec.name || "New Stock Item",
        name_ur: spec.name || "نیا سامان",
        base_unit: spec.base_unit ?? "pcs",
        pack_size_base_units: pack,
        unit_price_paisa: Math.round(unitCost * 1.12),
        cost_price_paisa: unitCost,
        stock_base_units: 0,
        reorder_level_base_units: pack * 5,
        aliases: [String(spec.name || "").toLowerCase()],
        is_quick_added: false,
        sold_7d: 0,
        days_left: null,
        created_at: nowIso,
        last_sold_at: null,
      };
      products.push(prod);
    }
    if (!prod) continue;
    prod.stock_base_units += qtyBase;
    prod.is_quick_added = false;
    if (qtyBase > 0 && lineTotal > 0) {
      prod.cost_price_paisa = Math.round((lineTotal * prod.pack_size_base_units) / qtyBase);
    }
    total += lineTotal;
    txLines.push({
      name: prod.name,
      qty_base_units: qtyBase,
      base_unit: prod.base_unit,
      line_total_paisa: lineTotal,
      value_first: false,
      product_id: prod.id,
    });
  }

  if (total === 0) {
    total = Number(payload.total_paisa ?? payload.stated_total_paisa ?? 0) || 0;
  }
  const cashPaid = Number(payload.cash_paid_paisa ?? total) || 0;
  const credit = Math.max(0, total - cashPaid);
  today.purchases_cash_paisa += cashPaid;
  today.cash_in_galla_paisa -= cashPaid;

  const tx: FeedTx = {
    id: idempotencyKey,
    seq: nextSeq,
    type: "purchase",
    customer_id: null,
    customer_name: null,
    customer_role: null,
    supplier_name: supplierName,
    reversed_transaction_id: null,
    subtotal_paisa: total,
    discount_paisa: 0,
    total_paisa: total,
    cash_paid_paisa: cashPaid,
    credit_paisa: credit,
    entry_hash: entryHash,
    prev_hash: prevHash,
    created_at: nowIso,
    audit_meta: (payload.audit_meta as Record<string, unknown>) ?? {},
    idempotency_key: idempotencyKey,
    is_reversed: false,
    lines: txLines,
  };
  feed.unshift(tx);

  return {
    nextState: {
      ...state,
      today,
      customers,
      products,
      feed,
      chain_head: { seq: nextSeq, entry_hash: entryHash },
    },
    response: {
      status: "COMMITTED",
      http: 200,
      deduplicated: false,
      duplicate_rows: 0,
      rows_for_key: 1,
      type: "purchase",
      transaction_id: idempotencyKey,
      seq: nextSeq,
      prev_hash: prevHash,
      entry_hash: entryHash,
      created_at: nowIso,
      rls_shop_id: state.shop.id,
      totals: { total_paisa: total, cash_paid_paisa: cashPaid, credit_paisa: credit },
      journal: [
        { account_code: "1200", account_name: "Merchandise Inventory", side: "DR", amount_paisa: total },
        ...(cashPaid > 0 ? [{ account_code: "1010", account_name: "Cash in Galla", side: "CR" as const, amount_paisa: cashPaid }] : []),
        ...(credit > 0 ? [{ account_code: "2010", account_name: "Supplier Payable", side: "CR" as const, amount_paisa: credit }] : []),
      ],
      delta: 0,
      warnings: [],
      rpc_ms: 1,
    },
  };
}
