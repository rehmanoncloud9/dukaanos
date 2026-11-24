/**
 * 15-utterance golden eval (target ≥ 14/15).
 *   npm run eval              → model path if GEMINI_API_KEY is set, else rule parser
 *   npm run eval -- --rules   → force the deterministic rule parser
 * #15 (duplicate Replay) runs against a real Postgres (PGlite) with the actual migrations.
 */
import { buildPaymentProposal, buildSaleProposal } from "../src/lib/domain/bill";
import { DEMO_CUSTOMERS, DEMO_PRODUCTS } from "../src/lib/domain/demo-data";
import { parseFallback } from "../src/lib/domain/fallback-parser";
import type { Catalog, ParsedTurn, SaleProposal } from "../src/lib/domain/types";

const BAL: Record<string, number> = { CHHOTE_ALI: 140000, ALI_DRIVER: 0, ALI_TAILOR: 65000, TARIQ_M: 90000, TARIQ_B: 0, BILAL: 635000 };
const catalog: Catalog = {
  products: DEMO_PRODUCTS.map((p) => ({
    id: p.code, name: p.name, name_ur: p.name_ur, base_unit: p.base_unit, pack_size_base_units: p.pack,
    unit_price_paisa: p.price_rs * 100, cost_price_paisa: p.cost_rs * 100, stock_base_units: p.stock_target, aliases: p.aliases,
  })),
  customers: DEMO_CUSTOMERS.map((c) => ({ id: c.code, name: c.name, role_tag: c.role_tag, phone: c.phone, balance_paisa: BAL[c.code] ?? 0, aliases: c.aliases })),
};

type Check = (t: ParsedTurn, s: SaleProposal | null) => string | null;
const line = (s: SaleProposal | null, id: string) => s?.lines.find((l) => l.product_id === id);

const CASES: Array<{ n: string; text: string; gate: string; check: Check }> = [
  {
    n: "1", text: "Chhote Ali ko dedh pao cheeni, 250 ka khula oil, 30 rupay chhor do, 400 cash diya baqi khate mein", gate: "explicit_confirm",
    check: (t, s) => {
      if (!s) return "no sale";
      if (s.customer.candidates[0]?.id !== "CHHOTE_ALI") return `customer ${s.customer.candidates[0]?.name}`;
      if (s.customer.candidates.length < 3) return "expected 3 Ali chips";
      if (line(s, "CHEENI")?.qty_base_units !== 375) return "cheeni ≠ 375g";
      const oil = s.lines.find((l) => /oil|tel|tail/i.test(l.spoken));
      if (!oil || oil.line_total_paisa !== 25000) return "value-first oil ≠ Rs.250";
      if (s.discount_paisa !== 3000) return `disc ${s.discount_paisa}`;
      if (s.cash_paid_paisa !== 40000) return `cash ${s.cash_paid_paisa}`;
      return s.tier === 2 ? null : "should be Tier 2";
    },
  },
  { n: "2", text: "ek kilo cheeni cash", gate: "quick_commit_5s", check: (_t, s) => (line(s, "CHEENI")?.qty_base_units === 1000 && s?.credit_paisa === 0 ? null : "1000g cheeni cash") },
  { n: "3", text: "pao patti cash", gate: "quick_commit_5s", check: (_t, s) => (line(s, "PATTI")?.qty_base_units === 250 ? null : "250g patti") },
  { n: "4", text: "dedh kilo chawal cash", gate: "quick_commit_5s", check: (_t, s) => (line(s, "CHAWAL")?.qty_base_units === 1500 ? null : "1500g chawal") },
  { n: "5", text: "ek darjan anday cash", gate: "quick_commit_5s", check: (_t, s) => (line(s, "ANDAY")?.qty_base_units === 12 ? null : "12 anday") },
  { n: "6", text: "khand 1kg cash", gate: "PakPhone", check: (_t, s) => (line(s, "CHEENI")?.qty_base_units === 1000 ? null : "khand → cheeni 1kg") },
  { n: "7", text: "sarson da tail cash", gate: "PakPhone", check: (_t, s) => (line(s, "SARSON") ? null : "sarson da tail → Sarson ka Tel") },
  { n: "8", text: "2 packet Lays cash", gate: "QuickAddChip", check: (_t, s) => (s?.lines[0]?.kind === "new_sku" && /lays/i.test(s.lines[0].name) && s.tier === 2 ? null : "Lays should be QuickAdd") },
  { n: "9", text: "ek kilo atta khate mein likh do", gate: "Tier 2", check: (_t, s) => (s?.tier_reasons.includes("UDHAAR_REQUIRES_CUSTOMER") ? null : "UDHAAR_REQUIRES_CUSTOMER not raised") },
  { n: "10", text: "do kilo cheeni, 20 rupay chhor do, cash", gate: "Tier 2", check: (_t, s) => (s?.discount_paisa === 2000 && s.tier === 2 ? null : "discount 20 → Tier 2") },
  { n: "11", text: "50 kilo atta cash", gate: "soft NEGATIVE_STOCK", check: (_t, s) => (s?.warnings[0]?.code === "NEGATIVE_STOCK" ? null : "no negative stock warning") },
  {
    n: "12", text: "Bilal ne 1500 jama karwaye", gate: "explicit_confirm",
    check: (t) => {
      if (t.intent !== "payment") return `intent ${t.intent}`;
      const p = buildPaymentProposal(t, catalog.customers);
      return p.amount_paisa === 150000 && p.customer.selected_id === "BILAL" ? null : "payment 1500 Bilal";
    },
  },
  { n: "13", text: "Pichli entry wapas kar do", gate: "explicit_confirm", check: (t) => (t.intent === "reversal" ? null : `intent ${t.intent}`) },
  { n: "14", text: "Subah ka hisaab batao", gate: "SQL Pulse", check: (t) => (t.intent === "pulse" ? null : `intent ${t.intent}`) },
];

async function parse(text: string, useModel: boolean): Promise<{ t: ParsedTurn; src: string; ms: number }> {
  const t0 = Date.now();
  if (useModel) {
    const { parseTurn } = await import("../src/lib/ai/munshi");
    const r = await parseTurn({ text, catalog, shopName: "Bismillah Kiryana" });
    return { t: r.parsed, src: r.source === "model" ? r.model ?? "model" : r.source, ms: Date.now() - t0 };
  }
  return { t: parseFallback(text), src: "rules", ms: Date.now() - t0 };
}

async function replayCase(): Promise<string | null> {
  const { bootDb } = await import("../tests/helpers/pglite");
  const db = await bootDb();
  const shop = (await db.query<{ id: string }>("select id from public.shops where is_stage_shop")).rows[0].id;
  const atta = (await db.query<{ id: string }>("select id from public.products where shop_id=$1 and sku_code='ATTA'", [shop])).rows[0].id;
  const payload = { idempotency_key: "eval-replay-000001", lines: [{ product_id: atta, qty_base_units: 1000 }] };
  const a = (await db.query<{ r: { transaction_id: string } }>("select public.commit_sale($1,$2) r", [shop, payload])).rows[0].r;
  const b = (await db.query<{ r: { transaction_id: string; deduplicated: boolean; duplicate_rows: number } }>("select public.commit_sale($1,$2) r", [shop, payload])).rows[0].r;
  const rows = Number((await db.query<{ n: string }>("select count(*) n from public.transactions where idempotency_key=$1", [payload.idempotency_key])).rows[0].n);
  await db.close();
  return b.deduplicated && b.transaction_id === a.transaction_id && rows === 1 ? null : `dupes: rows=${rows}`;
}

async function main() {
  const useModel = !process.argv.includes("--rules") && !!process.env.GEMINI_API_KEY;
  console.log(`\nDukaanOS golden eval · parser: ${useModel ? process.env.AI_FAST_MODEL ?? "gemini-3.5-flash-lite" : "rule-based fallback"}\n`);
  let pass = 0;
  for (const c of CASES) {
    try {
      const { t, src, ms } = await parse(c.text, useModel);
      const s = t.intent === "sale" ? buildSaleProposal(t, catalog) : null;
      const err = c.check(t, s);
      if (!err) pass++;
      console.log(`${err ? "✗" : "✓"} #${c.n.padEnd(2)} [${c.gate}] ${c.text.slice(0, 58).padEnd(58)} ${String(ms).padStart(5)}ms ${src}${err ? `  → ${err}` : ""}`);
    } catch (e) {
      console.log(`✗ #${c.n} ${c.text} → ${e instanceof Error ? e.message : e}`);
    }
  }
  const r = await replayCase().catch((e) => String(e));
  if (!r) pass++;
  console.log(`${r ? "✗" : "✓"} #15 [Idempotent] Duplicate Replay Test (same idempotency_key ×2, real Postgres)${r ? `  → ${r}` : "  → 200 OK Deduplicated, 0 duplicate rows"}`);
  console.log(`\nScore: ${pass}/15 ${pass >= 14 ? "PASS (≥14/15)" : "FAIL (<14/15)"}\n`);
  process.exit(pass >= 14 ? 0 : 1);
}

void main();
