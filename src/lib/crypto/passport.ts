/**
 * Ed25519 SMEConnect Trade Passport — isomorphic (server signs, any phone verifies).
 * QR content: {APP_URL}/verify#<base64url(canonical JSON)>.<base64url(signature)>
 * The fragment never reaches a server, so verification is fully client-side and offline-capable.
 */
import * as ed from "@noble/ed25519";

export interface TradeSummary {
  shop_id: string;
  shop_name: string;
  city: string | null;
  active_days: number;
  period_days: number;
  period_from: string;
  period_to: string;
  gmv_paisa: number;
  sales_count: number;
  cash_sales_paisa: number;
  credit_sales_paisa: number;
  recovered_paisa: number;
  purchases_paisa: number;
  active_trading_days: number;
  receivable_paisa: number;
  ledger_balanced: boolean;
  tx_count_total: number;
  head_entry_hash: string;
  passport_nonce?: number;
  /** Mutual Khata: what CUSTOMERS attested (two-party evidence). Absent before migration 20261126101. */
  bharosa?: {
    credit_entries: number;
    credit_entries_paisa: number;
    confirmed_entries: number;
    confirmed_paisa: number;
    disputed_entries: number;
    promises_due: number;
    promises_kept: number;
    attestations_total: number;
    attestation_head_hash: string;
  } | null;
}

/** Compact, signed claim. Keys are short to keep the QR scannable on a projector. */
export interface PassportPayload {
  v: 1 | 2; // 2 = carries Mutual Khata (customer-attested) metrics
  vr_bp?: number; // verified receivables: customer-confirmed credit paisa / credit paisa (bp)
  dr_bp?: number; // dispute rate: disputed / credit entries (bp)
  pk_bp?: number; // promise-kept rate (bp); absent when no wada fell due
  att?: number; // customer attestations in the chain
  ah?: string; // attestation-chain head hash (first 16 hex)
  iss: "DukaanOS";
  sid: string; // shop id (first 8)
  n: string; // shop name
  c: string | null; // city
  ad: number; // active days
  pd: number; // period days
  f: string; // from (YYYY-MM-DD)
  t: string; // to (YYYY-MM-DD)
  gmv: number; // paisa
  sc: number; // sales count
  cash_bp: number; // cash share in basis points
  rec_bp: number; // recovery rate in basis points
  td: number; // active trading days
  lb: 0 | 1; // ledger balanced
  txn: number; // chain length
  h: string; // head SHA-256 entry_hash
  pn?: number; // passport revocation nonce
  iat: number; // issued at (unix s)
}

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2) throw new Error("invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toPayload(s: TradeSummary, now = new Date()): PassportPayload {
  const gmv = Number(s.gmv_paisa);
  const credit = Number(s.credit_sales_paisa);
  const recovered = Number(s.recovered_paisa);
  const b = s.bharosa;
  const bharosa: Partial<PassportPayload> = {};
  if (b) {
    const creditPaisa = Number(b.credit_entries_paisa);
    const creditN = Number(b.credit_entries);
    const due = Number(b.promises_due);
    bharosa.vr_bp = creditPaisa > 0 ? Math.min(10000, Math.round((Number(b.confirmed_paisa) * 10000) / creditPaisa)) : 0;
    bharosa.dr_bp = creditN > 0 ? Math.round((Number(b.disputed_entries) * 10000) / creditN) : 0;
    if (due > 0) bharosa.pk_bp = Math.round((Number(b.promises_kept) * 10000) / due);
    bharosa.att = Number(b.attestations_total);
    bharosa.ah = String(b.attestation_head_hash).slice(0, 16);
  }
  return {
    ...bharosa,
    v: b ? 2 : 1,
    iss: "DukaanOS",
    sid: s.shop_id.slice(0, 8),
    n: s.shop_name,
    c: s.city,
    ad: Number(s.active_days),
    pd: Number(s.period_days),
    f: String(s.period_from).slice(0, 10),
    t: String(s.period_to).slice(0, 10),
    gmv,
    sc: Number(s.sales_count),
    cash_bp: gmv > 0 ? Math.round((Number(s.cash_sales_paisa) * 10000) / gmv) : 0,
    rec_bp: credit > 0 ? Math.min(10000, Math.round((recovered * 10000) / credit)) : 10000,
    td: Number(s.active_trading_days),
    lb: s.ledger_balanced ? 1 : 0,
    txn: Number(s.tx_count_total),
    h: s.head_entry_hash,
    ...(s.passport_nonce !== undefined ? { pn: Number(s.passport_nonce) } : {}),
    iat: Math.floor(now.getTime() / 1000),
  };
}

export async function publicKeyFromPrivate(privHex: string): Promise<string> {
  return bytesToHex(await ed.getPublicKeyAsync(hexToBytes(privHex)));
}

export async function signPassport(payload: PassportPayload, privHex: string): Promise<{ token: string; signature_hex: string; public_key_hex: string }> {
  const msg = enc.encode(canonicalJson(payload));
  const sig = await ed.signAsync(msg, hexToBytes(privHex));
  return {
    token: `${b64urlEncode(msg)}.${b64urlEncode(sig)}`,
    signature_hex: bytesToHex(sig),
    public_key_hex: await publicKeyFromPrivate(privHex),
  };
}

export interface VerifyResult {
  valid: boolean;
  payload: PassportPayload | null;
  reason?: string;
  verify_ms: number;
}

export async function verifyPassport(token: string, pubHex: string): Promise<VerifyResult> {
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const t0 = clock();
  const done = (r: Omit<VerifyResult, "verify_ms">): VerifyResult => ({ ...r, verify_ms: Math.round((clock() - t0) * 100) / 100 });
  try {
    const [p, s] = token.trim().replace(/^#/, "").split(".");
    if (!p || !s) return done({ valid: false, payload: null, reason: "MALFORMED" });
    const msg = b64urlDecode(p);
    const sig = b64urlDecode(s);
    const payload = JSON.parse(dec.decode(msg)) as PassportPayload;
    // the signed bytes must be the canonical form of the payload (no re-ordering tricks)
    if (canonicalJson(payload) !== dec.decode(msg)) return done({ valid: false, payload, reason: "NON_CANONICAL" });
    const valid = await ed.verifyAsync(sig, msg, hexToBytes(pubHex));
    return done({ valid, payload, reason: valid ? undefined : "BAD_SIGNATURE" });
  } catch (e) {
    return done({ valid: false, payload: null, reason: e instanceof Error ? e.message : "INVALID" });
  }
}

export async function generateKeypairHex(): Promise<{ privateKey: string; publicKey: string }> {
  const sk = ed.utils.randomSecretKey();
  const pk = await ed.getPublicKeyAsync(sk);
  return { privateKey: bytesToHex(sk), publicKey: bytesToHex(pk) };
}

export interface BharosaIndex {
  score: number; // 0..100 informational trade trust index
  /**
   * Phase C split:
   *   Verified Trust (0–60): chain integrity + customer attestations + wholesale-backed restock
   *   Self-Reported Activity (0–40): trading consistency + recovery rate
   */
  breakdown: {
    // Verified Trust sub-scores (60 pts total)
    chain: number;        // 0–20: SHA-256 chain balanced + length signal
    attestations: number; // 0–25: customer-confirmed credit entries (requires real attestations)
    wholesale: number;    // 0–15: wholesale-backed purchase entries (parchi-verified)
    // Self-Reported Activity sub-scores (40 pts total)
    consistency: number;  // 0–20: trading-day regularity
    recovery: number;     // 0–20: credit recovery rate
  };
  verified_trust: number;      // sum of chain + attestations + wholesale (0–60)
  self_reported: number;       // sum of consistency + recovery (0–40)
}

/** Deterministic 0–100 trade trust index from observable ledger & Mutual Khata signals.
 *
 * Anti-gaming guarantee: zero free baseline points when attestations === 0.
 * The 25-pt attestation bucket requires real customer-signed confirmations.
 */
export function computeBharosaIndex(s: TradeSummary): BharosaIndex {
  const period = Math.max(1, s.period_days);
  const tradingDays = Math.max(0, s.active_trading_days);
  const target = Math.min(period, 20); // normalise against up to 20 trading days

  // ── Self-Reported Activity (40 pts) ─────────────────────────────────────────
  const consistency = Math.min(20, Math.round((tradingDays / target) * 20));
  const recovery = s.credit_sales_paisa <= 0
    ? 20 // no credit given → no recovery risk → full score
    : Math.min(20, Math.round((Number(s.recovered_paisa) / Number(s.credit_sales_paisa)) * 20));

  // ── Verified Trust (60 pts) ──────────────────────────────────────────────────

  // Chain integrity (0–20): balanced ledger earns 15; additional 5 for chain length ≥ 50
  const chain = s.ledger_balanced
    ? (Number(s.tx_count_total) >= 50 ? 20 : 15)
    : 0;

  // Customer attestations (0–25): requires real customer-signed confirmations.
  // Zero free baseline — the whole 25 pts comes from attestation evidence.
  let attestations = 0;
  if (s.bharosa && s.bharosa.credit_entries > 0) {
    const creditN = Number(s.bharosa.credit_entries);
    const confirmN = Number(s.bharosa.confirmed_entries);
    const disputeN = Number(s.bharosa.disputed_entries);
    const att = Number(s.bharosa.attestations_total);
    if (att > 0) {
      const confirmRatio = confirmN / creditN;
      const disputePenalty = Math.min(10, disputeN * 5);
      attestations = Math.max(0, Math.min(25, Math.round(confirmRatio * 25) - disputePenalty));
    }
    // attestations stays 0 when no customer has attested anything
  }

  // Wholesale-backed purchasing (0–15): purchase transactions backed by parchi OCR
  // Proxy: purchases_paisa > 0 suggests real wholesale; we scale against GMV.
  let wholesale = 0;
  if (Number(s.purchases_paisa) > 0 && Number(s.gmv_paisa) > 0) {
    const purchaseRatio = Math.min(1, Number(s.purchases_paisa) / Number(s.gmv_paisa));
    wholesale = Math.min(15, Math.round(purchaseRatio * 15));
  }

  const verified_trust = chain + attestations + wholesale;
  const self_reported = consistency + recovery;
  const score = verified_trust + self_reported;

  return {
    score: Math.min(100, score),
    breakdown: { chain, attestations, wholesale, consistency, recovery },
    verified_trust,
    self_reported,
  };
}
