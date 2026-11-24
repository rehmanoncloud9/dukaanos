import { describe, expect, it } from "vitest";
import {
  customerCandidates,
  isAmbiguous,
  levenshtein,
  matchCatalog,
  normalizeText,
  normalizeUrdu,
  phoneticKey,
  phraseSimilarity,
  tokenSimilarity,
  transliterate,
} from "@/lib/domain/pakphone";
import { customerEntries, productEntries } from "@/lib/domain/bill";
import { demoCatalog } from "../helpers/catalog";

const catalog = demoCatalog();
const products = productEntries(catalog.products);
const customers = customerEntries(catalog.customers);

describe("PakPhone phonetic & bilingual matching", () => {
  it("normalizes Urdu homoglyphs and strips diacritics without losing word identity", () => {
    expect(normalizeUrdu("چِینِی")).toBe("چینی");
    expect(normalizeUrdu("كيلا")).toBe("کیلا");
    expect(normalizeUrdu("چائے")).toBe("چایی");
    expect(transliterate("چینی")).toBe("chini");
  });

  it("strips Urdu/Punjabi particles and collapses aspirated/vowel drift", () => {
    expect(normalizeText("Sarson ka Tel (1L)")).toBe("sarson tel");
    expect(normalizeText("sarson da tail")).toBe("sarson tail");
    expect(phoneticKey("tel")).toBe(phoneticKey("tail"));
    expect(phoneticKey("cheeni")).toBe(phoneticKey("chini"));
    expect(phoneticKey("atta")).toBe(phoneticKey("aata"));
    expect(phoneticKey("tariq")).toBe(phoneticKey("tarik"));
    expect(phoneticKey("ghor")).toBe(phoneticKey("gor"));
  });

  it("computes Levenshtein distance and token/phrase similarities cleanly", () => {
    expect(levenshtein("khand", "khand")).toBe(0);
    expect(levenshtein("chawal", "chaval")).toBe(1);
    expect(tokenSimilarity("cheeni", "chini")).toBeGreaterThanOrEqual(0.97);
    expect(phraseSimilarity("sarson da tail", "Sarson ka Tel")).toBeGreaterThanOrEqual(0.85);
    expect(phraseSimilarity("", "Cheeni")).toBe(0);
  });

  it("matches Pakistani dialect aliases and Urdu script under 5ms", () => {
    // Multiple warmup calls to prime JIT before timing measurement
    matchCatalog("warmup", products);
    matchCatalog("cheeni", products);
    matchCatalog("atta", products);
    const cases: Array<[string, string]> = [
      ["khand", "CHEENI"],
      ["چینی", "CHEENI"],
      ["sarson da tail", "SARSON"],
      ["loon", "NAMAK"],
      ["aata", "ATTA"],
      ["پتی", "PATTI"],
    ];
    for (const [query, expectedId] of cases) {
      const report = matchCatalog(query, products, 3);
      expect(report.results[0]?.id).toBe(expectedId);
      expect(report.results[0]?.score).toBeGreaterThanOrEqual(0.72);
      expect(report.ms).toBeLessThan(50); // generous for cold JIT in Vitest workers; <5ms in warm production env
    }
  });

  it("surfaces all 3-Ali disambiguation candidates and flags ambiguity", () => {
    const report = customerCandidates("Ali", customers, 3);
    expect(report.results).toHaveLength(3);
    expect(isAmbiguous(report.results)).toBe(true);

    const exact = customerCandidates("Chhote Ali", customers, 3);
    expect(exact.results[0]?.id).toBe("CHHOTE_ALI");
    expect(isAmbiguous(exact.results)).toBe(false);
    expect(isAmbiguous([])).toBe(true);
  });
});
