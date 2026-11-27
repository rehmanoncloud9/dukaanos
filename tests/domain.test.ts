import { describe, expect, it } from "vitest";
import { buildPaymentProposal, buildSaleProposal, resettle, recalcNewSkuLine } from "@/lib/domain/bill";
import { parseQuantityPhrase, resolveLine } from "@/lib/domain/desi-units";
import { detectIntent, parseFallback } from "@/lib/domain/fallback-parser";
import { normalizePkPhone, reminderText, waLink, smsLink } from "@/lib/domain/messages";
import { formatRs, rupeesToPaisa } from "@/lib/domain/money";
import { matchCatalog, phoneticKey, normalizeUrdu } from "@/lib/domain/pakphone";
import { productEntries } from "@/lib/domain/bill";
import { buildDemoHistory, DEMO_PRODUCTS } from "@/lib/domain/demo-data";
import { demoCatalog } from "./helpers/catalog";

const cat = demoCatalog();
const sale = (text: string) => buildSaleProposal(parseFallback(text), cat);

describe("money", () => {
  it("is integer paisa", () => {
    expect(rupeesToPaisa(250)).toBe(25000);
    expect(rupeesToPaisa(12.5)).toBe(1250);
    expect(formatRs(140000)).toBe("Rs. 1,400");
    expect(formatRs(-12000)).toBe("-Rs. 120");
  });
});

describe("desi units", () => {
  const cheeni = { name: "Cheeni", base_unit: "g" as const, pack_size_base_units: 1000, unit_price_paisa: 16000 };
  it.each([
    ["adha pao", 125],
    ["pao", 250],
    ["dedh pao", 375],
    ["adha kilo", 500],
    ["teen pao", 750],
    ["ek kilo", 1000],
    ["sawa kilo", 1250],
    ["dedh kilo", 1500],
    ["dhai kilo", 2500],
    ["sawa do kilo", 2250],
    ["paune do kilo", 1750],
    ["2.5 kg", 2500],
    ["250g", 250],
  ])("%s → %ig", (phrase, grams) => {
    expect(resolveLine(cheeni, { quantity: parseQuantityPhrase(phrase) }).qty_base_units).toBe(grams);
  });
  it("darjan = 12 pcs", () => {
    const anday = { name: "Anday", base_unit: "pcs" as const, pack_size_base_units: 1, unit_price_paisa: 3000 };
    const r = resolveLine(anday, { quantity: parseQuantityPhrase("ek darjan") });
    expect(r.qty_base_units).toBe(12);
    expect(r.line_total_paisa).toBe(36000);
  });
  it("value-first keeps the stated amount exactly", () => {
    const r = resolveLine(cheeni, { value_paisa: 10000 });
    expect(r.line_total_paisa).toBe(10000);
    expect(r.qty_base_units).toBe(625);
    expect(r.value_first).toBe(true);
  });
  it("dedh pao cheeni = Rs. 60", () => {
    expect(resolveLine(cheeni, { quantity: parseQuantityPhrase("dedh pao") }).line_total_paisa).toBe(6000);
  });
});

describe("PakPhone", () => {
  const entries = productEntries(cat.products);
  it("folds Urdu homoglyphs", () => {
    expect(normalizeUrdu("كيلا")).toBe(normalizeUrdu("کیلا"));
  });
  it("folds Roman drift", () => {
    expect(phoneticKey("aata")).toBe(phoneticKey("atta"));
    expect(phoneticKey("Tariq")).toBe(phoneticKey("Tarik"));
    expect(phoneticKey("cheeni")).toBe(phoneticKey("chini"));
  });
  it.each([
    ["khand", "CHEENI"],
    ["chini", "CHEENI"],
    ["aata", "ATTA"],
    ["sarson da tail", "SARSON"],
    ["anday", "ANDAY"],
    ["patti", "PATTI"],
    ["sabun", "SABUN"],
    ["chawal", "CHAWAL"],
    ["چینی", "CHEENI"],
    ["loon", "NAMAK"],
  ])("%s → %s", (q, id) => {
    const r = matchCatalog(q, entries);
    expect(r.results[0].id).toBe(id);
    expect(r.results[0].score).toBeGreaterThanOrEqual(0.72);
  });
  it("is fast (<10ms per match on any test runner)", () => {
    matchCatalog("warmup", entries);
    const r = matchCatalog("dedh pao cheeni", entries);
    expect(r.ms).toBeLessThan(10);
  });
  it("does not force-match uncataloged items", () => {
    expect(matchCatalog("lays", entries).results[0].score).toBeLessThan(0.72);
    expect(matchCatalog("khula oil", entries).results[0].score).toBeLessThan(0.72);
  });
});

describe("Golden eval — domain level", () => {
  it("#1 Demo Act 1 chaos utterance", () => {
    const p = sale("Chhote Ali ko dedh pao cheeni, 250 ka khula oil, 30 rupay chhor do, 400 cash diya baqi khate mein");
    const names = p.customer.candidates.map((c) => c.name);
    expect(names[0]).toBe("Chhote Ali");
    expect([...names].sort()).toEqual(["Ali Driver", "Ali Tailor", "Chhote Ali"]);
    expect(p.customer.selected_id).toBe("CHHOTE_ALI");
    const cheeni = p.lines.find((l) => l.product_id === "CHEENI")!;
    expect(cheeni.qty_base_units).toBe(375);
    expect(cheeni.line_total_paisa).toBe(6000);
    const oil = p.lines.find((l) => l.kind === "new_sku")!;
    expect(oil.value_first).toBe(true);
    expect(oil.line_total_paisa).toBe(25000);
    expect(p.discount_paisa).toBe(3000);
    expect(p.total_paisa).toBe(28000);
    expect(p.cash_paid_paisa).toBe(40000);
    expect(p.credit_paisa).toBe(-12000);
    expect(p.new_balance_paisa).toBe(128000);
    expect(p.tier).toBe(2);
    expect(p.tier_reasons).toContain("DISCOUNT");
  });

  it.each([
    ["ek kilo cheeni cash", "CHEENI", 1000],
    ["pao patti cash", "PATTI", 250],
    ["dedh kilo chawal cash", "CHAWAL", 1500],
    ["ek darjan anday cash", "ANDAY", 12],
  ])("#2–5 %s", (text, id, qty) => {
    const p = sale(text);
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0].product_id).toBe(id);
    expect(p.lines[0].qty_base_units).toBe(qty);
    expect(p.credit_paisa).toBe(0);
    expect(p.discount_paisa).toBe(0);
  });

  it("fallback parsing stays Tier-2 even if its confidence is raised", () => {
    const parsed = { ...parseFallback("ek kilo cheeni cash"), confidence: 0.97 };
    parsed.items = parsed.items.map((i) => ({ ...i, confidence: 0.97 }));
    const p = buildSaleProposal(parsed, cat);
    expect(p.tier).toBe(2);
    expect(p.tier_reasons).toContain("UNVERIFIED_EXTRACTION");
    expect(p.total_paisa).toBe(16000);
  });

  it("#6 khand 1kg → Cheeni", () => {
    const p = sale("khand 1kg cash");
    expect(p.lines[0].product_id).toBe("CHEENI");
    expect(p.lines[0].qty_base_units).toBe(1000);
  });
  it("#7 sarson da tail → Sarson ka Tel", () => {
    expect(sale("sarson da tail cash").lines[0].product_id).toBe("SARSON");
  });
  it("#8 2 packet Lays → QuickAddChip (no crash)", () => {
    const p = sale("2 packet Lays cash");
    expect(p.lines[0].kind).toBe("new_sku");
    expect(p.lines[0].name).toBe("Lays");
    expect(p.tier_reasons).toContain("NEW_SKU");
    const priced = recalcNewSkuLine({ ...p.lines[0], unit_price_paisa: 5000, price_known: true });
    expect(priced.qty_base_units).toBe(2);
    expect(priced.line_total_paisa).toBe(10000);
  });
  it("#9 udhaar without a customer requires one", () => {
    const p = sale("ek kilo cheeni khate mein likh do");
    expect(p.tier_reasons).toContain("UDHAAR_REQUIRES_CUSTOMER");
  });
  it("#10 discount forces Tier 2", () => {
    const p = sale("do kilo atta, 20 rupay chhor do cash");
    expect(p.discount_paisa).toBe(2000);
    expect(p.tier).toBe(2);
  });
  it("#11 negative stock is a soft warning", () => {
    const p = sale("50 kilo atta cash");
    expect(p.warnings[0].code).toBe("NEGATIVE_STOCK");
    expect(p.lines[0].stock_after).toBe(38000 - 50000);
  });
  it("#12 payment", () => {
    const parsed = parseFallback("Bilal ne 1500 jama karwaye");
    expect(parsed.intent).toBe("payment");
    const p = buildPaymentProposal(parsed, cat.customers);
    expect(p.amount_paisa).toBe(150000);
    expect(p.customer.selected_id).toBe("BILAL");
    expect(p.new_balance_paisa).toBe(635000 - 150000);
  });
  it("#13 reversal intent", () => {
    expect(detectIntent("Pichli entry wapas kar do")).toBe("reversal");
  });
  it("#14 pulse fast path", () => {
    expect(detectIntent("Subah ka hisaab batao")).toBe("pulse");
    expect(detectIntent("aaj ka haal")).toBe("pulse");
  });
});

describe("Tier-2 edits", () => {
  it("tapping another Ali re-settles balances", () => {
    const p = sale("Chhote Ali ko dedh pao cheeni, 250 ka khula oil, 30 rupay chhor do, 400 cash diya baqi khate mein");
    const q = resettle(p, cat.customers, { selected_customer_id: "ALI_TAILOR" });
    expect(q.customer.selected_id).toBe("ALI_TAILOR");
    expect(q.new_balance_paisa).toBe(65000 - 12000);
    expect(q.customer.ambiguous).toBe(false);
  });
  it("implied cash follows the new total after a QuickAdd price edit", () => {
    const p = sale("2 packet Lays cash");
    const line = recalcNewSkuLine({ ...p.lines[0], unit_price_paisa: 5000, price_known: true });
    const q = resettle(p, cat.customers, { lines: [line] });
    expect(q.total_paisa).toBe(10000);
    expect(q.cash_paid_paisa).toBe(10000);
    expect(q.credit_paisa).toBe(0);
  });
  it("deselecting a customer back to null restores Walk-in cash settlement", () => {
    const p = sale("Chhote Ali ko ek kilo cheeni cash");
    expect(p.customer.selected_id).toBeTruthy();
    const q = resettle(p, cat.customers, { selected_customer_id: null });
    expect(q.customer.selected_id).toBeNull();
    expect(q.new_balance_paisa).toBeNull();
    expect(q.credit_paisa).toBe(0);
  });
});

describe("messages", () => {
  it("normalizes PK phones and builds links", () => {
    expect(normalizePkPhone("0300-1110001")).toBe("923001110001");
    expect(waLink("03001110001", "hi")).toBe("https://wa.me/923001110001?text=hi");
    expect(smsLink("03001110001", "hi")).toBe("sms:+923001110001?body=hi");
    expect(reminderText({ name: "Bilal", shop: "Bismillah Kiryana", balance_paisa: 635000 })).toContain("Rs. 6,350");
  });
});

describe("demo history", () => {
  it("references only known products", () => {
    const codes = new Set(DEMO_PRODUCTS.map((p) => p.code));
    for (const e of buildDemoHistory()) {
      if (e.kind === "payment") continue;
      for (const l of e.lines) expect(codes.has(l.p)).toBe(true);
    }
  });
});
