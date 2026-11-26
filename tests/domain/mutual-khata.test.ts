import { describe, expect, it } from "vitest";
import { generateKeypairHex } from "@/lib/crypto/passport";
import { KHATA_LINK_TTL_S, signKhataLink, verifyKhataLink } from "@/lib/crypto/khata-link";
import { mutualKhataText } from "@/lib/domain/messages";

const SHOP = "0b5f1a52-6d1e-4c2a-9a33-5b0e7f1d2c11";
const CUST = "7c3e2b10-1f4d-4a6b-8e2c-9d0a1b2c3d4e";

describe("Mutual Khata signed link (Ed25519)", () => {
  it("round-trips and binds shop, customer and nonce", async () => {
    const kp = await generateKeypairHex();
    const { token, claims } = await signKhataLink({ shopId: SHOP, customerId: CUST, nonce: 2 }, kp.privateKey);
    const r = await verifyKhataLink(token, kp.publicKey);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claims).toEqual(claims);
    expect(claims.n).toBe(2);
  });

  it("rejects a tampered payload, a foreign key and an expired link", async () => {
    const kp = await generateKeypairHex();
    const other = await generateKeypairHex();
    const { token } = await signKhataLink({ shopId: SHOP, customerId: CUST, nonce: 0 }, kp.privateKey);
    const [p, s] = token.split(".");
    const forged = Buffer.from(Buffer.from(p, "base64url").toString().replace(CUST, SHOP)).toString("base64url");
    expect(await verifyKhataLink(`${forged}.${s}`, kp.publicKey)).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
    expect(await verifyKhataLink(token, other.publicKey)).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
    const later = Date.now() + (KHATA_LINK_TTL_S + 60) * 1000;
    expect(await verifyKhataLink(token, kp.publicKey, later)).toMatchObject({ ok: false, reason: "EXPIRED" });
    expect(await verifyKhataLink("garbage", kp.publicKey)).toMatchObject({ ok: false, reason: "MALFORMED" });
  });
});

describe("Mutual Khata message", () => {
  it("is self-contained: entry and balance are readable without opening the link", () => {
    const t = mutualKhataText({
      name: "Chhote Ali", shop: "Bismillah Kiryana", balance_paisa: 152000, url: "https://x.test/k/abc",
      entry: { summary: "Cheeni (Sugar)", credit_paisa: 12000 }, raast_id: "03001234567",
    });
    expect(t).toContain("Rs. 120");
    expect(t).toContain("Rs. 1,520");
    expect(t).toContain("Raast se ada karein: 03001234567");
    expect(t).toContain("https://x.test/k/abc");
  });
});

describe("Wasooli without asking", () => {
  it("voice script is polite, speaks plain rupees and mentions the wada", async () => {
    const { voiceReminderScript } = await import("@/lib/domain/messages");
    const s = voiceReminderScript({ name: "Bilal", shop: "Bismillah Kiryana", balance_paisa: 152000, promise_label: "Jumma" });
    expect(s).toContain("1520 rupay");
    expect(s).toContain("Jumma ka wada");
    expect(s).toContain("suhoolat");
    expect(s).not.toMatch(/Rs\./);
  });
  it("ranks broken wada, then due wada, then overdue; leaves future wada alone", async () => {
    const { rankReminders } = await import("@/lib/domain/messages");
    const base = { balance_paisa: 50000, promise_date: null, promise_state: null } as const;
    const r = rankReminders([
      { ...base, id: "a", name: "Overdue 30", days_overdue: 30 },
      { ...base, id: "b", name: "Broken", days_overdue: 2, promise_date: "2026-11-20", promise_state: "broken" },
      { ...base, id: "c", name: "Due today", days_overdue: 1, promise_date: "2026-11-26", promise_state: "open" },
      { ...base, id: "d", name: "Future wada", days_overdue: 40, promise_date: "2026-11-30", promise_state: "open" },
      { ...base, id: "e", name: "Fresh", days_overdue: 3 },
      { ...base, id: "f", name: "Settled", days_overdue: 50, balance_paisa: 0 },
    ], "2026-11-26");
    expect(r.map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(r.map((x) => x.reason)).toEqual(["wada_broken", "wada_due", "overdue"]);
  });
});
