import { publicKeyFromPrivate, signPassport, toPayload, type TradeSummary } from "@passport";
import type { TradeSummaryResponse } from "@/core/api/types";
import {
  buildPassportPdfHtml,
  tamperPassportTokenForDemo,
  verifyPassportOnDevice,
} from "@/features/passport/verify";

const TEST_PRIV = "11".repeat(32);

const SAMPLE_SUMMARY: TradeSummary = {
  shop_id: "12345678-1111-4111-8111-111111111111",
  shop_name: "Bismillah <Kiryana> & Store",
  city: "Lahore",
  active_days: 18,
  period_days: 30,
  period_from: "2026-10-26",
  period_to: "2026-11-25",
  gmv_paisa: 48_500_000,
  sales_count: 142,
  cash_sales_paisa: 35_000_000,
  credit_sales_paisa: 13_500_000,
  recovered_paisa: 11_000_000,
  purchases_paisa: 29_000_000,
  active_trading_days: 17,
  receivable_paisa: 840_000,
  ledger_balanced: true,
  tx_count_total: 190,
  head_entry_hash: "9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c",
};

describe("SMEConnect Trade Passport Ed25519 verification & PDF export", () => {
  test("verifies valid signed token on device with pinned public key", async () => {
    const pubHex = await publicKeyFromPrivate(TEST_PRIV);
    const payload = toPayload(SAMPLE_SUMMARY, new Date("2026-11-25T10:00:00Z"));
    const signed = await signPassport(payload, TEST_PRIV);

    const res = await verifyPassportOnDevice(signed.token, pubHex);
    expect(res.valid).toBe(true);
    expect(res.payload?.gmv).toBe(48_500_000);
    expect(res.payload?.h).toBe(SAMPLE_SUMMARY.head_entry_hash);
  });

  test("rejects tampered payload with BAD_SIGNATURE", async () => {
    const pubHex = await publicKeyFromPrivate(TEST_PRIV);
    const payload = toPayload(SAMPLE_SUMMARY, new Date("2026-11-25T10:00:00Z"));
    const signed = await signPassport(payload, TEST_PRIV);
    const forged = tamperPassportTokenForDemo(signed.token);
    expect(forged).not.toBeNull();

    const res = await verifyPassportOnDevice(forged!, pubHex);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("BAD_SIGNATURE");
  });

  test("rejects valid token under wrong public key or missing key", async () => {
    const otherPub = await publicKeyFromPrivate("22".repeat(32));
    const payload = toPayload(SAMPLE_SUMMARY, new Date("2026-11-25T10:00:00Z"));
    const signed = await signPassport(payload, TEST_PRIV);

    const wrongRes = await verifyPassportOnDevice(signed.token, otherPub);
    expect(wrongRes.valid).toBe(false);

    const missingKeyRes = await verifyPassportOnDevice(signed.token, "");
    expect(missingKeyRes.valid).toBe(false);
    expect(missingKeyRes.reason).toBe("MISSING_PINNED_KEY");
  });

  test("builds sanitized printable HTML report for PDF export", async () => {
    const pubHex = await publicKeyFromPrivate(TEST_PRIV);
    const payload = toPayload(SAMPLE_SUMMARY, new Date("2026-11-25T10:00:00Z"));
    const signed = await signPassport(payload, TEST_PRIV);

    const doc: TradeSummaryResponse = {
      summary: SAMPLE_SUMMARY,
      payload: payload as unknown as Record<string, unknown>,
      token: signed.token,
      verify_url: `https://dukaanos.pk/verify#${signed.token}`,
      signature_hex: signed.signature_hex,
      public_key_hex: pubHex,
      chain: { ok: true, checked: 190 },
      disclaimer: "Informational only — not a credit score.",
    };

    const html = buildPassportPdfHtml({
      passport: doc,
      qrDataUrl: "data:image/png;base64,AAA=",
    });
    expect(html).toContain("Bismillah &lt;Kiryana&gt; &amp; Store");
    expect(html).toContain("CHAIN_OK · 190 links recomputed");
    expect(html).toContain('src="data:image/png;base64,AAA="');
  });
});
