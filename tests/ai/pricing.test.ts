import { describe, expect, it } from "vitest";
import { estimateCostPkrMicros, modelRates } from "@/lib/ai/pricing";

describe("Google model cost estimates", () => {
  it("uses the configured production routes' standard-tier USD prices and PKR conversion", () => {
    expect(estimateCostPkrMicros("gemini-3.5-flash-lite", {
      input_tokens: 1_000_000, output_tokens: 1_000_000, cached_input_tokens: 0,
    }, 280, new Date("2026-11-24T12:00:00Z")).costPkrMicros).toBe(784_000_000);
    expect(estimateCostPkrMicros("gemini-3.8-flash", {
      input_tokens: 1_000_000, output_tokens: 1_000_000, cached_input_tokens: 0,
    }, 280, new Date("2026-11-24T12:00:00Z")).costPkrMicros).toBe(1_260_000_000);
  });

  it("applies SDK cached token counts and excludes any impossible overcount", () => {
    expect(estimateCostPkrMicros("gemini-3.5-flash-lite", {
      input_tokens: 100, output_tokens: 0, cached_input_tokens: 150,
    }, 280, new Date("2026-11-24T12:00:00Z")).costPkrMicros).toBe(840);
  });

  it("tracks published scheduled pricing changes and flags unknown configured IDs", () => {
    expect(modelRates("gemini-3.8-flash", new Date("2027-01-01T00:00:00Z"))).toMatchObject({
      inputUsdPerMillion: 1.5, outputUsdPerMillion: 7.5, source: "google-pricing",
    });
    expect(modelRates("custom-configured-model").source).toBe("conservative-fallback");
  });
});
