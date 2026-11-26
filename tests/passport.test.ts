import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, canonicalJson, computeBharosaIndex, generateKeypairHex, signPassport, toPayload, verifyPassport, type TradeSummary } from "@/lib/crypto/passport";

const summary: TradeSummary = {
  shop_id: "0f6a3b6e-1111-4222-8333-444455556666",
  shop_name: "Bismillah Kiryana",
  city: "G-10 Markaz, Islamabad",
  active_days: 142,
  period_days: 30,
  period_from: "2026-10-25T00:00:00Z",
  period_to: "2026-11-24T00:00:00Z",
  gmv_paisa: 124_000_00,
  sales_count: 210,
  cash_sales_paisa: 91_760_00,
  credit_sales_paisa: 32_240_00,
  recovered_paisa: 29_470_00,
  purchases_paisa: 26_190_00,
  active_trading_days: 14,
  receivable_paisa: 9_300_00,
  ledger_balanced: true,
  tx_count_total: 192,
  head_entry_hash: "9f8a7c12".padEnd(64, "0"),
};

describe("Ed25519 SMEConnect passport", () => {
  it("signs and verifies a canonical payload", async () => {
    const kp = await generateKeypairHex();
    const p = toPayload(summary);
    expect(p.cash_bp).toBe(7400);
    const s = await signPassport(p, kp.privateKey);
    expect(s.public_key_hex).toBe(kp.publicKey);
    const v = await verifyPassport(s.token, kp.publicKey);
    expect(v.valid).toBe(true);
    expect(v.payload?.n).toBe("Bismillah Kiryana");
  });

  it("rejects a tampered GMV", async () => {
    const kp = await generateKeypairHex();
    const s = await signPassport(toPayload(summary), kp.privateKey);
    const [p, sig] = s.token.split(".");
    const obj = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
    obj.gmv *= 2;
    const forged = `${b64urlEncode(new TextEncoder().encode(canonicalJson(obj)))}.${sig}`;
    const v = await verifyPassport(forged, kp.publicKey);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("BAD_SIGNATURE");
  });

  it("rejects the wrong key and malformed tokens", async () => {
    const a = await generateKeypairHex();
    const b = await generateKeypairHex();
    const s = await signPassport(toPayload(summary), a.privateKey);
    expect((await verifyPassport(s.token, b.publicKey)).valid).toBe(false);
    expect((await verifyPassport("garbage", a.publicKey)).reason).toBe("MALFORMED");
  });

  it("computes deterministic Bharosa Trust Index (0..100)", () => {
    const idx = computeBharosaIndex(summary);
    expect(idx.score).toBeGreaterThanOrEqual(0);
    expect(idx.score).toBeLessThanOrEqual(100);
    // ledger balanced + tx_count >= 50 → chain = 20
    expect(idx.breakdown.chain).toBe(20);
    // verified_trust + self_reported === score
    expect(idx.verified_trust + idx.self_reported).toBe(idx.score);
  });
});

describe("Phase C Bharosa Index — anti-gaming split (Verified Trust 0–60 / Self-Reported 0–40)", () => {
  it("returns 0 attestation pts when attestations_total === 0 (anti-gaming guard)", () => {
    const s: TradeSummary = {
      ...summary,
      bharosa: {
        credit_entries: 20,
        credit_entries_paisa: 32_240_00,
        confirmed_entries: 15,
        confirmed_paisa: 24_000_00,
        disputed_entries: 0,
        promises_due: 0,
        promises_kept: 0,
        attestations_total: 0, // no customer has attested — zero free pts
        attestation_head_hash: "00".repeat(32),
      },
    };
    const idx = computeBharosaIndex(s);
    expect(idx.breakdown.attestations).toBe(0);
  });

  it("gives full 25 attestation pts with 100% confirmation and no disputes", () => {
    const s: TradeSummary = {
      ...summary,
      bharosa: {
        credit_entries: 10,
        credit_entries_paisa: 20_000_00,
        confirmed_entries: 10,
        confirmed_paisa: 20_000_00,
        disputed_entries: 0,
        promises_due: 0,
        promises_kept: 0,
        attestations_total: 10,
        attestation_head_hash: "ab".repeat(32),
      },
    };
    const idx = computeBharosaIndex(s);
    expect(idx.breakdown.attestations).toBe(25);
  });

  it("penalises disputes (5 pts each, max 10 penalty)", () => {
    const s: TradeSummary = {
      ...summary,
      bharosa: {
        credit_entries: 10,
        credit_entries_paisa: 20_000_00,
        confirmed_entries: 10,
        confirmed_paisa: 20_000_00,
        disputed_entries: 2, // -10 pts penalty
        promises_due: 0,
        promises_kept: 0,
        attestations_total: 5,
        attestation_head_hash: "cd".repeat(32),
      },
    };
    const idx = computeBharosaIndex(s);
    // confirmRatio=1 → 25; disputePenalty=min(10,10)=10 → 15
    expect(idx.breakdown.attestations).toBe(15);
  });

  it("chain=20 when balanced and tx_count >= 50", () => {
    const s: TradeSummary = { ...summary, ledger_balanced: true, tx_count_total: 50 };
    expect(computeBharosaIndex(s).breakdown.chain).toBe(20);
  });

  it("chain=15 when balanced but tx_count < 50", () => {
    const s: TradeSummary = { ...summary, ledger_balanced: true, tx_count_total: 49 };
    expect(computeBharosaIndex(s).breakdown.chain).toBe(15);
  });

  it("chain=0 when ledger is unbalanced", () => {
    const s: TradeSummary = { ...summary, ledger_balanced: false };
    expect(computeBharosaIndex(s).breakdown.chain).toBe(0);
  });

  it("gives full 20 recovery pts when no credit given (zero credit risk)", () => {
    const s: TradeSummary = { ...summary, credit_sales_paisa: 0, recovered_paisa: 0 };
    expect(computeBharosaIndex(s).breakdown.recovery).toBe(20);
  });

  it("score never exceeds 100", () => {
    const s: TradeSummary = {
      ...summary,
      ledger_balanced: true,
      tx_count_total: 500,
      credit_sales_paisa: 100_000_00,
      recovered_paisa: 100_000_00,
      purchases_paisa: 100_000_00,
      active_trading_days: 30,
      period_days: 30,
      bharosa: {
        credit_entries: 100,
        credit_entries_paisa: 100_000_00,
        confirmed_entries: 100,
        confirmed_paisa: 100_000_00,
        disputed_entries: 0,
        promises_due: 10,
        promises_kept: 10,
        attestations_total: 100,
        attestation_head_hash: "ff".repeat(32),
      },
    };
    const idx = computeBharosaIndex(s);
    expect(idx.score).toBeLessThanOrEqual(100);
  });

  it("verified_trust + self_reported === score", () => {
    const idx = computeBharosaIndex(summary);
    expect(idx.verified_trust + idx.self_reported).toBe(idx.score);
  });

  it("verified_trust <= 60 and self_reported <= 40", () => {
    const s: TradeSummary = {
      ...summary,
      bharosa: {
        credit_entries: 50,
        credit_entries_paisa: 50_000_00,
        confirmed_entries: 50,
        confirmed_paisa: 50_000_00,
        disputed_entries: 0,
        promises_due: 5,
        promises_kept: 5,
        attestations_total: 50,
        attestation_head_hash: "ae".repeat(32),
      },
    };
    const idx = computeBharosaIndex(s);
    expect(idx.verified_trust).toBeLessThanOrEqual(60);
    expect(idx.self_reported).toBeLessThanOrEqual(40);
  });

  it("wholesale pts scale with purchase/GMV ratio", () => {
    // purchases_paisa / gmv_paisa = 26190 / 124000 ≈ 0.211 → ~3 pts
    const idx = computeBharosaIndex(summary);
    expect(idx.breakdown.wholesale).toBeGreaterThan(0);
    expect(idx.breakdown.wholesale).toBeLessThanOrEqual(15);
  });
});

describe("Passport v2 — Mutual Khata metrics", () => {
  it("signs customer-attested receivables and stays verifiable", async () => {
    const kp = await generateKeypairHex();
    const p = toPayload({
      ...summary,
      bharosa: {
        credit_entries: 20, credit_entries_paisa: 32_240_00, confirmed_entries: 13, confirmed_paisa: 21_600_80,
        disputed_entries: 1, promises_due: 4, promises_kept: 3, attestations_total: 18, attestation_head_hash: "ab".repeat(32),
      },
    });
    expect(p.v).toBe(2);
    expect(p.vr_bp).toBe(6700);
    expect(p.dr_bp).toBe(500);
    expect(p.pk_bp).toBe(7500);
    expect(p.att).toBe(18);
    expect(p.ah).toBe("ab".repeat(8));
    const s = await signPassport(p, kp.privateKey);
    expect((await verifyPassport(s.token, kp.publicKey)).valid).toBe(true);
  });
  it("keeps v1 when no attestation data exists", () => {
    const p = toPayload(summary);
    expect(p.v).toBe(1);
    expect(p.vr_bp).toBeUndefined();
  });
});
