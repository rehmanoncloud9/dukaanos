import { describe, expect, it } from "vitest";
import type { GenerateContentResponse } from "@google/genai";
import { ApiError } from "@/lib/api/http";
import { parseModelJson, tokenUsage } from "@/lib/ai/models";

function response(value: Record<string, unknown>): GenerateContentResponse {
  return value as unknown as GenerateContentResponse;
}

describe("Gemini response accounting and JSON boundary", () => {
  it("reads actual SDK token counts and cached input without guessing missing metadata", () => {
    expect(tokenUsage(response({ usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 5,
      cachedContentTokenCount: 40,
    } }))).toEqual({ input_tokens: 100, output_tokens: 25, cached_input_tokens: 40, available: true });
    expect(tokenUsage(response({}))).toEqual({ input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, available: false });
    expect(tokenUsage(response({ usageMetadata: { promptTokenCount: -1, candidatesTokenCount: "12" } })))
      .toEqual({ input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, available: false });
  });

  it("parses structured output as unknown and hides malformed provider text", () => {
    expect(parseModelJson(response({ text: "```json\n{\"ok\":true}\n```" }))).toEqual({ ok: true });
    try {
      parseModelJson(response({ text: "private transcript should not leak" }));
      throw new Error("expected malformed JSON to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toBe("Model returned non-JSON output");
      expect((error as ApiError).message).not.toContain("private transcript");
    }
  });
});
