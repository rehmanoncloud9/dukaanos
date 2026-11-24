import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, canonicalJson, generateKeypairHex, signPassport, toPayload, verifyPassport, type TradeSummary } from "@/lib/crypto/passport";

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
});
