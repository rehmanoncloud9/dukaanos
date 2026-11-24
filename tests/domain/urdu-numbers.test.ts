import { describe, expect, it } from "vitest";
import {
  normalizeUrduNumerals,
  parseDesiNumber,
  parseQuantityNumber,
  parseRupeeAmount,
  parseUrduNumberPhrase,
} from "@/lib/domain/urdu-numbers";

describe("deterministic Urdu/Roman Urdu numbers", () => {
  it.each([
    ["ek", 1], ["do", 2], ["teen", 3], ["char", 4], ["paanch", 5],
    ["das", 10], ["bees", 20], ["tees", 30], ["pachas", 50], ["sau", 100], ["hazaar", 1_000],
    ["adha", 0.5], ["sawa", 1.25], ["dedh", 1.5], ["dhai", 2.5], ["paune", 0.75], ["pauna", 0.75],
    ["paune do", 1.75], ["ek sau", 100], ["do sau", 200], ["dhai sau", 250], ["dedh sau", 150],
    ["sawa sau", 125], ["paune do sau", 175], ["sawa do sau", 225], ["teen sau", 300],
    ["paune teen sau", 275], ["ek hazaar", 1_000], ["dedh hazaar", 1_500], ["dhai hazaar", 2_500],
    ["sawa hazaar", 1_250], ["paune do hazaar", 1_750], ["do hazaar", 2_000],
    ["do sau pachaas", 250], ["teen sau bees", 320], ["paanch sau pachaas", 550],
    ["aik hazaar paanch sau", 1_500], ["do hazaar paanch sau", 2_500],
    ["2 sau 50", 250], ["2 hazaar 500", 2_500], ["sau hazaar", 100_000],
    ["ek lakh", 100_000], ["dhai lakh", 250_000], ["ek lakh pachaas hazaar", 150_000],
    ["sawa 2", 2.25], ["paune 2 sau", 175], ["pachattar", 75], ["pachpan", 55],
  ])("parses %s as %s", (phrase, expected) => {
    expect(parseDesiNumber(phrase)?.value).toBe(expected);
  });

  it.each([
    ["ایک", 1], ["دو", 2], ["تین", 3], ["چار", 4], ["پانچ", 5], ["دس", 10],
    ["بیس", 20], ["پچاس", 50], ["سو", 100], ["ہزار", 1_000], ["ایک لاکھ", 100_000], ["آدھا", 0.5],
    ["سوا", 1.25], ["ڈیڑھ", 1.5], ["ڈھائی", 2.5], ["پونے دو", 1.75],
    ["ڈھائی سو", 250], ["سوا سو", 125], ["ڈیڑھ سو", 150], ["دو سو", 200],
    ["پونے دو سو", 175], ["سوا دو سو", 225], ["ڈھائی ہزار", 2_500],
    ["ڈیڑھ ہزار", 1_500], ["سوا ہزار", 1_250], ["پونے دو ہزار", 1_750],
  ])("parses Urdu phrase %s", (phrase, expected) => {
    expect(parseUrduNumberPhrase(phrase)).toBe(expected);
  });

  it("normalizes Urdu and Arabic-Indic digits, including separators", () => {
    expect(normalizeUrduNumerals("۲۵۰")).toBe("250");
    expect(normalizeUrduNumerals("٢٬٥٠٠")).toBe("2,500");
    expect(normalizeUrduNumerals("۱۲٫۵۰")).toBe("12.50");
    expect(parseDesiNumber("۲۵۰")?.value).toBe(250);
    expect(parseDesiNumber("٢٬٥٠٠")?.value).toBe(2_500);
  });

  it("parses decimal and grouped figures exactly in hundredths", () => {
    expect(parseDesiNumber("12.50")?.hundredths).toBe(1_250);
    expect(parseDesiNumber("2,500")?.hundredths).toBe(250_000);
    expect(parseDesiNumber("12,34,567")?.value).toBe(1_234_567);
    expect(parseDesiNumber("1,00,000")?.value).toBe(100_000);
  });

  it("keeps quantity interpretation separate from currency", () => {
    expect(parseQuantityNumber("dhai kilo")).toBe(2.5);
    expect(parseQuantityNumber("dedh pao")).toBe(1.5);
    expect(parseQuantityNumber("500g")).toBe(500);
    expect(parseQuantityNumber("dhai sau rupay")).toBeNull();
    expect(parseQuantityNumber("do teen kilo")).toBeNull();
    expect(parseRupeeAmount("dhai kilo cheeni")).toBeNull();
    expect(parseRupeeAmount("dhai sau rupay")?.paisa).toBe(25_000);
    expect(parseRupeeAmount("dhai sau cash diya")?.paisa).toBe(25_000);
    expect(parseRupeeAmount("dhai sau ka khula oil")?.paisa).toBe(25_000);
    expect(parseRupeeAmount("250/-")?.paisa).toBe(25_000);
    expect(parseRupeeAmount("Rs. 1,500/-")?.paisa).toBe(150_000);
    expect(parseRupeeAmount("30 rupay riayat")?.paisa).toBe(3_000);
    expect(parseRupeeAmount("12.50")?.paisa).toBe(1_250);
    expect(parseRupeeAmount("2,500")?.paisa).toBe(250_000);
  });

  it.each(["", "   ", "unknown", "2 500", "sau sau", "ek do", "do teen", "2 sau 500", "1.234", "99999999999999999"])(
    "returns null instead of guessing for %s",
    (phrase) => expect(parseDesiNumber(phrase)).toBeNull(),
  );

  it("rejects malformed money and out-of-range amounts", () => {
    expect(parseRupeeAmount("12,34")).toBeNull();
    expect(parseRupeeAmount("1.234")).toBeNull();
    expect(parseRupeeAmount("-25")).toBeNull();
    expect(parseRupeeAmount("99999999999999999")).toBeNull();
  });
});
