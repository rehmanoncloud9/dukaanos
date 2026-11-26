import { z } from "zod";
import { ApiError, handle, ok, parseJson } from "@/lib/api/http";
import { numify } from "@/lib/api/shop";
import { signKhataLink, verifyKhataLink, type KhataLinkClaims } from "@/lib/crypto/khata-link";
import { publicKeyFromPrivate } from "@/lib/crypto/passport";
import { mutualKhataText, smsLink, waLink } from "@/lib/domain/messages";
import { env } from "@/lib/env";
import { requireShopContext } from "@/lib/server/auth";
import { enforceRateLimit, getClientIp } from "@/lib/server/ratelimit";
import { adminClient, rpc } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * Mutual Khata (Bharosa Layer).
 *   POST /api/khata/link       (shopkeeper)  → Ed25519-signed customer link + self-contained wa.me / sms: text
 *   GET  /api/khata/statement  (public, ?t=) → that customer's udhaar statement
 *   POST /api/khata/attest     (public, t)   → customer confirm | dispute | promise | paid_claim
 *   GET  /api/khata/overview   (shopkeeper)  → per-customer badges for the Khata tab
 *   POST /api/khata/raast      (shopkeeper)  → set the shop's Raast ID / IBAN
 *   POST /api/khata/rotate     (shopkeeper)  → revoke every outstanding link for one customer
 * Only the signed link can speak for the customer: attestations are written by service_role
 * after verification, and record_attestation refuses customer-kinds from shop members.
 */

type Ctx = { params: Promise<{ action: string }> };

interface Statement {
  shop: { id: string; name: string; city: string | null; raast_id: string | null };
  customer: { id: string; name: string; balance_paisa: number; last_paid_at: string | null; link_nonce: number };
  entries: Array<{ transaction_id: string; seq: number; type: string; created_at: string; total_paisa: number; credit_paisa: number; cash_paid_paisa: number; entry_hash: string; summary: string | null; status: string }>;
  promise: { promise_date: string; state: "open" | "kept" | "broken"; source: string } | null;
  paid_claims: Array<{ attestation_id: string; amount_paisa: number; created_at: string }>;
}

let pubKeyCache: string | null = null;
async function signingKeys() {
  const priv = env.ed25519PrivateKey();
  if (!priv) throw new ApiError("SERVER_MISCONFIGURED", "ED25519_PRIVATE_KEY missing — run npm run setup");
  pubKeyCache ??= await publicKeyFromPrivate(priv);
  return { priv, pub: pubKeyCache };
}

/** Verify the link AND that it has not been revoked (nonce matches the customer's current one). */
async function resolveLink(token: string | null | undefined): Promise<{ claims: KhataLinkClaims; statement: Statement }> {
  if (!token) throw new ApiError("AUTH_REQUIRED", "Link missing");
  const { pub } = await signingKeys();
  const r = await verifyKhataLink(token, pub);
  if (!r.ok) throw new ApiError(r.reason === "EXPIRED" ? "LINK_EXPIRED" : "LINK_INVALID", `Khata link ${r.reason.toLowerCase()}`);
  const statement = numify(await rpc<Statement>(adminClient(), "get_customer_statement", {
    p_shop_id: r.claims.s, p_customer_id: r.claims.c, p_limit: 30,
  }));
  if (Number(statement.customer.link_nonce) !== r.claims.n) throw new ApiError("LINK_REVOKED", "This khata link was replaced by a newer one");
  return { claims: r.claims, statement };
}

/** What the public page may see: no ids beyond what it needs, hashes shortened. */
function publicView(s: Statement) {
  return {
    shop: { name: s.shop.name, city: s.shop.city, raast_id: s.shop.raast_id },
    customer: { name: s.customer.name, balance_paisa: s.customer.balance_paisa, last_paid_at: s.customer.last_paid_at },
    entries: s.entries.map((e) => ({
      transaction_id: e.transaction_id, type: e.type, created_at: e.created_at, total_paisa: e.total_paisa,
      credit_paisa: e.credit_paisa, cash_paid_paisa: e.cash_paid_paisa, summary: e.summary, status: e.status,
      hash: e.entry_hash.slice(0, 10),
    })),
    promise: s.promise,
    paid_claims: s.paid_claims.map((c) => ({ amount_paisa: c.amount_paisa, created_at: c.created_at })),
  };
}

export type KhataPublicView = ReturnType<typeof publicView>;

const LinkBody = z.object({ customer_id: z.string().uuid(), transaction_id: z.string().uuid().optional() });
const AttestBody = z.object({
  t: z.string().min(20).max(2400),
  idempotency_key: z.string().min(8).max(80),
  kind: z.enum(["confirm", "dispute", "promise", "paid_claim"]),
  transaction_id: z.string().uuid().optional(),
  promise_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount_paisa: z.number().int().positive().max(100_000_000).optional(),
  note: z.string().max(280).optional(),
});
const PromiseBody = z.object({
  customer_id: z.string().uuid(),
  promise_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  idempotency_key: z.string().min(8).max(80),
  note: z.string().max(280).optional(),
});
const RaastBody =z.object({ raast_id: z.string().max(40).nullable() });
const RotateBody = z.object({ customer_id: z.string().uuid() });

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { action } = await ctx.params;

  if (action === "statement") {
    await enforceRateLimit(`khata_view:${getClientIp(req)}`, 240, "1 hour");
    const { statement } = await resolveLink(new URL(req.url).searchParams.get("t"));
    return ok(publicView(statement), { headers: { "cache-control": "no-store" } });
  }

  if (action === "overview") {
    const { sb, shopId } = await requireShopContext(req);
    return ok(numify(await rpc(sb, "get_bharosa_overview", { p_shop_id: shopId })));
  }

  throw new ApiError("BAD_REQUEST", `Unknown khata action "${action}"`, undefined, 404);
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { action } = await ctx.params;

  if (action === "attest") {
    const b = await parseJson(req, AttestBody);
    await enforceRateLimit(`khata_attest_ip:${getClientIp(req)}`, 120, "1 hour");
    const { claims } = await resolveLink(b.t);
    await enforceRateLimit(`khata_attest:${claims.c}`, 40, "1 hour");
    const res = await rpc(adminClient(), "record_attestation", {
      p_shop_id: claims.s,
      p_customer_id: claims.c,
      p_payload: {
        idempotency_key: `cust:${claims.c}:${b.idempotency_key}`,
        kind: b.kind,
        source: "customer",
        transaction_id: b.transaction_id ?? null,
        promise_date: b.promise_date ?? null,
        amount_paisa: b.amount_paisa ?? 0,
        note: b.note ?? null,
      },
    });
    const fresh = numify(await rpc<Statement>(adminClient(), "get_customer_statement", {
      p_shop_id: claims.s, p_customer_id: claims.c, p_limit: 30,
    }));
    return ok({ attestation: res, statement: publicView(fresh) });
  }

  if (action === "link") {
    const { sb, shopId } = await requireShopContext(req);
    const b = await parseJson(req, LinkBody);
    await enforceRateLimit(`khata_link:${shopId}`, 300, "1 hour");
    const s = numify(await rpc<Statement>(sb, "get_customer_statement", { p_shop_id: shopId, p_customer_id: b.customer_id, p_limit: 30 }));
    const { priv } = await signingKeys();
    const { token, claims } = await signKhataLink({ shopId, customerId: b.customer_id, nonce: Number(s.customer.link_nonce) }, priv);
    const url = `${env.appUrl().replace(/\/$/, "")}/k/${token}`;
    const entry = b.transaction_id ? s.entries.find((e) => e.transaction_id === b.transaction_id) : s.entries.find((e) => e.credit_paisa > 0);
    const phoneRow = await sb.from("customers").select("phone").eq("id", b.customer_id).eq("shop_id", shopId).maybeSingle();
    const phone = (phoneRow.data as { phone: string | null } | null)?.phone ?? null;
    const text = mutualKhataText({
      name: s.customer.name,
      shop: s.shop.name,
      balance_paisa: s.customer.balance_paisa,
      url,
      entry: entry ? { summary: entry.summary, credit_paisa: entry.credit_paisa } : null,
      raast_id: s.shop.raast_id,
    });
    return ok({ url, token, expires_at: new Date(claims.e * 1000).toISOString(), text, wa: waLink(phone, text), sms: smsLink(phone, text) });
  }

  if (action === "promise") {
    // Shopkeeper records a wada the customer gave verbally. record_attestation stamps it
    // source = 'shopkeeper' for members, so it can never masquerade as a customer confirmation.
    const { sb, shopId } = await requireShopContext(req);
    const b = await parseJson(req, PromiseBody);
    return ok(await rpc(sb, "record_attestation", {
      p_shop_id: shopId,
      p_customer_id: b.customer_id,
      p_payload: { idempotency_key: b.idempotency_key, kind: "promise", promise_date: b.promise_date, note: b.note ?? null },
    }));
  }

  if (action === "raast") {
    const { sb, shopId } = await requireShopContext(req);
    const b = await parseJson(req, RaastBody);
    return ok(await rpc(sb, "update_shop_raast", { p_shop_id: shopId, p_raast_id: b.raast_id }));
  }

  if (action === "rotate") {
    const { sb, shopId } = await requireShopContext(req);
    const b = await parseJson(req, RotateBody);
    return ok(await rpc(sb, "rotate_customer_link", { p_shop_id: shopId, p_customer_id: b.customer_id }));
  }

  throw new ApiError("BAD_REQUEST", `Unknown khata action "${action}"`, undefined, 404);
});
