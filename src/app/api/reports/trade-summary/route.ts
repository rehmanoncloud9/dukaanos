import { signPassport, toPayload, type TradeSummary } from "@/lib/crypto/passport";
import { ApiError, handle, ok } from "@/lib/api/http";
import { numify } from "@/lib/api/shop";
import { env } from "@/lib/env";
import { rpc, shopContext } from "@/lib/supabase/server";

export const maxDuration = 60;

const DISCLAIMER =
  "Owner-consented 30-day trade summary aligned with SBP SMEConnect (Nov 1, 2026). Informational only — not a credit score, underwriting decision, tax filing or Shariah certification.";

/**
 * GET /api/reports/trade-summary?days=30 — aggregates the hash-chained ledger and signs the
 * summary + latest SHA-256 entry_hash with the server's Ed25519 key. The QR links to /verify,
 * which checks the signature client-side against the pinned public key.
 */
export const GET = handle(async (req: Request) => {
  const t0 = Date.now();
  const { sb, shopId } = shopContext(req);
  const days = Math.min(90, Math.max(7, Number(new URL(req.url).searchParams.get("days") ?? 30) || 30));
  const priv = env.ed25519PrivateKey();
  if (!priv) throw new ApiError("SERVER_MISCONFIGURED", "ED25519_PRIVATE_KEY missing — run npm run setup");

  const [summary, chain] = await Promise.all([
    rpc<TradeSummary>(sb, "get_trade_summary", { p_shop_id: shopId, p_days: days }).then(numify),
    rpc<{ ok: boolean; code: string; checked: number }>(sb, "verify_ledger_chain", { p_shop_id: shopId }),
  ]);
  if (!chain.ok) throw new ApiError("CHAIN_BROKEN", "Ledger hash chain failed verification — passport not issued", chain);

  const payload = toPayload(summary);
  const signed = await signPassport(payload, priv);
  const base = env.appUrl().replace(/\/$/, "");
  return ok({
    summary,
    payload,
    token: signed.token,
    verify_url: `${base}/verify#${signed.token}`,
    signature_hex: signed.signature_hex,
    public_key_hex: signed.public_key_hex,
    chain: { ok: chain.ok, checked: chain.checked },
    disclaimer: DISCLAIMER,
    api_ms: Date.now() - t0,
  });
});
