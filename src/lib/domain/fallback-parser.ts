/**
 * Rule-based Roman-Urdu parser. Used when the model is unavailable (timeout/429),
 * for offline typed input, and by the eval harness. Output is never trusted for
 * auto-commit: confidence is capped below the Tier-1 threshold so every proposal
 * from here goes to the Tier-2 review card.
 */

import { isQuantityToken } from "./desi-units";
import { transliterate } from "./pakphone";
import type { Intent, ParsedItem, ParsedTurn, PaymentMode } from "./types";

export const FALLBACK_CONFIDENCE = 0.8;

export const PULSE_REGEX = /\b(subah?|subha|subuh)\s+(ka|ki)\s+(hisaa?b|hisab)\b|\baaj\s+ka\s+(haal|hisaa?b)\b|\bpulse\b|\bhisaa?b\s+batao\b|صبح کا حساب/i;

const REVERSAL_REGEX = /\b(wapas|wapis|waapas)\s+(kar|kr)|\bcancel\b|\bundo\b|\bgalat\s+entry\b|\bpichli\s+entry\b|\bentry\s+(hata|mita|delete)/i;
const PAYMENT_REGEX = /\b(jama|jamaa|jmaa)\b|\bwasooli\b|\bwasool\b|\bpayment\b|\bada\s+(kiye|kiya|kar)/i;
const PURCHASE_REGEX = /\bmaal\s+aaya\b|\bkhareed(a|e)\b|\bpurchase\b|\brestock\b/i;
const QUESTION_REGEX = /\?\s*$|^(kitna|kitne|kitni|kya|kaun|kab|kahan|how|what|which|who|when|batao\s+ke)\b/i;
const UDHAAR_REGEX = /\bkhate\s+(mein|mai|me|main)\b|\bkhaate\b|\bkhata\b|\budhaa?r\b|\blikh\s+(do|lo|dein|den)\b|\bbaqi\b|\bbaaqi\b|\bbaki\b|\bbaaki\b|\bcredit\b/i;
const CASH_WORD = /\bcash\b|\bnaqd\b|\bnakad\b/i;
const LOOSE_WORD = /\b(khula|khuli|khule|loose)\b/i;

const NUM = "(\\d+(?:\\.\\d+)?)";
const RS = "(?:\\s*(?:rupay|rupaye|rupees?|rs\\.?|pkr|rupiya))?";

const CASH_PAID_PATTERNS = [
  new RegExp(`${NUM}${RS}\\s*(?:cash|naqd)\\s*(?:diya|diye|de\\s+diye|mile|mila|liya|liye|paid)?`, "i"),
  new RegExp(`(?:cash|naqd)\\s*${NUM}${RS}\\s*(?:diya|diye|mile|mila)?`, "i"),
  new RegExp(`${NUM}${RS}\\s*(?:diya|diye|de\\s+diye|de\\s+gaya|de\\s+gayi)\\b`, "i"),
];

const DISCOUNT_PATTERNS = [
  new RegExp(`${NUM}${RS}\\s*(?:chhor|chor|chhod|chod|chhorr|kam|discount|kaat)\\s*(?:do|diye|dain|den|dein|kar\\s+do|kiye|diya)?`, "i"),
  new RegExp(`(?:discount|riayat)\\s*${NUM}${RS}`, "i"),
];

const FILLER = /\b(cash|naqd|de\s+do|dedo|dena|chahiye|chahye|please|bhai|jee|ji|aur\s+haan|dijiye|do\s+na|likh\s+do|khate\s+(mein|mai|me|main)|udhaa?r|baqi|baaqi|baki|baaki|mein|ko|kar\s+do|diya|diye|lelo|le\s+lo)\b/gi;

function num(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cut(text: string, re: RegExp): { text: string; match: RegExpMatchArray | null } {
  const m = text.match(re);
  if (!m || m.index === undefined) return { text, match: null };
  return { text: (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim(), match: m };
}

export function detectIntent(text: string): Intent {
  const t = transliterate(text).toLowerCase();
  if (PULSE_REGEX.test(text) || PULSE_REGEX.test(t)) return "pulse";
  if (REVERSAL_REGEX.test(t)) return "reversal";
  if (PURCHASE_REGEX.test(t)) return "purchase";
  if (PAYMENT_REGEX.test(t)) return "payment";
  if (QUESTION_REGEX.test(t.trim())) return "question";
  return "sale";
}

/** "Chhote Ali ko …", "Bilal ne …", "Tariq ke khate mein …" */
function extractCustomer(text: string): { text: string; mention: string | null } {
  const m = text.match(/^(?:(?:ye|yeh|is|isko)\s+)?([a-z][a-z.']*(?:\s+[a-z][a-z.']*){0,2}?)\s+(ko|ne|ke\s+khate|ka\s+khata|ki\s+taraf\s+se)\b/i);
  if (m && m.index === 0 && !isQuantityToken(m[1].split(" ")[0])) {
    return { text: text.slice(m[0].length).trim(), mention: m[1].trim() };
  }
  const m2 = text.match(/\b([a-z]+(?:\s+[a-z]+)?)\s+(?:ke|ka|ki)\s+khate\b/i);
  if (m2 && m2.index !== undefined) {
    return { text: (text.slice(0, m2.index) + text.slice(m2.index + m2[0].length)).trim(), mention: m2[1].trim() };
  }
  return { text, mention: null };
}

function parseItemChunk(chunk: string): ParsedItem | null {
  let c = chunk.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  if (!c) return null;
  const isLoose = LOOSE_WORD.test(c);

  // value-first: "250 ka khula oil", "100 rupay ki cheeni"
  const vf = c.match(new RegExp(`^${NUM}${RS}\\s*(?:ka|ki|ke|wala|wali|walay)\\s+(.+)$`, "i"));
  if (vf) {
    return { spoken: vf[2].trim(), quantity_phrase: null, value_rupees: num(vf[1]), is_loose: isLoose, confidence: FALLBACK_CONFIDENCE };
  }

  const toks = c.split(" ");
  // leading quantity tokens
  let i = 0;
  while (i < toks.length && isQuantityToken(toks[i])) i++;
  if (i > 0 && i < toks.length) {
    return { spoken: toks.slice(i).join(" "), quantity_phrase: toks.slice(0, i).join(" "), value_rupees: null, is_loose: isLoose, confidence: FALLBACK_CONFIDENCE };
  }
  // trailing quantity tokens: "khand 1kg", "anday ek darjan"
  let j = toks.length;
  while (j > 0 && isQuantityToken(toks[j - 1])) j--;
  if (j < toks.length && j > 0) {
    return { spoken: toks.slice(0, j).join(" "), quantity_phrase: toks.slice(j).join(" "), value_rupees: null, is_loose: isLoose, confidence: FALLBACK_CONFIDENCE };
  }
  if (i === toks.length) return null; // only numbers — not an item
  return { spoken: c, quantity_phrase: null, value_rupees: null, is_loose: isLoose, confidence: FALLBACK_CONFIDENCE };
}

export function parseFallback(input: string): ParsedTurn {
  const transcript = input.trim();
  const intent = detectIntent(transcript);
  let text = transliterate(transcript)
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/rs\.?\s*(\d)/g, "$1")
    .replace(/(\d),(\d{3})/g, "$1$2")
    .replace(/[.!?؟،]/g, " ")
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
    question: null,
    confidence: FALLBACK_CONFIDENCE,
  };

  if (intent === "pulse" || intent === "reversal" || intent === "purchase") return base;
  if (intent === "question") return { ...base, question: transcript };

  const cust = extractCustomer(text);
  text = cust.text;
  base.customer_mention = cust.mention;

  if (intent === "payment") {
    const m = text.match(new RegExp(NUM));
    return { ...base, payment_amount_rupees: num(m?.[1]) };
  }

  // discount first (so "30 rupay chhor do" isn't read as cash)
  for (const re of DISCOUNT_PATTERNS) {
    const r = cut(text, re);
    if (r.match) {
      base.discount_rupees = num(r.match[1]);
      text = r.text;
      break;
    }
  }
  const udhaar = UDHAAR_REGEX.test(text);
  const cashWord = CASH_WORD.test(text);
  for (const re of CASH_PAID_PATTERNS) {
    // the bare "N diye" pattern only counts when the sentence is about cash or udhaar
    if (re === CASH_PAID_PATTERNS[2] && !cashWord && !udhaar) continue;
    const r = cut(text, re);
    if (r.match) {
      base.cash_paid_rupees = num(r.match[1]);
      text = r.text;
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
  for (const ch of chunks) {
    const item = parseItemChunk(ch);
    if (item) base.items.push(item);
  }
  return base;
}
