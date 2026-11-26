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
    expect(idx.score).toBeGreaterThanOrEqual(70);
    expect(idx.score).toBeLessThanOrEqual(100);
    expect(idx.breakdown.chain).toBe(25);
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
