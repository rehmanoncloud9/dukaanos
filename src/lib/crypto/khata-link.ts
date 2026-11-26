/**
 * Mutual Khata customer link — a stateless, Ed25519-signed capability for ONE customer of ONE shop.
 * Format: base64url(canonical JSON) "." base64url(signature), signed with the same server key as the
 * SMEConnect passport. It grants exactly: read that customer's statement, and confirm/dispute/promise/
 * claim-payment on it. Revocation: bump customers.link_nonce (rotate_customer_link).
 */
import * as ed from "@noble/ed25519";
import { b64urlDecode, b64urlEncode, canonicalJson, hexToBytes } from "./passport";

export interface KhataLinkClaims {
  v: 1;
  k: "khata";
  s: string; // shop id
  c: string; // customer id
  n: number; // customers.link_nonce at issue time
  e: number; // expiry (unix seconds)
}

export const KHATA_LINK_TTL_S = 30 * 86400;

const enc = new TextEncoder();
const dec = new TextDecoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function signKhataLink(
  input: { shopId: string; customerId: string; nonce: number },
  privHex: string,
  now = Date.now(),
): Promise<{ token: string; claims: KhataLinkClaims }> {
  const claims: KhataLinkClaims = {
    v: 1,
    k: "khata",
    s: input.shopId,
    c: input.customerId,
    n: input.nonce,
    e: Math.floor(now / 1000) + KHATA_LINK_TTL_S,
  };
  const msg = enc.encode(canonicalJson(claims));
  const sig = await ed.signAsync(msg, hexToBytes(privHex));
  return { token: `${b64urlEncode(msg)}.${b64urlEncode(sig)}`, claims };
}

export type KhataLinkResult =
  | { ok: true; claims: KhataLinkClaims }
  | { ok: false; reason: "MALFORMED" | "NON_CANONICAL" | "BAD_SIGNATURE" | "EXPIRED" | "WRONG_KIND" };

export async function verifyKhataLink(token: string, pubHex: string, now = Date.now()): Promise<KhataLinkResult> {
  try {
    const [p, s] = token.trim().split(".");
    if (!p || !s || p.length > 2048 || s.length > 200) return { ok: false, reason: "MALFORMED" };
    const msg = b64urlDecode(p);
    const raw = dec.decode(msg);
    const claims = JSON.parse(raw) as KhataLinkClaims;
    if (canonicalJson(claims) !== raw) return { ok: false, reason: "NON_CANONICAL" };
    if (claims.v !== 1 || claims.k !== "khata" || !UUID.test(claims.s) || !UUID.test(claims.c) || !Number.isInteger(claims.n)) {
      return { ok: false, reason: "WRONG_KIND" };
    }
    const valid = await ed.verifyAsync(b64urlDecode(s), msg, hexToBytes(pubHex));
    if (!valid) return { ok: false, reason: "BAD_SIGNATURE" };
    if (!Number.isInteger(claims.e) || claims.e * 1000 < now) return { ok: false, reason: "EXPIRED" };
    return { ok: true, claims };
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
}
