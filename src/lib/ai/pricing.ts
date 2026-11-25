import type { TokenUsage } from "./models";

export interface ModelRates {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion: number | null;
  effectiveFrom: string;
  source: "google-pricing" | "conservative-fallback";
}

export interface CostEstimate {
  costPkrMicros: number;
  rates: ModelRates;
}

const PRICE_CHANGE = Date.UTC(2027, 0, 1);

/** Current Google standard-tier prices for the app's configured models. */
export function modelRates(model: string, at = new Date()): ModelRates {
  const future = at.getTime() >= PRICE_CHANGE;
  if (model.startsWith("gemini-3.5-flash-lite")) {
    return { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 0.03, effectiveFrom: "2026-11-24", source: "google-pricing" };
  }
  if (model.startsWith("gemini-3.8-flash-lite-tts")) {
    return {
      inputUsdPerMillion: future ? 1 : 0.5,
      outputUsdPerMillion: future ? 6 : 3,
      cachedInputUsdPerMillion: null,
      effectiveFrom: future ? "2027-01-01" : "2026-11-24",
      source: "google-pricing",
    };
  }
  if (model.startsWith("gemini-3.8-flash")) {
    return {
      inputUsdPerMillion: future ? 1.5 : 0.75,
      outputUsdPerMillion: future ? 7.5 : 3.75,
      cachedInputUsdPerMillion: future ? 0.15 : 0.075,
      effectiveFrom: future ? "2027-01-01" : "2026-11-24",
      source: "google-pricing",
    };
  }
  // Unknown configured IDs are charged at the highest known text/audio token
  // rate for these routes. This remains an estimate and must be reviewed.
  return {
    inputUsdPerMillion: future ? 1.5 : 1,
    outputUsdPerMillion: future ? 7.5 : 6,
    cachedInputUsdPerMillion: null,
    effectiveFrom: future ? "2027-01-01" : "2026-11-24",
    source: "conservative-fallback",
  };
}

/** Estimate PKR micros (1 PKR = 1,000,000 micros) from SDK-reported tokens. */
export function estimateCostPkrMicros(
  model: string,
  usage: Pick<TokenUsage, "input_tokens" | "output_tokens" | "cached_input_tokens">,
  usdToPkr: number,
  at = new Date(),
): CostEstimate {
  if (!Number.isFinite(usdToPkr) || usdToPkr <= 0) throw new RangeError("USD/PKR rate must be positive");
  const values = [usage.input_tokens, usage.output_tokens, usage.cached_input_tokens];
  if (!values.every((value) => Number.isSafeInteger(value) && value >= 0)) throw new RangeError("Token counts must be non-negative safe integers");
  const rates = modelRates(model, at);
  const cached = Math.min(usage.cached_input_tokens, usage.input_tokens);
  const standard = usage.input_tokens - cached;
  const cachedPrice = rates.cachedInputUsdPerMillion ?? rates.inputUsdPerMillion;
  const micros = usdToPkr * (
    standard * rates.inputUsdPerMillion
    + cached * cachedPrice
    + usage.output_tokens * rates.outputUsdPerMillion
  );
  if (!Number.isSafeInteger(Math.round(micros))) throw new RangeError("Estimated cost exceeds safe integer range");
  return { costPkrMicros: Math.round(micros), rates };
}
