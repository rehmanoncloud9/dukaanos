/** Single-pass native audio/text extraction on the configured fast Gemini model. */

import { z } from "zod";
import { ApiError } from "@/lib/api/http";
import { env } from "@/lib/env";
import { FALLBACK_CONFIDENCE, parseFallback, PULSE_REGEX } from "@/lib/domain/fallback-parser";
import { parseQuantityPhrase } from "@/lib/domain/desi-units";
import type { Catalog, ParsedTurn } from "@/lib/domain/types";
import { normalizeUrduNumberWords, parseRupeeAmount } from "@/lib/domain/urdu-numbers";
import { generateContentOnce, parseModelJson } from "./models";

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableAmount = { anyOf: [{ type: "number" }, { type: "null" }] };

/** Structured extraction schema. Raw number phrases remain evidence beside normalized values. */
export const PARSED_TURN_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["sale", "payment", "reversal", "pulse", "purchase", "question", "unknown"] },
    transcript: { type: "string", description: "Verbatim words in the speaker's script and language mix" },
    transcript_roman: { type: "string", description: "Roman Urdu rendering, preserving the same words" },
    customer_mention: { ...nullableString, description: "Customer name as spoken" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          spoken: { type: "string", description: "Product words as spoken; do not guess a catalog match" },
          quantity_phrase: { ...nullableString, description: "Exact quantity words, for example 'dhai kilo' or 'دو کلو'" },
          value_phrase: { ...nullableString, description: "Raw amount phrase for value-first items; null when absent" },
          value_rupees: nullableAmount,
          is_loose: { type: "boolean" },
          confidence: { type: "number" },
        },
        required: ["spoken", "quantity_phrase", "value_phrase", "value_rupees", "is_loose", "confidence"],
      },
    },
    discount_phrase: { ...nullableString, description: "Raw discount amount phrase, if spoken" },
    discount_rupees: nullableAmount,
    cash_phrase: { ...nullableString, description: "Raw amount phrase for cash received, if a number was spoken" },
    cash_paid_rupees: nullableAmount,
    payment_mode: { type: "string", enum: ["cash", "udhaar", "split", "unspecified"] },
    payment_amount_phrase: { ...nullableString, description: "Raw amount phrase for a payment collection" },
    payment_amount_rupees: nullableAmount,
    question: { ...nullableString, description: "Question as spoken" },
    confidence: { type: "number" },
  },
  required: [
    "intent", "transcript", "transcript_roman", "customer_mention", "items", "discount_phrase", "discount_rupees",
    "cash_phrase", "cash_paid_rupees", "payment_mode", "payment_amount_phrase", "payment_amount_rupees", "question", "confidence",
  ],
} as const;

const NullableAmountZ = z.number().finite().min(0).max(100_000_000).nullable();
export const ParsedTurnZ = z.object({
  intent: z.enum(["sale", "payment", "reversal", "pulse", "purchase", "question", "unknown"]),
  transcript: z.string().max(2_000),
  transcript_roman: z.string().max(2_000),
  customer_mention: z.string().max(120).nullable(),
  items: z.array(z.object({
    spoken: z.string().trim().min(1).max(120),
    quantity_phrase: z.string().max(120).nullable(),
    value_phrase: z.string().max(120).nullable(),
    value_rupees: NullableAmountZ,
    is_loose: z.boolean(),
    confidence: z.number().finite().min(0).max(1),
  })).max(40),
  discount_phrase: z.string().max(120).nullable(),
  discount_rupees: NullableAmountZ,
  cash_phrase: z.string().max(120).nullable(),
  cash_paid_rupees: NullableAmountZ,
  payment_mode: z.enum(["cash", "udhaar", "split", "unspecified"]),
  payment_amount_phrase: z.string().max(120).nullable(),
  payment_amount_rupees: NullableAmountZ,
  question: z.string().max(1_000).nullable(),
  confidence: z.number().finite().min(0).max(1),
});

/** Compact and stable extraction instructions; catalog resolution remains deterministic. */
export function systemPrompt(shopName: string, context?: { topSkus?: string[]; topCustomers?: string[] }): string {
  const baseLines = [
    `You are the counter clerk for ${shopName}, a Pakistani kiryana shop.`,
    "Return one JSON object matching the schema. Listen to Urdu, Roman Urdu, Punjabi, Saraiki, Pashto, Sindhi, Potohari, and English mix, including pauses and self-corrections.",
    "Transcribe before interpreting. Keep exact product words. Ignore background chatter/TV; if speech is incomplete or has no shop action, return intent 'unknown' (never guess).",
    "Self-corrections: for '2 kilo cheeni nahi balke 1 kilo cheeni', 'nahi, woh nahi... 2 kilo nahi 5 kilo', or 'Ali nahi Tariq ko', keep ONLY the final corrected value.",
    "Numbers: keep raw phrases and normalize only when clear ('dhai kilo'=2.5, 'dhai sau rupay'=250, 'sawa do sau'=225, 'ڈھائی سو'=250).",
    "Value-first: '250 ka khula oil' is Rs. 250 value-first; 'do packet chips' has quantity 'do packet'. Do not calculate line totals or balances.",
    "'N chhor do'=discount. 'N cash diya'=cash. 'khate mein'/'udhaar'/'likh do'/'baqi'=credit; cash+remaining=split. 'X ne N jama karwaye'=payment.",
    "Intent: pulse='subah ka hisaab'/'aaj ka haal'; reversal=undo/cancel; question=questions. Keep transcript and Roman faithful.",
    "Never do arithmetic, unit math, or price inference. Set lower confidence or null for unclear words/numbers.",
  ];
  // Per-shop context grounding (~120 tokens). Injected only when non-empty.
  if (context?.topSkus && context.topSkus.length > 0) {
    baseLines.push(`Top products in this shop (for reference only — do not force a match): ${context.topSkus.slice(0, 15).join(", ")}.`);
  }
  if (context?.topCustomers && context.topCustomers.length > 0) {
    baseLines.push(`Frequent customers (for reference only — do not force a match): ${context.topCustomers.slice(0, 10).join(", ")}.`);
  }
  return baseLines.join("\n");
}

export interface TurnInput {
  audio?: { base64: string; mimeType: string } | null;
  text?: string | null;
  catalog: Catalog;
  shopName: string;
  shopId?: string;
  /** Optional per-shop context grounding (~120 tokens). Top SKUs and customers. */
  context?: { topSkus?: string[]; topCustomers?: string[] };
}

export interface TurnParse {
  parsed: ParsedTurn & { transcript_roman?: string };
  source: "regex" | "model" | "rules";
  model: string | null;
  latency_ms: number;
  attempts: Array<{ model: string; ok: boolean; error?: string; ms: number }>;
  degraded_reason?: string;
}

function pulseTurn(transcript: string): ParsedTurn {
  return {
    intent: "pulse", transcript, customer_mention: null, items: [], discount_rupees: null, cash_paid_rupees: null,
    payment_mode: "unspecified", payment_amount_rupees: null, question: null, confidence: 1,
  };
}

function amountFromEvidence(raw: string | null, claimed: number | null): { amount: number | null; unresolved: boolean } {
  if (raw === null) return { amount: claimed, unresolved: claimed !== null };
  const parsed = parseRupeeAmount(raw);
  if (!parsed) return { amount: null, unresolved: true };
  if (claimed !== null) {
    const normalizedClaim = parseRupeeAmount(String(claimed));
    if (!normalizedClaim || normalizedClaim.paisa !== parsed.paisa) return { amount: null, unresolved: true };
  }
  return { amount: parsed.rupees, unresolved: false };
}

function normalizeModelTurn(value: z.infer<typeof ParsedTurnZ>): ParsedTurn & { transcript_roman: string } {
  let numberUnresolved = false;
  const items = value.items.map((item) => {
    const quantity = parseQuantityPhrase(item.quantity_phrase);
    let valueRupees: number | null = null;
    let itemUnresolved = Boolean(
      (item.quantity_phrase && quantity.unresolved)
      || (!item.quantity_phrase && !item.value_phrase)
      || (item.quantity_phrase && item.value_phrase),
    );
    if (item.value_phrase !== null || item.value_rupees !== null) {
      const amount = amountFromEvidence(item.value_phrase, item.value_rupees);
      valueRupees = amount.amount;
      itemUnresolved ||= amount.unresolved;
    }
    numberUnresolved ||= itemUnresolved;
    return {
      spoken: item.spoken,
      quantity_phrase: item.quantity_phrase,
      value_rupees: valueRupees,
      value_phrase: item.value_phrase,
      number_unresolved: itemUnresolved,
      is_loose: item.is_loose,
      confidence: itemUnresolved ? Math.min(item.confidence, 0.5) : item.confidence,
    };
  });

  const discount = amountFromEvidence(value.discount_phrase, value.discount_rupees);
  const cash = amountFromEvidence(value.cash_phrase, value.cash_paid_rupees);
  const payment = amountFromEvidence(value.payment_amount_phrase, value.payment_amount_rupees);
  numberUnresolved ||= discount.unresolved || cash.unresolved || payment.unresolved;

  const parsed: ParsedTurn & { transcript_roman: string } = {
    intent: value.intent,
    transcript: value.transcript,
    transcript_roman: value.transcript_roman,
    customer_mention: value.customer_mention,
    items,
    discount_rupees: discount.amount,
    discount_phrase: value.discount_phrase,
    cash_paid_rupees: cash.amount,
    cash_phrase: value.cash_phrase,
    payment_mode: value.payment_mode,
    payment_amount_rupees: payment.amount,
    payment_amount_phrase: value.payment_amount_phrase,
    question: value.question,
    confidence: value.confidence,
    number_unresolved: numberUnresolved,
  };

  const normalizedTranscript = normalizeUrduNumberWords(value.transcript).toLowerCase();
  const explicitCashWord = /\b(cash|naqd|nakad)\b/.test(normalizedTranscript);
  parsed.tier1_evidence_verified = !numberUnresolved
    && value.intent === "sale"
    && value.payment_mode === "cash"
    && explicitCashWord
    && value.discount_rupees === null
    && value.discount_phrase === null
    && value.confidence >= 0.9
    && items.length > 0
    && items.every((item) => item.confidence >= 0.9 && !item.number_unresolved);
  return parsed;
}

/** Parse a single audio/text turn. Audio failures throw so the client can retain the clip. */
export async function parseTurn(input: TurnInput): Promise<TurnParse> {
  const t0 = Date.now();
  const text = input.text?.trim() ?? "";

  if (input.audio && !input.audio.base64.trim()) {
    throw new ApiError("BAD_REQUEST", "Audio clip is empty");
  }

  if (!input.audio && text && PULSE_REGEX.test(normalizeUrduNumberWords(text))) {
    return { parsed: pulseTurn(text), source: "regex", model: null, latency_ms: Date.now() - t0, attempts: [] };
  }

  const parts: Array<Record<string, unknown>> = [];
  if (input.audio) parts.push({ inlineData: { mimeType: input.audio.mimeType, data: input.audio.base64 } });
  parts.push({ text: input.audio ? "Transcribe this counter audio and extract the structured fields." : `Shopkeeper typed: """${text}"""\nExtract the structured fields.` });

  try {
    const call = await generateContentOnce(env.fastModel(), {
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: systemPrompt(input.shopName, input.context),
        responseMimeType: "application/json",
        responseJsonSchema: PARSED_TURN_JSON_SCHEMA,
        temperature: 0,
        maxOutputTokens: 1_024,
      },
    }, env.aiTimeoutMs(), { shopId: input.shopId, kind: "voice" });
    const raw = parseModelJson(call.response);
    const checked = ParsedTurnZ.safeParse(raw);
    if (!checked.success) throw new ApiError("AI_UNAVAILABLE", "Model JSON failed schema validation", checked.error.issues);
    const parsed = normalizeModelTurn(checked.data);
    const roman = normalizeUrduNumberWords(parsed.transcript_roman);
    if (parsed.intent !== "pulse" && (PULSE_REGEX.test(parsed.transcript) || PULSE_REGEX.test(roman))) parsed.intent = "pulse";
    return { parsed, source: "model", model: call.model, latency_ms: Date.now() - t0, attempts: call.attempts };
  } catch (error) {
    if (text) {
      const parsed = parseFallback(text);
      return {
        parsed: { ...parsed, confidence: Math.min(parsed.confidence, FALLBACK_CONFIDENCE) },
        source: "rules",
        model: null,
        latency_ms: Date.now() - t0,
        attempts: error instanceof ApiError && error.details && typeof error.details === "object" && "attempts" in error.details
          ? (error.details as { attempts: TurnParse["attempts"] }).attempts
          : [],
        degraded_reason: error instanceof Error ? error.message.slice(0, 160) : "model unavailable",
      };
    }
    throw error;
  }
}
