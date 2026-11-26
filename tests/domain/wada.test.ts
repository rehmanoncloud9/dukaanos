import { describe, expect, it } from "vitest";
import { pktToday, quickWadaOptions, resolveWada, wadaLabel } from "@/lib/domain/wada";

// Thu 26 Nov 2026, 15:00 PKT (10:00 UTC)
const NOW = new Date("2026-11-26T10:00:00Z");

describe("wada (promise-to-pay) resolver", () => {
  it("uses Pakistan time for 'today' even late at night UTC", () => {
    expect(pktToday(new Date("2026-11-26T20:30:00Z")).toISOString().slice(0, 10)).toBe("2026-11-27");
  });
  it("resolves relative days", () => {
    expect(resolveWada("aaj shaam tak", NOW)).toBe("2026-11-26");
    expect(resolveWada("Ali kal dega", NOW)).toBe("2026-11-27");
    expect(resolveWada("parson de dunga", NOW)).toBe("2026-11-28");
    expect(resolveWada("5 din mein", NOW)).toBe("2026-12-01");
    expect(resolveWada("teen din baad", NOW)).toBe("2026-11-29");
  });
  it("resolves weekdays to the next occurrence", () => {
    expect(resolveWada("Ali ne Jumme ka wada kiya", NOW)).toBe("2026-11-27");
    expect(resolveWada("itwaar ko", NOW)).toBe("2026-11-29");
    expect(resolveWada("jumeraat", NOW)).toBe("2026-12-03"); // said on a Thursday → next Thursday
    expect(resolveWada("جمعہ کو دوں گا", NOW)).toBe("2026-11-27");
  });
  it("resolves salary day and next week", () => {
    expect(resolveWada("tankhwah pe dunga", NOW)).toBe("2026-12-01");
    expect(resolveWada("1 tareekh ko", NOW)).toBe("2026-12-01");
    expect(resolveWada("agle hafte", NOW)).toBe("2026-12-03");
  });
  it("returns null when no date is spoken", () => {
    expect(resolveWada("do kilo cheeni udhaar", NOW)).toBeNull();
  });
  it("labels and quick options", () => {
    expect(wadaLabel("2026-11-27")).toBe("Jumma, 27 Nov");
    expect(quickWadaOptions(NOW).map((o) => o.date)).toEqual(["2026-11-27", "2026-11-27", "2026-12-03", "2026-12-01"]);
  });
});

describe("wada utterance detection", () => {
  it("needs a promise word and a date", async () => {
    const { detectWadaUtterance } = await import("@/lib/domain/wada");
    expect(detectWadaUtterance("Ali ne Jumme ka wada kiya", NOW)).toBe("2026-11-27");
    expect(detectWadaUtterance("Bilal kal dega", NOW)).toBe("2026-11-27");
    expect(detectWadaUtterance("Tariq tankhwah pe paise dega", NOW)).toBe("2026-12-01");
    expect(detectWadaUtterance("Ali ko kal wali cheeni do kilo", NOW)).toBeNull();
    expect(detectWadaUtterance("Bilal ne 500 jama karaye", NOW)).toBeNull();
  });
});
