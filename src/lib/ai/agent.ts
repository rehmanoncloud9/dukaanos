/**
 * 15% path — multi-step Urdu Q&A on AI_AGENT_MODEL (thinkingLevel LOW).
 * Bound to exactly 7 read/propose tools. No tool can write: proposals come back to the
 * PWA as Tier-2 review cards and only the user's tap calls the commit RPC.
 * Native thought_signature parts are preserved by replaying the model's own Content
 * verbatim; there are zero prefilled model turns.
 */

import { ThinkingLevel, type Content, type FunctionDeclaration } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { buildPaymentProposal, buildSaleProposal, customerEntries, productEntries } from "@/lib/domain/bill";
import { formatBaseQty } from "@/lib/domain/desi-units";
import { formatRs } from "@/lib/domain/money";
import { matchCatalog } from "@/lib/domain/pakphone";
import type { Catalog, ParsedTurn, PaymentProposal, SaleProposal } from "@/lib/domain/types";
import { rpc } from "@/lib/supabase/server";
import { generateContentOnce } from "./models";

export const AGENT_TOOLS: FunctionDeclaration[] = [
  {
    name: "get_customer_balance",
    description: "Udhaar balance, overdue days and last payment for a customer (fuzzy Urdu/Roman name).",
    parametersJsonSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "search_products",
    description: "Find products by spoken name; returns price, stock and 7-day sales.",
    parametersJsonSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "get_munshi_pulse",
    description: "Today's galla (cash, udhaar, margin), 15+ day overdue udhaar and 2-day stockout risks.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "get_recent_transactions",
    description: "Most recent ledger entries, optionally for one customer.",
    parametersJsonSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 20 }, customer_name: { type: "string" } },
    },
  },
  {
    name: "get_stock",
    description: "Current stock and days of cover for one product.",
    parametersJsonSchema: { type: "object", properties: { product: { type: "string" } }, required: ["product"] },
  },
  {
    name: "propose_sale",
    description: "Prepare (NOT save) a sale for the shopkeeper to review and confirm. Use spoken quantities; do not compute totals.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        customer_name: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { spoken: { type: "string" }, quantity_phrase: { type: "string" }, value_rupees: { type: "number" } },
            required: ["spoken"],
          },
        },
        discount_rupees: { type: "number" },
        cash_paid_rupees: { type: "number" },
        payment_mode: { type: "string", enum: ["cash", "udhaar", "split", "unspecified"] },
      },
      required: ["items"],
    },
  },
  {
    name: "propose_payment",
    description: "Prepare (NOT save) a Wasooli payment for review.",
    parametersJsonSchema: {
      type: "object",
      properties: { customer_name: { type: "string" }, amount_rupees: { type: "number" } },
      required: ["customer_name", "amount_rupees"],
    },
  },
];

interface ShopState {
  feed: Array<Record<string, unknown> & { customer_name?: string | null; type: string; total_paisa: number; created_at: string }>;
  products: Array<{ id: string; name: string; stock_base_units: number; base_unit: "g" | "ml" | "pcs"; unit_price_paisa: number; sold_7d: number; days_left: number | null }>;
  customers: Array<{ id: string; name: string; balance_paisa: number; days_overdue: number | null; last_paid_at: string | null; role_tag: string | null }>;
}

export interface AgentResult {
  answer: string;
  proposal: SaleProposal | PaymentProposal | null;
  tool_calls: Array<{ name: string; args: unknown; ms: number }>;
  model: string;
  latency_ms: number;
  rounds: number;
}

export async function runAgent(opts: {
  question: string;
  sb: SupabaseClient;
  shopId: string;
  shopName: string;
  catalog: Catalog;
}): Promise<AgentResult> {
  const t0 = Date.now();
  let state: ShopState | null = null;
  const loadState = async () => (state ??= await rpc<ShopState>(opts.sb, "get_shop_state", { p_shop_id: opts.shopId }));
  let proposal: SaleProposal | PaymentProposal | null = null;
  const toolLog: AgentResult["tool_calls"] = [];

  const tools: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
    get_customer_balance: async (a) => {
      const s = await loadState();
      const r = matchCatalog(String(a.name ?? ""), customerEntries(opts.catalog.customers), 3);
      return r.results.map((m) => {
        const c = s.customers.find((x) => x.id === m.id);
        return c && { name: c.name, role: c.role_tag, balance: formatRs(c.balance_paisa), days_overdue: c.days_overdue, last_paid_at: c.last_paid_at, match_score: m.score };
      });
    },
    search_products: async (a) => {
      const s = await loadState();
      const r = matchCatalog(String(a.query ?? ""), productEntries(opts.catalog.products), 5);
      return r.results.filter((m) => m.score > 0.5).map((m) => {
        const p = s.products.find((x) => x.id === m.id)!;
        return { name: p.name, price: formatRs(p.unit_price_paisa), stock: formatBaseQty(p.stock_base_units, p.base_unit), sold_7d: formatBaseQty(p.sold_7d, p.base_unit), days_left: p.days_left, match_score: m.score };
      });
    },
    get_munshi_pulse: async () => rpc(opts.sb, "get_munshi_pulse", { p_shop_id: opts.shopId }),
    get_recent_transactions: async (a) => {
      const s = await loadState();
      const lim = Math.min(20, Math.max(1, Number(a.limit ?? 8)));
      const who = a.customer_name ? String(a.customer_name).toLowerCase() : null;
      return s.feed
        .filter((t) => !who || (t.customer_name ?? "").toLowerCase().includes(who.split(" ")[0]))
        .slice(0, lim)
        .map((t) => ({ type: t.type, customer: t.customer_name, total: formatRs(Number(t.total_paisa)), at: t.created_at }));
    },
    get_stock: async (a) => {
      const s = await loadState();
      const r = matchCatalog(String(a.product ?? ""), productEntries(opts.catalog.products), 1);
      const p = s.products.find((x) => x.id === r.results[0]?.id);
      return p ? { name: p.name, stock: formatBaseQty(p.stock_base_units, p.base_unit), days_left: p.days_left, sold_7d: formatBaseQty(p.sold_7d, p.base_unit) } : null;
    },
    propose_sale: async (a) => {
      const items = Array.isArray(a.items) ? (a.items as Array<Record<string, unknown>>) : [];
      const parsed: ParsedTurn = {
        intent: "sale", transcript: opts.question, customer_mention: (a.customer_name as string) ?? null,
        items: items.map((i) => ({
          spoken: String(i.spoken ?? ""), quantity_phrase: (i.quantity_phrase as string) ?? null,
          value_rupees: typeof i.value_rupees === "number" ? i.value_rupees : null, is_loose: false, confidence: 0.85,
        })),
        discount_rupees: typeof a.discount_rupees === "number" ? a.discount_rupees : null,
        cash_paid_rupees: typeof a.cash_paid_rupees === "number" ? a.cash_paid_rupees : null,
        payment_mode: (a.payment_mode as ParsedTurn["payment_mode"]) ?? "unspecified",
        payment_amount_rupees: null, question: null, confidence: 0.85,
      };
      const p = buildSaleProposal(parsed, opts.catalog);
      proposal = { ...p, tier: 2 }; // agent proposals always require a tap
      return { prepared: true, total: formatRs(p.total_paisa), lines: p.lines.map((l) => l.name), needs_review: true };
    },
    propose_payment: async (a) => {
      const parsed = {
        intent: "payment", transcript: opts.question, customer_mention: String(a.customer_name ?? ""), items: [],
        discount_rupees: null, cash_paid_rupees: null, payment_mode: "cash", payment_amount_rupees: Number(a.amount_rupees ?? 0),
        question: null, confidence: 0.85,
      } satisfies ParsedTurn;
      const p = buildPaymentProposal(parsed, opts.catalog.customers);
      proposal = p;
      return { prepared: true, customer: p.customer.candidates[0]?.name ?? null, amount: formatRs(p.amount_paisa), needs_review: true };
    },
  };

  const contents: Content[] = [{ role: "user", parts: [{ text: opts.question }] }];
  const system = [
    `You are the munshi (bookkeeper) of ${opts.shopName}, a Pakistani kiryana store.`,
    "Answer in short, polite Roman Urdu (1-3 sentences) with exact Rs. figures from tools.",
    "Always use tools for numbers; never estimate or do arithmetic yourself beyond reading tool output.",
    "You cannot save anything. To record a sale or payment, call propose_sale / propose_payment and tell the shopkeeper to confirm on screen.",
  ].join("\n");

  let model = env.agentModel();
  let rounds = 0;
  try {
    for (; rounds < 5; rounds++) {
      const call = await generateContentOnce(env.agentModel(), {
        contents,
        config: {
          systemInstruction: system,
          tools: [{ functionDeclarations: AGENT_TOOLS }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          maxOutputTokens: 1_024,
        },
      }, Math.max(env.aiTimeoutMs(), 12_000), { shopId: opts.shopId, kind: "qa" });
      model = call.model;
      const calls = call.response.functionCalls ?? [];
      const modelContent = call.response.candidates?.[0]?.content;
      if (!calls.length || !modelContent) {
        return { answer: call.response.text ?? "", proposal, tool_calls: toolLog, model, latency_ms: Date.now() - t0, rounds: rounds + 1 };
      }
      contents.push(modelContent); // verbatim — keeps thought_signature parts intact
      const responses = [];
      for (const fc of calls) {
        const ts = Date.now();
        const fn = tools[fc.name ?? ""];
        let result: unknown;
        try {
          result = fn ? await fn((fc.args ?? {}) as Record<string, unknown>) : { error: "unknown tool" };
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        toolLog.push({ name: fc.name ?? "?", args: fc.args, ms: Date.now() - ts });
        responses.push({ functionResponse: { id: fc.id, name: fc.name, response: { result } } });
      }
      contents.push({ role: "user", parts: responses });
    }
    return { answer: "Maaf kijiye, jawab mukammal nahi ho saka. Dobara poochein.", proposal, tool_calls: toolLog, model, latency_ms: Date.now() - t0, rounds };
  } catch {
    return runDeterministicQaFallback(opts.question, opts.catalog, tools, toolLog, t0, loadState);
  }
}

async function runDeterministicQaFallback(
  question: string,
  catalog: Catalog,
  tools: Record<string, (a: Record<string, unknown>) => Promise<unknown>>,
  toolLog: AgentResult["tool_calls"],
  t0: number,
  loadState: () => Promise<ShopState>,
): Promise<AgentResult> {
  const q = question.toLowerCase();
  const runTool = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const ts = Date.now();
    const res = (await tools[name](args)) as T;
    toolLog.push({ name, args, ms: Date.now() - ts });
    return res;
  };

  if (/\b(hafta|haftay|week|mahina|mahinay|month|munafa|profit|fayda|zyada|top|slow)\b/.test(q)) {
    const s = await loadState();
    const days = /\b(mahina|mahinay|month|30)\b/.test(q) ? 30 : 7;
    if (/\b(zyada|top|best|fast|bikne|slow|kam\s+bik)\b/.test(q)) {
      const slow = /\b(slow|kam\s+bik)\b/.test(q);
      const sorted = s.products.slice().sort((a, b) => (slow ? a.sold_7d - b.sold_7d : b.sold_7d - a.sold_7d)).slice(0, 3);
      return {
        answer: sorted.length
          ? `${slow ? "Kam bikne wale" : "Sab se zyada bikne wale"} items (7d): ${sorted.map((p) => `${p.name} (${formatBaseQty(p.sold_7d, p.base_unit)})`).join(", ")}.`
          : "Abhi sales history kam hai.",
        proposal: null,
        tool_calls: toolLog,
        model: "rules-fallback",
        latency_ms: Date.now() - t0,
        rounds: 1,
      };
    }
    const cutoff = Date.now() - days * 86_400_000;
    const recent = s.feed.filter((t) => new Date(t.created_at).getTime() >= cutoff);
    const sales = recent.filter((t) => t.type === "sale");
    const total = sales.reduce((sum, t) => sum + Number(t.total_paisa ?? 0), 0);
    return {
      answer: `${days === 30 ? "Is mahinay" : "Is haftay"} ${sales.length} sales mein kul ${formatRs(total)} ki bikri hui.`,
      proposal: null,
      tool_calls: toolLog,
      model: "rules-fallback",
      latency_ms: Date.now() - t0,
      rounds: 1,
    };
  }

  if (/\b(pulse|hisaab|hisab|galla|aaj|kamai|overdue)\b/.test(q)) {
    const pulse = await runTool<{
      today?: { sales_paisa?: number; cash_paisa?: number; udhaar_paisa?: number };
      overdue_udhaar?: Array<unknown>;
      stockout_risks?: Array<unknown>;
    }>("get_munshi_pulse", {});
    const sales = formatRs(Number(pulse.today?.sales_paisa ?? 0));
    const cash = formatRs(Number(pulse.today?.cash_paisa ?? 0));
    const udhaar = formatRs(Number(pulse.today?.udhaar_paisa ?? 0));
    return {
      answer: `Aaj ki kul bikri ${sales} hai (${cash} cash, ${udhaar} udhaar). ${pulse.overdue_udhaar?.length ?? 0} overdue khate aur ${pulse.stockout_risks?.length ?? 0} kam stock items hain.`,
      proposal: null,
      tool_calls: toolLog,
      model: "rules-fallback",
      latency_ms: Date.now() - t0,
      rounds: 1,
    };
  }

  const bestTokenMatch = <T extends { name: string }>(entries: Parameters<typeof matchCatalog>[1], minScore: number) => {
    const direct = matchCatalog(question, entries, 1).results[0];
    if (direct && direct.score >= minScore) return direct;
    const words = q.replace(/[?؟.,!]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
    let best: typeof direct | undefined = direct;
    for (let i = 0; i < words.length; i++) {
      for (const phrase of [words[i], i + 1 < words.length ? `${words[i]} ${words[i + 1]}` : ""]) {
        if (!phrase) continue;
        const m = matchCatalog(phrase, entries, 1).results[0];
        if (m && (!best || m.score > best.score)) best = m;
      }
    }
    return best && best.score >= minScore ? best : undefined;
  };

  const custMatch = bestTokenMatch(customerEntries(catalog.customers), 0.65);
  if (custMatch || /\b(udhaar|khata|balance|baqi|baki|wasooli)\b/.test(q)) {
    const target = custMatch?.name ?? question;
    const rows = await runTool<Array<{ name: string; balance: string; days_overdue: number | null } | undefined>>("get_customer_balance", { name: target });
    const top = rows.find(Boolean);
    if (top) {
      const overdue = top.days_overdue ? ` (${top.days_overdue} din purana)` : "";
      return {
        answer: `${top.name} ke zimme ${top.balance} udhaar hai${overdue}.`,
        proposal: null,
        tool_calls: toolLog,
        model: "rules-fallback",
        latency_ms: Date.now() - t0,
        rounds: 1,
      };
    }
  }

  const prodMatch = bestTokenMatch(productEntries(catalog.products), 0.6);
  if (prodMatch || /\b(stock|maal|kitna|kitni|bachi|bacha|mojood|available|price|rate|qeemat)\b/.test(q)) {
    const target = prodMatch?.name ?? question;
    const item = await runTool<{ name: string; stock: string; days_left: number | null } | null>("get_stock", { product: target });
    if (item) {
      const days = item.days_left !== null ? ` (taqreeban ${item.days_left} din ka stock)` : "";
      return {
        answer: `${item.name} ka mojooda stock ${item.stock} hai${days}.`,
        proposal: null,
        tool_calls: toolLog,
        model: "rules-fallback",
        latency_ms: Date.now() - t0,
        rounds: 1,
      };
    }
  }

  const recent = await runTool<Array<{ type: string; customer: string | null; total: string }>>("get_recent_transactions", { limit: 3 });
  const summary = recent.length
    ? `Aakhri ${recent.length} entries: ${recent.map((r) => `${r.type} ${r.total}${r.customer ? ` (${r.customer})` : ""}`).join(", ")}.`
    : "Abhi koi recent entry nahi mili.";
  return { answer: summary, proposal: null, tool_calls: toolLog, model: "rules-fallback", latency_ms: Date.now() - t0, rounds: 1 };
}
