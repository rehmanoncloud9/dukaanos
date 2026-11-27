import { z } from "zod";
import { runAgent } from "@/lib/ai/agent";
import { parseTurn } from "@/lib/ai/munshi";
import { ApiError, handle, ok, parseJson } from "@/lib/api/http";
import type { PakPhoneTrace, Pulse, TurnResponse, TurnTrace } from "@/lib/api/contracts";
import { loadCatalog, numify } from "@/lib/api/shop";
import { buildPaymentProposal, buildSaleProposal, settle } from "@/lib/domain/bill";
import { parseQuantityPhrase, resolveLine } from "@/lib/domain/desi-units";
import { PULSE_REGEX, detectViewCommand } from "@/lib/domain/fallback-parser";
import { answerQuestionFromState } from "@/lib/domain/qa";
import { detectWadaUtterance } from "@/lib/domain/wada";
import { requireShopContext } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { AUDIO_MIME_TYPES, audioContentMatches, readMultipartLimited } from "@/lib/server/media-validation";
import type { Catalog, ProposalLine, SaleProposal } from "@/lib/domain/types";
import { rpc } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 60;

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 128 * 1024;

export const POST = handle(async (req: Request) => {
  const t0 = Date.now();
  const { sb, shopId, userId } = await requireShopContext(req);
  await enforceRateLimit(`ai:voice:${userId}`, 30, "1 minute");

  let audio: { base64: string; mimeType: string } | null = null;
  let text: string | null = null;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.startsWith("multipart/form-data")) {
    let parsed: FormData | null;
    try {
      parsed = await readMultipartLimited(req, MAX_AUDIO_BYTES + MAX_MULTIPART_OVERHEAD);
    } catch {
      throw new ApiError("BAD_REQUEST", "Malformed multipart audio request");
    }
    if (!parsed) throw new ApiError("AUDIO_TOO_LARGE", "Request exceeds the 4 MB audio limit");
    const form = parsed;
    const file = form.get("audio");
    const t = form.get("text");
    text = typeof t === "string" && t.trim() ? t.trim() : null;
    if (file && typeof file !== "string") {
      const mime = (file.type || "").toLowerCase();
      if (!mime.startsWith("audio/")) throw new ApiError("UNSUPPORTED_MEDIA", `Expected audio/*, got "${mime || "unknown"}"`);
      const mediaType = mime.split(";")[0].trim();
      if (!AUDIO_MIME_TYPES.some((supported) => supported === mediaType)) {
        throw new ApiError("UNSUPPORTED_MEDIA", "Supported audio formats are WebM, Ogg, WAV, MP4, MP3, and FLAC");
      }
      if (file.size === 0) throw new ApiError("BAD_REQUEST", "Audio clip is empty");
      if (file.size > MAX_AUDIO_BYTES) throw new ApiError("AUDIO_TOO_LARGE", `Clip is ${(file.size / 1e6).toFixed(1)} MB (max 4 MB)`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!audioContentMatches(mediaType, bytes)) throw new ApiError("UNSUPPORTED_MEDIA", "Audio file contents do not match the declared format");
      audio = { base64: Buffer.from(bytes).toString("base64"), mimeType: mediaType };
    }
  } else {
    text = (await parseJson(req, z.object({ text: z.string().trim().min(1).max(600) }))).text;
  }
  if (!audio && !text) throw new ApiError("BAD_REQUEST", "Send an audio clip or text");

  // Fast path — no catalog, no LLM: pure SQL Pulse.
  if (!audio && text && PULSE_REGEX.test(text)) {
    const pulse = numify(await rpc<Pulse>(sb, "get_munshi_pulse", { p_shop_id: shopId }));
    const api_ms = Date.now() - t0;
    const trace: TurnTrace = { transcript: text, source: "regex", model: null, latency_ms: api_ms, api_ms, attempts: [], pakphone: null, intent: "pulse" };
    return ok<TurnResponse>({ kind: "pulse", pulse: { ...pulse, api_ms }, trace });
  }

  const { state, catalog } = await loadCatalog(sb, shopId);

  // Build per-shop context for systemPrompt (~120 tokens, zero LLM cost)
  const productList = Array.isArray(state?.products) ? state.products : catalog.products;
  const topSkus = [...productList]
    .sort((a, b) => ((b as { sold_7d?: number }).sold_7d ?? 0) - ((a as { sold_7d?: number }).sold_7d ?? 0))
    .slice(0, 15)
    .map((p) => p.name);
  const topCustomers = [...catalog.customers]
    .filter((c) => c.balance_paisa > 0)
    .sort((a, b) => b.balance_paisa - a.balance_paisa)
    .slice(0, 10)
    .map((c) => c.name);

  const turn = await parseTurn({ audio, text, catalog, shopName: state.shop.name, shopId, context: { topSkus, topCustomers } });
  const p = turn.parsed;
  const baseTrace = (pakphone: PakPhoneTrace | null): TurnTrace => ({
    transcript: p.transcript,
    transcript_roman: (p as { transcript_roman?: string }).transcript_roman,
    source: turn.source,
    model: turn.model,
    latency_ms: turn.latency_ms,
    api_ms: Date.now() - t0,
    attempts: turn.attempts,
    pakphone,
    degraded_reason: turn.degraded_reason,
    intent: p.intent,
  });

  // Mutual Khata wada: a promise word + a resolvable date overrides the model's intent. The date
  // is computed by deterministic TS (wada.ts), never by the LLM; nothing is written until confirmed.
  const wadaDate = detectWadaUtterance((p as { transcript_roman?: string }).transcript_roman) ?? detectWadaUtterance(p.transcript) ?? detectWadaUtterance(text);
  if (wadaDate && p.intent !== "pulse" && p.intent !== "reversal") {
    const block = buildPaymentProposal(p, catalog.customers).customer;
    return ok<TurnResponse>({ kind: "promise", proposal: { customer: block, promise_date: wadaDate }, trace: { ...baseTrace(null), intent: "promise" } });
  }

  const nav = detectViewCommand((p as { transcript_roman?: string }).transcript_roman || p.transcript);
  if (nav) {
    return ok<TurnResponse>({ kind: "navigate", ...nav, trace: { ...baseTrace(null), intent: "navigate" } });
  }

  switch (p.intent) {
    case "pulse": {
      const pulse = numify(await rpc<Pulse>(sb, "get_munshi_pulse", { p_shop_id: shopId }));
      return ok<TurnResponse>({ kind: "pulse", pulse, trace: baseTrace(null) });
    }
    case "payment": {
      const proposal = buildPaymentProposal(p, catalog.customers);
      return ok<TurnResponse>({
        kind: "payment",
        proposal,
        trace: baseTrace({
          ms_total: proposal.customer.match_ms,
          items: [],
          customer: p.customer_mention
            ? { mention: p.customer_mention, candidates: proposal.customer.candidates.map((c) => ({ name: c.name, score: c.score })), ms: proposal.customer.match_ms }
            : null,
        }),
      });
    }
    case "reversal": {
      const target = state.feed.find((t) => t.type !== "reversal" && !t.is_reversed) ?? null;
      return ok<TurnResponse>({ kind: "reversal", target, trace: baseTrace(null) });
    }
    case "question": {
      let r: Awaited<ReturnType<typeof runAgent>>;
      try {
        r = await runAgent({ question: p.question || p.transcript, sb, shopId, shopName: state.shop.name, catalog });
      } catch (agentErr) {
        // Deterministic Q&A fallback: answer balance/stock/report queries without AI
        const deterministicAnswer = answerQuestionFromState(p.question || p.transcript, state);
        return ok<TurnResponse>({
          kind: "answer",
          answer: deterministicAnswer,
          proposal: null,
          tools: [],
          trace: {
            ...baseTrace(null),
            model: null,
            degraded_reason: agentErr instanceof Error ? agentErr.message.slice(0, 160) : "agent unavailable",
          },
        });
      }
      return ok<TurnResponse>({
        kind: "answer",
        answer: r.answer,
        proposal: r.proposal,
        tools: r.tool_calls.map((t) => ({ name: t.name, ms: t.ms })),
        trace: { ...baseTrace(null), model: r.model, latency_ms: turn.latency_ms + r.latency_ms },
      });
    }
    case "purchase":
      return ok<TurnResponse>({ kind: "purchase", trace: baseTrace(null) });
    case "sale": {
      if (!p.items.length) return ok<TurnResponse>({ kind: "unknown", trace: baseTrace(null) });
      let proposal = buildSaleProposal(p, catalog);
      proposal = await upgradeWithTrgm(proposal, sb, shopId, catalog);
      const pak: PakPhoneTrace = {
        ms_total: Math.round((proposal.lines.reduce((s, l) => s + (l.match?.ms ?? 0), 0) + proposal.customer.match_ms) * 100) / 100,
        items: proposal.lines.map((l) => ({
          spoken: l.spoken,
          matched: l.match?.matched ?? "",
          product: l.product_id ? l.name : null,
          score: l.match?.score ?? 0,
          key: l.match?.key ?? "",
          ms: l.match?.ms ?? 0,
          formula: l.formula,
        })),
        customer: p.customer_mention
          ? { mention: p.customer_mention, candidates: proposal.customer.candidates.map((c) => ({ name: c.name, score: c.score })), ms: proposal.customer.match_ms }
          : null,
      };
      return ok<TurnResponse>({ kind: "sale", proposal, trace: baseTrace(pak) });
    }
    default:
      return ok<TurnResponse>({ kind: "unknown", trace: baseTrace(null) });
  }
});

/**
 * Server-side dialect fallback: QuickAdd lines get one more chance against the 100+
 * pg_trgm aliases (e.g. a Potohari spelling PakPhone missed) before the UI offers QuickAdd.
 */
async function upgradeWithTrgm(proposal: SaleProposal, sb: SupabaseClient, shopId: string, catalog: Catalog): Promise<SaleProposal> {
  if (!proposal.lines.some((l) => l.kind === "new_sku")) return proposal;
  let changed = false;
  const lines: ProposalLine[] = [];
  for (const l of proposal.lines) {
    if (l.kind !== "new_sku" || l.number_unresolved) {
      lines.push(l);
      continue;
    }
    const quantity = parseQuantityPhrase(l.quantity_phrase);
    if (quantity.unresolved || (!l.quantity_phrase && l.value_paisa === null)) {
      lines.push(l);
      continue;
    }
    try {
      const hits = await rpc<Array<{ product_id: string; name: string; score: number }>>(sb, "search_catalog", { p_shop_id: shopId, p_query: l.spoken, p_limit: 1 });
      const hit = hits?.[0];
      const product = hit && hit.score >= 0.55 ? catalog.products.find((x) => x.id === hit.product_id) : undefined;
      if (hit && product) {
        const res = resolveLine(product, { quantity, value_paisa: l.value_paisa });
        changed = true;
        lines.push({
          ...l,
          kind: "catalog",
          product_id: product.id,
          name: product.name,
          base_unit: product.base_unit,
          pack_size_base_units: product.pack_size_base_units,
          unit_price_paisa: product.unit_price_paisa,
          qty_base_units: res.qty_base_units,
          line_total_paisa: res.line_total_paisa,
          value_first: res.value_first,
          formula: `${res.formula} · pg_trgm(${Number(hit.score).toFixed(2)})`,
          match: { score: Number(Number(hit.score).toFixed(3)), matched: `pg_trgm:${product.name}`, ms: l.match?.ms ?? 0, key: l.match?.key ?? "" },
          confidence: Math.min(0.89, Number(hit.score) + 0.3), // trgm matches always get a human glance
          stock_after: product.stock_base_units - res.qty_base_units,
          price_known: true,
        });
        continue;
      }
    } catch {
      /* trgm is best-effort */
    }
    lines.push(l);
  }
  if (!changed) return proposal;
  return settle({
    lines,
    discount_paisa: proposal.discount_paisa,
    cash_paid_paisa: proposal.cash_explicit ? proposal.cash_paid_paisa + proposal.change_due_paisa : null,
    payment_mode: proposal.payment_mode,
    customer: proposal.customer,
    customers: catalog.customers,
    confidence: proposal.confidence,
  });
}
