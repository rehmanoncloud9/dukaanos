/**
 * Pure-client deterministic turn engine with no LLM cost.
 * - Offline text: resolves against cached ShopState so ReviewSheet/PaymentSheet/PulseSheet open immediately.
 * - Online text: strict confidence gate — only fast-paths exact catalog/alias + unambiguous customer matches.
 */

import { stateToCatalog, type PakPhoneTrace, type Pulse, type ShopState, type TurnResponse, type TurnTrace } from "@/lib/api/contracts";
import { buildPaymentProposal, buildSaleProposal } from "@/lib/domain/bill";
import { detectViewCommand, parseFallback } from "@/lib/domain/fallback-parser";
import { answerQuestionFromState } from "@/lib/domain/qa";
import { detectWadaUtterance } from "@/lib/domain/wada";
import type { Catalog } from "@/lib/domain/types";

const catalogCache = new WeakMap<ShopState, Catalog>();

function catalogForState(state: ShopState): Catalog {
  const cached = catalogCache.get(state);
  if (cached) return cached;
  const catalog = stateToCatalog(state);
  catalogCache.set(state, catalog);
  return catalog;
}

export function buildLocalPulse(state: ShopState): Pulse {
  const overdueItems = state.customers
    .filter((c) => c.balance_paisa > 0 && (c.days_overdue ?? 0) >= 15)
    .sort((a, b) => b.balance_paisa - a.balance_paisa)
    .map((c) => ({
      id: c.id,
      name: c.name,
      role_tag: c.role_tag ?? null,
      phone: c.phone ?? null,
      balance_paisa: c.balance_paisa,
      last_paid_at: c.last_paid_at ?? null,
      oldest_unpaid_at: c.last_paid_at ?? state.shop.active_since,
      days_overdue: c.days_overdue ?? 15,
    }));

  const stockoutItems = state.products
    .filter((p) => p.days_left !== null && p.days_left <= 2)
    .sort((a, b) => (a.days_left ?? 99) - (b.days_left ?? 99))
    .map((p) => ({
      id: p.id,
      name: p.name,
      name_ur: p.name_ur ?? null,
      base_unit: p.base_unit,
      pack_size_base_units: p.pack_size_base_units,
      stock_base_units: p.stock_base_units,
      sold_7d: p.sold_7d,
      daily_avg: p.sold_7d / 7,
      days_left: p.days_left ?? 0,
      suggested_base_units: Math.max(p.pack_size_base_units, Math.ceil((p.sold_7d / 7) * 7)),
    }));

  return {
    overdue: {
      count: overdueItems.length,
      total_paisa: overdueItems.reduce((sum, c) => sum + c.balance_paisa, 0),
      items: overdueItems,
    },
    stockout: {
      count: stockoutItems.length,
      items: stockoutItems,
    },
    galla: state.today,
    generated_at: new Date().toISOString(),
    sql_ms: 0,
    llm_cost_rs: 0,
  };
}

export function tryLocalTurn(
  rawText: string,
  state: ShopState | null,
  opts: { offline: boolean },
): TurnResponse | null {
  const text = rawText.trim();
  if (!text || !state) return null;

  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const catalog = catalogForState(state);
  const parsed = parseFallback(text);
  const wadaDate = detectWadaUtterance(text);

  const makeTrace = (intent: string, pakphone: PakPhoneTrace | null): TurnTrace => {
    const ms = Math.max(1, Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0));
    return {
      transcript: parsed.transcript,
      transcript_roman: parsed.transcript,
      source: "regex",
      model: null,
      latency_ms: ms,
      api_ms: ms,
      attempts: [],
      pakphone,
      intent,
    };
  };

  if (opts.offline) {
    const nav = detectViewCommand(text);
    if (nav) {
      return { kind: "navigate", ...nav, trace: makeTrace("navigate", null) };
    }
    if (wadaDate && parsed.intent !== "pulse" && parsed.intent !== "reversal") {
      const block = buildPaymentProposal(parsed, catalog.customers).customer;
      return {
        kind: "promise",
        proposal: { customer: block, promise_date: wadaDate },
        trace: makeTrace("promise", null),
      };
    }

    switch (parsed.intent) {
      case "pulse":
        return { kind: "pulse", pulse: buildLocalPulse(state), trace: makeTrace("pulse", null) };
      case "payment": {
        const proposal = buildPaymentProposal(parsed, catalog.customers);
        return {
          kind: "payment",
          proposal,
          trace: makeTrace("payment", {
            ms_total: proposal.customer.match_ms,
            items: [],
            customer: parsed.customer_mention
              ? {
                  mention: parsed.customer_mention,
                  candidates: proposal.customer.candidates.map((c) => ({ name: c.name, score: c.score })),
                  ms: proposal.customer.match_ms,
                }
              : null,
          }),
        };
      }
      case "reversal": {
        const target = state.feed.find((t) => t.type !== "reversal" && !t.is_reversed) ?? null;
        return { kind: "reversal", target, trace: makeTrace("reversal", null) };
      }
      case "purchase":
        return { kind: "purchase", trace: makeTrace("purchase", null) };
      case "question":
        return {
          kind: "answer",
          answer: answerQuestionFromState(parsed.question || text, state),
          proposal: null,
          tools: [],
          trace: makeTrace("question", null),
        };
      case "sale": {
        const proposal = buildSaleProposal(parsed, catalog, { tier1EvidenceVerified: false });
        if (proposal.lines.length === 0) return null;
        const pakphone: PakPhoneTrace = {
          ms_total: proposal.customer.match_ms + proposal.lines.reduce((s, l) => s + (l.match?.ms ?? 0), 0),
          items: proposal.lines.map((l) => ({
            spoken: l.spoken,
            matched: l.match?.matched ?? "",
            product: l.kind === "catalog" ? l.name : null,
            score: l.match?.score ?? 0,
            key: l.match?.key ?? "none",
            ms: l.match?.ms ?? 0,
            formula: l.formula,
          })),
          customer: proposal.customer.mention
            ? {
                mention: proposal.customer.mention,
                candidates: proposal.customer.candidates.map((c) => ({ name: c.name, score: c.score })),
                ms: proposal.customer.match_ms,
              }
            : null,
        };
        return { kind: "sale", proposal, trace: makeTrace("sale", pakphone) };
      }
      default:
        return null;
    }
  }

  // Online strict confidence gate: never bypass Gemini on ambiguity, questions, wada, or partial matches.
  const onlineNav = detectViewCommand(text);
  if (onlineNav) return { kind: "navigate", ...onlineNav, trace: makeTrace("navigate", null) };
  if (wadaDate) return null;

  if (parsed.intent === "pulse") {
    return { kind: "pulse", pulse: buildLocalPulse(state), trace: makeTrace("pulse", null) };
  }

  if (parsed.intent === "payment") {
    if (!parsed.customer_mention || parsed.payment_amount_rupees === null || parsed.payment_amount_rupees <= 0 || parsed.number_unresolved) {
      return null;
    }
    const proposal = buildPaymentProposal(parsed, catalog.customers);
    if (!proposal.customer.selected_id || proposal.customer.ambiguous || (proposal.customer.candidates[0]?.score ?? 0) < 1) {
      return null;
    }
    return {
      kind: "payment",
      proposal,
      trace: makeTrace("payment", {
        ms_total: proposal.customer.match_ms,
        items: [],
        customer: {
          mention: parsed.customer_mention,
          candidates: proposal.customer.candidates.map((c) => ({ name: c.name, score: c.score })),
          ms: proposal.customer.match_ms,
        },
      }),
    };
  }

  if (parsed.intent === "sale") {
    if (parsed.items.length === 0 || parsed.number_unresolved) return null;
    const isSimpleCash = parsed.payment_mode === "cash" && parsed.discount_rupees === null && !parsed.customer_mention;
    const boosted = isSimpleCash
      ? { ...parsed, confidence: 0.95, items: parsed.items.map((it) => ({ ...it, confidence: 0.95 })) }
      : parsed;
    const proposal = buildSaleProposal(boosted, catalog, { tier1EvidenceVerified: true });
    if (proposal.lines.length === 0) return null;

    const allExactCatalog = proposal.lines.every(
      (l) => l.kind === "catalog" && (l.match?.score ?? 0) >= 0.9 && !l.number_unresolved && l.price_known,
    );
    if (!allExactCatalog) return null;

    if (parsed.customer_mention) {
      if (!proposal.customer.selected_id || proposal.customer.ambiguous || (proposal.customer.candidates[0]?.score ?? 0) < 0.9) {
        return null;
      }
    }

    const pakphone: PakPhoneTrace = {
      ms_total: proposal.customer.match_ms + proposal.lines.reduce((s, l) => s + (l.match?.ms ?? 0), 0),
      items: proposal.lines.map((l) => ({
        spoken: l.spoken,
        matched: l.match?.matched ?? "",
        product: l.kind === "catalog" ? l.name : null,
        score: l.match?.score ?? 0,
        key: l.match?.key ?? "none",
        ms: l.match?.ms ?? 0,
        formula: l.formula,
      })),
      customer: proposal.customer.mention
        ? {
            mention: proposal.customer.mention,
            candidates: proposal.customer.candidates.map((c) => ({ name: c.name, score: c.score })),
            ms: proposal.customer.match_ms,
          }
        : null,
    };
    return { kind: "sale", proposal, trace: makeTrace("sale", pakphone) };
  }

  return null;
}
