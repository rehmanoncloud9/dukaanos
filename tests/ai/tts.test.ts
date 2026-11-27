import { describe, expect, it } from "vitest";
import { normalizeUrduSpeechText, numberToUrduWords } from "@/lib/ai/tts";

describe("Urdu speech number-to-words normalization", () => {
  it("converts integers into natural Pakistani Urdu words", () => {
    expect(numberToUrduWords(0)).toBe("صفر");
    expect(numberToUrduWords(25)).toBe("پچیس");
    expect(numberToUrduWords(250)).toBe("دو سو پچاس");
    expect(numberToUrduWords(2500)).toBe("دو ہزار پانچ سو");
    expect(numberToUrduWords(150000)).toBe("ایک لاکھ پچاس ہزار");
  });

  it("normalizes mixed rupees, numbers, and Roman terms into pure Urdu script", () => {
    expect(normalizeUrduSpeechText("Rs. 2500 cash")).toBe("روپے دو ہزار پانچ سو نقد");
    expect(normalizeUrduSpeechText("Bilal ka 450 udhaar")).toBe("Bilal ka چار سو پچاس ادھار");
  });
});
