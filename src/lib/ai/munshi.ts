/**
 * Chaos Voice Compiler — single-pass native audio→JSON on AI_FAST_MODEL.
 * The model ONLY transcribes and extracts mentions. It never computes totals, never
 * resolves units and never touches the database: desi-units.ts, pakphone.ts and the
 * commit_sale RPC do all arithmetic deterministically.
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/http";
import { env } from "@/lib/env";
import { FALLBACK_CONFIDENCE, parseFallback, PULSE_REGEX } from "@/lib/domain/fallback-parser";
import type { Catalog, ParsedTurn } from "@/lib/domain/types";
import { generateWithFallback, parseModelJson } from "./models";

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };

export const PARSED_TURN_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["sale", "payment", "reversal", "pulse", "purchase", "question", "unknown"] },
    transcript: { type: "string", description: "Verbatim transcript in the speaker's own script/language mix" },
    transcript_roman: { type: "string", description: "Same utterance in Roman Urdu" },
    customer_mention: { ...nullableString, description: "Customer as spoken, e.g. 'Chhote Ali', 'Bilal'" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          spoken: { type: "string", description: "Item name as spoken in Roman Urdu, e.g. 'cheeni', 'khula oil'" },
          quantity_phrase: { ...nullableString, description: "Quantity exactly as spoken: 'dedh pao', 'ek kilo', '2 packet', 'ek darjan'. null for value-first" },
          value_rupees: { ...nullableNumber, description: "Value-first amount: '250 ka khula oil' → 250" },
          is_loose: { type: "boolean", description: "khula/khuli/loose" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["spoken", "quantity_phrase", "value_rupees", "is_loose", "confidence"],
      },
    },
    discount_rupees: { ...nullableNumber, description: "Bargaining discount: '30 rupay chhor do' → 30" },
    cash_paid_rupees: { ...nullableNumber, description: "Cash actually handed over: '400 cash diya' → 400" },
    payment_mode: { type: "string", enum: ["cash", "udhaar", "split", "unspecified"] },
    payment_amount_rupees: { ...nullableNumber, description: "For intent=payment only: 'Bilal ne 1500 jama karwaye' → 1500" },
    question: { ...nullableString, description: "For intent=question: the question in Roman Urdu" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "intent", "transcript", "transcript_roman", "customer_mention", "items", "discount_rupees",
    "cash_paid_rupees", "payment_mode", "payment_amount_rupees", "question", "confidence",
  ],
} as const;

const ParsedTurnZ = z.object({
  intent: z.enum(["sale", "payment", "reversal", "pulse", "purchase", "question", "unknown"]),
  transcript: z.string(),
  transcript_roman: z.string().optional().default(""),
  customer_mention: z.string().nullable(),
  items: z.array(z.object({
    spoken: z.string(),
    quantity_phrase: z.string().nullable(),
    value_rupees: z.number().nullable(),
    is_loose: z.boolean(),
    confidence: z.number().min(0).max(1),
  })),
  discount_rupees: z.number().nullable(),
  cash_paid_rupees: z.number().nullable(),
  payment_mode: z.enum(["cash", "udhaar", "split", "unspecified"]),
  payment_amount_rupees: z.number().nullable(),
  question: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export function systemPrompt(catalog: Catalog, shopName: string): string {
  const products = catalog.products.slice(0, 120).map((p) => `${p.name}${p.aliases.length ? ` (${p.aliases.slice(0, 4).join(", ")})` : ""}`);
  const customers = catalog.customers.slice(0, 80).map((c) => `${c.name}${c.role_tag ? ` · ${c.role_tag}` : ""}`);
  return [
    `You are the counter clerk ("munshi") of ${shopName}, a Pakistani kiryana store.`,
    "Listen to a shopkeeper speaking code-switched Urdu / Punjabi / Potohari / English at a noisy counter and return ONE JSON object matching the schema.",
    "Hard rules:",
    "- Extract mentions only. NEVER add up prices, NEVER convert units, NEVER invent prices or totals.",
    "- quantity_phrase must be the words as spoken (e.g. 'dedh pao', 'adha kilo', 'sawa do kilo', '2 packet', 'ek darjan', '500 gram').",
    "- Value-first purchases ('250 ka khula oil', '100 rupay ki cheeni') go in value_rupees with quantity_phrase null.",
    "- 'N rupay chhor do' / 'N kam kar do' is discount_rupees. 'N cash diya' / 'N diye' is cash_paid_rupees.",
    "- 'khate mein', 'udhaar', 'likh do', 'baqi' mean credit. Cash + baqi khate mein = split.",
    "- A customer named before 'ko' is the buyer; 'X ne N jama karwaye' is intent=payment.",
    "- 'subah ka hisaab', 'aaj ka haal' → intent=pulse. 'wapas kar do', 'cancel', 'galat entry' → intent=reversal.",
    "- Questions about balances, stock or sales → intent=question with the question in Roman Urdu.",
    "- Use Roman Urdu for spoken item names; keep brand names as spoken (Lays, Surf, Tapal).",
    "- confidence reflects audio clarity and certainty of each mention (0..1). Be honest; use <0.9 when unsure.",
    `Known products (spelling hints only, do not force-match): ${products.join("; ")}.`,
    `Known customers (spelling hints only): ${customers.join("; ")}.`,
  ].join("\n");
}

export interface TurnInput {
  audio?: { base64: string; mimeType: string } | null;
  text?: string | null;
  catalog: Catalog;
  shopName: string;
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

export async function parseTurn(input: TurnInput): Promise<TurnParse> {
  const t0 = Date.now();
  const text = input.text?.trim() ?? "";

  // Fast path: "Subah ka hisaab batao" never touches the LLM (<300 ms, Rs. 0).
  if (!input.audio && text && PULSE_REGEX.test(text)) {
    return { parsed: pulseTurn(text), source: "regex", model: null, latency_ms: Date.now() - t0, attempts: [] };
  }

  const parts: Array<Record<string, unknown>> = [];
  if (input.audio) parts.push({ inlineData: { mimeType: input.audio.mimeType, data: input.audio.base64 } });
  parts.push({ text: input.audio ? "Transcribe this counter audio and extract the JSON." : `Shopkeeper typed: """${text}"""\nExtract the JSON.` });

  try {
    const call = await generateWithFallback(env.fastModel(), {
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: systemPrompt(input.catalog, input.shopName),
        responseMimeType: "application/json",
        responseJsonSchema: PARSED_TURN_JSON_SCHEMA,
        temperature: 0,
      },
    });
    const raw = parseModelJson<unknown>(call.response);
    const checked = ParsedTurnZ.safeParse(raw);
    if (!checked.success) throw new ApiError("AI_UNAVAILABLE", "Model JSON failed schema validation", checked.error.issues);
    const parsed = checked.data as ParsedTurn & { transcript_roman?: string };
    if (parsed.intent !== "pulse" && (PULSE_REGEX.test(parsed.transcript) || PULSE_REGEX.test(parsed.transcript_roman ?? ""))) {
      parsed.intent = "pulse";
    }
    return { parsed, source: "model", model: call.model, latency_ms: Date.now() - t0, attempts: call.attempts };
  } catch (e) {
    // Typed input degrades to the deterministic rule parser (always Tier-2 review).
    if (text) {
      const parsed = parseFallback(text);
      return {
        parsed: { ...parsed, confidence: Math.min(parsed.confidence, FALLBACK_CONFIDENCE) },
        source: "rules",
        model: null,
        latency_ms: Date.now() - t0,
        attempts: e instanceof ApiError && e.details && typeof e.details === "object" && "attempts" in e.details
          ? (e.details as { attempts: TurnParse["attempts"] }).attempts
          : [],
        degraded_reason: e instanceof Error ? e.message.slice(0, 160) : "model unavailable",
      };
    }
    // Audio cannot be guessed: surface the error; the client keeps the clip queued for 1-tap retry.
    throw e;
  }
}
