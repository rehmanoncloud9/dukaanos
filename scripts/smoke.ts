/**
 * End-to-end API smoke test against any running DukaanOS deployment.
 * Usage: npx tsx scripts/smoke.ts [BASE_URL]
 * Flow: app-config -> sandbox -> signIn -> state -> commit_sale -> replay dedup ->
 *       reverse -> payment -> purchase -> pulse -> passport -> verify signature -> export -> delete
 */
import { createClient } from "@supabase/supabase-js";
import { verifyPassport } from "../src/lib/crypto/passport";

const baseUrl = (process.argv[2] || process.env.SMOKE_URL || "http://localhost:3000").replace(/\/$/, "");

async function reqJson<T>(path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(`${init?.method ?? "GET"} ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return { status: res.status, data };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`SMOKE ASSERTION FAILED: ${msg}`);
}

async function main() {
  const t0 = Date.now();
  console.log(`[smoke] target: ${baseUrl}`);

  // 1. Public app-config
  const { data: cfg } = await reqJson<{ min_supported_app_version: string; verify_public_key: string | null }>("/api/app-config");
  assert(Boolean(cfg.min_supported_app_version), "app-config missing min_supported_app_version");
  console.log("[smoke] 1/10 app-config OK");

  // 2. Create fresh isolated sandbox
  const { data: sb } = await reqJson<{ email: string; password: string; shop_id: string }>("/api/demo/sandbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  console.log(`[smoke] 2/10 sandbox created (${sb.shop_id})`);

  // 3. Sign in via Supabase Auth
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  assert(supabaseUrl && supabaseAnon, "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY required");
  const client = createClient(supabaseUrl!, supabaseAnon!);
  const signIn = await client.auth.signInWithPassword({ email: sb.email, password: sb.password });
  assert(!signIn.error && signIn.data.session?.access_token, `signIn failed: ${signIn.error?.message}`);
  const token = signIn.data.session!.access_token;
  const authHeaders = {
    authorization: `Bearer ${token}`,
    "x-shop-id": sb.shop_id,
    "content-type": "application/json",
  };
  console.log("[smoke] 3/10 Supabase Auth sign-in OK");

  // 4. Load shop state
  const { data: state } = await reqJson<{
    customers: Array<{ id: string; name: string }>;
    products: Array<{ id: string; name: string }>;
  }>("/api/shop/state", { headers: authHeaders });
  assert(state.customers.length > 0 && state.products.length > 0, "seeded sandbox missing customers/products");
  const custId = state.customers[0].id;
  const prodId = state.products[0].id;
  console.log("[smoke] 4/10 /api/shop/state OK");

  // 5. Commit sale + Replay dedup
  const saleKey = `smoke-sale-${Date.now()}`;
  const salePayload = {
    idempotency_key: saleKey,
    customer_id: custId,
    discount_paisa: 0,
    cash_paid_paisa: 0,
    lines: [{ product_id: prodId, qty_base_units: 1000 }],
    audit_meta: { source: "smoke" },
  };
  const { data: sale1 } = await reqJson<{ status: string; transaction_id: string }>("/api/transactions/commit", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(salePayload),
  });
  assert(sale1.status === "COMMITTED", `expected COMMITTED, got ${sale1.status}`);

  const { data: sale2 } = await reqJson<{ status: string; deduplicated: boolean; duplicate_rows: number }>("/api/transactions/commit", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(salePayload),
  });
  assert(sale2.status === "REPLAY_DEDUPLICATED" && sale2.deduplicated && sale2.duplicate_rows === 0, "replay dedup failed");
  console.log("[smoke] 5/10 commit_sale + replay dedup OK");

  // 6. Reverse sale
  const { data: rev } = await reqJson<{ status: string }>("/api/transactions/reverse", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ idempotency_key: `smoke-rev-${Date.now()}`, transaction_id: sale1.transaction_id, audit_meta: {} }),
  });
  assert(rev.status === "COMMITTED", "reverse failed");
  console.log("[smoke] 6/10 reverse_transaction OK");

  // 7. Payment (Wasooli) & Purchase (Restock)
  await reqJson("/api/transactions/payment", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ idempotency_key: `smoke-pay-${Date.now()}`, customer_id: custId, amount_paisa: 5000, audit_meta: {} }),
  });
  await reqJson("/api/transactions/purchase", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      idempotency_key: `smoke-pur-${Date.now()}`,
      supplier_name: "Smoke Wholesale",
      cash_paid_paisa: 10000,
      lines: [{ product_id: prodId, qty_base_units: 1000, line_total_paisa: 10000 }],
      audit_meta: {},
    }),
  });
  console.log("[smoke] 7/10 payment + purchase OK");

  // 8. Pulse & Paginated feed
  await reqJson("/api/shop/pulse", { headers: authHeaders });
  await reqJson("/api/shop/feed?limit=10", { headers: authHeaders });
  console.log("[smoke] 8/10 pulse + feed OK");

  // 9. Trade summary passport + Ed25519 signature verification
  const { data: passport } = await reqJson<{ token: string; public_key_hex: string; chain: { ok: boolean } }>(
    "/api/reports/trade-summary?days=30",
    { headers: authHeaders },
  );
  assert(passport.chain.ok, "ledger chain not ok");
  const verified = await verifyPassport(passport.token, passport.public_key_hex);
  assert(verified.valid, "passport Ed25519 verification failed");
  console.log("[smoke] 9/10 passport + Ed25519 verify OK");

  // 10. Account export + delete
  const { data: exported } = await reqJson<{ shops_count: number }>("/api/account/export", { headers: authHeaders });
  assert(exported.shops_count >= 1, "export returned 0 shops");
  const { data: deleted } = await reqJson<{ ok: boolean; deleted_shops: number }>("/api/account/delete", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({}),
  });
  assert(deleted.ok && deleted.deleted_shops === 1, "account delete failed");
  console.log(`[smoke] 10/10 export + account delete OK (${Date.now() - t0} ms total)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
