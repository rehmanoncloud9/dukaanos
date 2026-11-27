/** Deterministic fallback parser. Its confidence is intentionally below Tier 1. */

import { isQuantityToken, parseQuantityPhrase } from "./desi-units";
import { transliterate } from "./pakphone";
import { normalizeUrduNumberWords, parseRupeeAmount } from "./urdu-numbers";
import type { Intent, ParsedItem, ParsedTurn, PaymentMode } from "./types";

export const FALLBACK_CONFIDENCE = 0.8;

export const PULSE_REGEX = /\b(subah?|subha|subuh)\s+(ka|ki)\s+(hisaa?b|hisab)\b|\baaj\s+ka\s+(haal|hisaa?b)\b|\bpulse\b|\bhisaa?b\s+batao\b|صبح کا حساب/i;

const REVERSAL_REGEX = /\b(wapas|wapis|waapas)\s+(kar|kr)|\bcancel\b|\bundo\b|\bgalat\s+entry\b|\bpichli\s+entry\b|\bentry\s+(hata|mita|delete)/i;
const PAYMENT_REGEX = /\b(jama|jamaa|jmaa)\b|\bwasooli\b|\bwasool\b|\bpayment\b|\bada\s+(kiye|kiya|kar)/i;
const PURCHASE_REGEX = /\bmaal\s+aaya\b|\bkhareed(a|e)\b|\bpurchase\b|\brestock\b/i;
const QUESTION_REGEX = /\?\s*$|^(kitna|kitne|kitni|kya|kaun|kab|kahan|how|what|which|who|when|batao\s+ke)\b|\b(baqaya|kitna\s+(?:udhaar|stock|maal|munafa|becha)|is\s+haftay|is\s+mahinay|sab\s+se\s+zyada)\b/i;
const UDHAAR_REGEX = /\bkhate\s+(mein|mai|me|main)\b|\bkhaate\b|\bkhata\b|\budhaa?r\b|\blikh\s+(do|lo|dein|den)\b|\bbaqi\b|\bbaaqi\b|\bbaki\b|\bbaaki\b|\bcredit\b/i;
const CASH_WORD = /\bcash\b|\bnaqd\b|\bnakad\b/i;
const LOOSE_WORD = /\b(khula|khuli|khule|loose)\b/i;

const NUMBER_WORD = "(?:ek|do|teen|char|panch|chhe|saat|aath|nau|das|gyarah|barah|terah|chaudah|pandrah|solah|satrah|atharah|unees|bees|pachees|tees|chalees|pachas|saath|sattar|assi|nabbe|sawa|paune|dedh|dhai|adha|sau|hazaar|lakh)";
const NUMBER_DIGITS = "(?:\\d{1,3}(?:,\\d{2})*,\\d{3}|\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?";
const NUMBER_ATOM = `(?:${NUMBER_DIGITS}|${NUMBER_WORD})`;
const NUMBER_EXPR = `(${NUMBER_ATOM}(?:\\s+${NUMBER_ATOM}){0,5})`;
const RS = "(?:/-|\\s*(?:rupay|rupaye|rupees?|rs\\.?|pkr|rupiya))?";

const CASH_PAID_PATTERNS = [
  new RegExp(`${NUMBER_EXPR}${RS}\\s*(?:cash|naqd)\\s*(?:diya|diye|de\\s+diye|mile|mila|liya|liye|paid)?`, "i"),
  new RegExp(`(?:cash|naqd)\\s*${NUMBER_EXPR}${RS}\\s*(?:diya|diye|mile|mila)?`, "i"),
  new RegExp(`${NUMBER_EXPR}${RS}\\s*(?:diya|diye|de\\s+diye|de\\s+gaya|de\\s+gayi)\\b`, "i"),
];

const DISCOUNT_PATTERNS = [
  new RegExp(`${NUMBER_EXPR}${RS}\\s*(?:chhor|chor|chhod|chod|chhorr|kam|discount|kaat)\\s*(?:do|diye|dain|den|dein|kar\\s+do|kiye|diya)?`, "i"),
  new RegExp(`(?:discount|riayat)\\s*${NUMBER_EXPR}${RS}`, "i"),
];

const FILLER = /\b(cash|naqd|de\s+do|dedo|dena|chahiye|chahye|please|bhai|jee|ji|aur\s+haan|dijiye|do\s+na|likh\s+do|khate\s+(mein|mai|me|main)|udhaa?r|baqi|baaqi|baki|baaki|mein|ko|kar\s+do|diya|diye|lelo|le\s+lo)\b/gi;

function amountNumber(value: string | undefined): number | null {
  if (!value) return null;
  return parseRupeeAmount(value)?.rupees ?? null;
}

function cut(text: string, re: RegExp): { text: string; match: RegExpMatchArray | null } {
  const match = text.match(re);
  if (!match || match.index === undefined) return { text, match: null };
  return { text: (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length)).replace(/\s+/g, " ").trim(), match };
}

export interface ViewCommand {
  tab: "munshi" | "khata" | "maal";
  filter?: string;
  sheet?: "insights" | "parchi" | "return";
}

/** Detect non-sale navigation/report commands such as "stock dikhao", "khata dikhao", "return entry". */
export function detectViewCommand(input: string): ViewCommand | null {
  const t = transliterate(normalizeUrduNumberWords(input)).toLowerCase().trim();
  if (/\b(return|wapasi|wapsi)\b/.test(t) && /\b(entry|item|maal|bill|kholo|dikhao|karna)\b/.test(t)) {
    return { tab: "munshi", sheet: "return" };
  }
  if (/\b(kam\s+stock|low\s+stock|khatam\s+hone)\b/.test(t) && /\b(dikhao|batao|kholo|list|show)\b/.test(t)) {
    return { tab: "maal", filter: "low" };
  }
  if (/^(?:stock|maal|inventory)\s+(?:dikhao|kholo|list|show)\b|\b(?:dikhao|kholo)\s+(?:stock|maal)\b/.test(t)) {
    return { tab: "maal" };
  }
  if (/^(?:overdue|baqi)\s+(?:dikhao|list)\b/.test(t)) {
    return { tab: "khata", filter: "overdue" };
  }
  if (/^(?:khata|udhaar)\s+(?:dikhao|kholo|list|show)\b/.test(t)) {
    return { tab: "khata" };
  }
  if (/^(?:parchi)\s+(?:dikhao|scan|kholo)\b|\bscan\s+parchi\b/.test(t)) {
    return { tab: "maal", sheet: "parchi" };
  }
  if (/^(?:munafa|profit|p&l|insights|report)\s*(?:dikhao|kholo|batao)?$/.test(t)) {
    return { tab: "munshi", sheet: "insights" };
  }
  return null;
}

/**
 * Resolve mid-sentence Urdu/Roman-Urdu self-corrections before chunking:
 * e.g. "2 kilo cheeni nahi balke 1 kilo cheeni", "atta nahi chawal 2 kilo",
 *      "Ali nahi Tariq ko 500 udhaar", "2 kilo cheeni, nahi 1 kilo cheeni".
 */
export function applySelfCorrections(raw: string): string {
  // Explicit "X nahi balke Y" or "X woh nahi Y" on customer / whole prefix
  let s = raw.replace(
    /\b([a-z0-9.\s]+?)\s+(?:nahi|nahin|galat|sorry)\s*,?\s*(?:balke|balkay|balki|matlab|woh\s+nahi|wo\s+nahi)\s+/gi,
    " ",
  );
  // Comma/clause boundary followed by "nahi <replacement>" drops the immediately prior clause
  const clauses = s.split(/\s*,\s*/);
  const kept: string[] = [];
  for (const c of clauses) {
    const m = c.match(/^(?:nahi|nahin|sorry|galat|woh\s+nahi|wo\s+nahi)\s+(.+)$/i);
    if (m && kept.length > 0) {
      kept.pop();
      kept.push(m[1].trim());
    } else {
      kept.push(c);
    }
  }
  s = kept.join(", ");
  // Inline "<word> nahi <replacement>" within a short phrase (e.g. "atta nahi chawal 2 kilo")
  s = s.replace(/\b(\S+(?:\s+\S+)?)\s+(?:nahi|nahin)\s+(?:balke|balkay|balki\s+)?(?=[a-z0-9])/gi, "");
  return s.replace(/\s+/g, " ").trim();
}

/** Classify common counter utterances without a model call. */
export function detectIntent(text: string): Intent {
  const t = transliterate(normalizeUrduNumberWords(text)).toLowerCase();
  if (PULSE_REGEX.test(text) || PULSE_REGEX.test(t)) return "pulse";
  if (REVERSAL_REGEX.test(t)) return "reversal";
  if (PURCHASE_REGEX.test(t)) return "purchase";
  if (PAYMENT_REGEX.test(t)) return "payment";
  // Check trailing ? on original text before normalization strips it,
  // then also check the normalized form for leading question words.
  const trimmedOrig = text.trim();
  if (trimmedOrig.endsWith("?") || trimmedOrig.endsWith("؟")) return "question";
  if (QUESTION_REGEX.test(t.trim())) return "question";
  return "sale";
}

/** Extract a leading customer mention such as `Chhote Ali ko` or `Bilal ne`. */
function extractCustomer(text: string): { text: string; mention: string | null } {
  const match = text.match(/^(?:(?:ye|yeh|is|isko)\s+)?([a-z][a-z.']*(?:\s+[a-z][a-z.']*){0,2}?)\s+(ko|ne|ke\s+khate|ka\s+khata|ki\s+taraf\s+se)\b/i);
  if (match && match.index === 0 && !isQuantityToken(match[1].split(" ")[0])) {
    return { text: text.slice(match[0].length).trim(), mention: match[1].trim() };
  }
  const second = text.match(/\b([a-z]+(?:\s+[a-z]+)?)\s+(?:ke|ka|ki)\s+khate\b/i);
  if (second && second.index !== undefined) {
    return { text: (text.slice(0, second.index) + text.slice(second.index + second[0].length)).trim(), mention: second[1].trim() };
  }
  return { text, mention: null };
}

function parseItemChunk(chunk: string): ParsedItem | null {
  const cleaned = chunk.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const isLoose = LOOSE_WORD.test(cleaned);

  // Value-first amounts are evidence phrases; currency conversion stays deterministic.
  const valueFirst = cleaned.match(new RegExp(`^${NUMBER_EXPR}${RS}\\s*(?:ka|ki|ke|wala|wali|walay)\\s+(.+)$`, "i"));
  if (valueFirst) {
    const amount = amountNumber(valueFirst[1]);
    return {
      spoken: valueFirst[2].trim(),
      quantity_phrase: null,
      value_rupees: amount,
      value_phrase: valueFirst[1],
      number_unresolved: amount === null,
      is_loose: isLoose,
      confidence: amount === null ? 0.5 : FALLBACK_CONFIDENCE,
    };
  }

  const tokens = cleaned.split(" ");
  let firstItem = 0;
  while (firstItem < tokens.length && isQuantityToken(tokens[firstItem])) firstItem++;
  if (firstItem > 0 && firstItem < tokens.length) {
    const phrase = tokens.slice(0, firstItem).join(" ");
    const quantity = parseQuantityPhrase(phrase);
    return {
      spoken: tokens.slice(firstItem).join(" "),
      quantity_phrase: phrase,
      value_rupees: null,
      is_loose: isLoose,
      confidence: quantity.unresolved ? 0.5 : FALLBACK_CONFIDENCE,
    };
  }

  let lastItem = tokens.length;
  while (lastItem > 0 && isQuantityToken(tokens[lastItem - 1])) lastItem--;
  if (lastItem < tokens.length && lastItem > 0) {
    const phrase = tokens.slice(lastItem).join(" ");
    const quantity = parseQuantityPhrase(phrase);
    return {
      spoken: tokens.slice(0, lastItem).join(" "),
      quantity_phrase: phrase,
      value_rupees: null,
      is_loose: isLoose,
      confidence: quantity.unresolved ? 0.5 : FALLBACK_CONFIDENCE,
    };
  }
  if (firstItem === tokens.length) return null;
  return { spoken: cleaned, quantity_phrase: null, value_rupees: null, is_loose: isLoose, confidence: FALLBACK_CONFIDENCE };
}

/** Parse supported typed/Roman Urdu speech locally. Output always requires review. */
export function parseFallback(input: string): ParsedTurn {
  const transcript = input.trim();
  const intent = detectIntent(transcript);
  const corrected = intent === "sale" || intent === "payment" ? applySelfCorrections(transcript) : transcript;
  let text = transliterate(normalizeUrduNumberWords(corrected))
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/rs\.?\s*(\d)/g, "$1")
    .replace(/[.!?؟]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const base: ParsedTurn = {
    intent,
    transcript,
    customer_mention: null,
    items: [],
    discount_rupees: null,
    cash_paid_rupees: null,
    payment_mode: "unspecified",
    payment_amount_rupees: null,
    number_unresolved: false,
    question: null,
    confidence: FALLBACK_CONFIDENCE,
  };

  if (intent === "pulse" || intent === "reversal" || intent === "purchase") return base;
  if (intent === "question") return { ...base, question: transcript };

  const customer = extractCustomer(text);
  text = customer.text;
  base.customer_mention = customer.mention;

  if (intent === "payment") {
    const amount = parseRupeeAmount(text);
    return { ...base, payment_amount_rupees: amount?.rupees ?? null, payment_amount_phrase: text, number_unresolved: amount === null };
  }

  // Extract a discount before cash so `30 rupay chhor do` is not mistaken for payment.
  for (const pattern of DISCOUNT_PATTERNS) {
    const result = cut(text, pattern);
    if (result.match) {
      base.discount_rupees = amountNumber(result.match[1]);
      base.discount_phrase = result.match[0].trim();
      base.number_unresolved ||= base.discount_rupees === null;
      text = result.text;
      break;
    }
  }
  const udhaar = UDHAAR_REGEX.test(text);
  const cashWord = CASH_WORD.test(text);
  for (const pattern of CASH_PAID_PATTERNS) {
    if (pattern === CASH_PAID_PATTERNS[2] && !cashWord && !udhaar) continue;
    const result = cut(text, pattern);
    if (result.match) {
      base.cash_paid_rupees = amountNumber(result.match[1]);
      base.cash_phrase = result.match[0].trim();
      base.number_unresolved ||= base.cash_paid_rupees === null;
      text = result.text;
      break;
    }
  }

  let mode: PaymentMode = "unspecified";
  if (udhaar && base.cash_paid_rupees !== null) mode = "split";
  else if (udhaar) mode = "udhaar";
  else if (cashWord || base.cash_paid_rupees !== null) mode = "cash";
  base.payment_mode = mode;

  text = text.replace(new RegExp(UDHAAR_REGEX.source, "gi"), " ").replace(/\s+/g, " ").trim();
  const chunks = text.split(/,|\baur\b|\band\b|\bor\b|\+|\bnaal\b|\bte\b/i);
  for (const chunk of chunks) {
    const item = parseItemChunk(chunk);
    if (item) base.items.push(item);
  }
  return base;
}
