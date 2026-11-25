jest.mock("@/core/offline/db", () => ({
  getKv: jest.fn(() => null),
  setKv: jest.fn(),
}));

jest.mock("@/core/offline/OfflineProvider", () => ({
  useOffline: jest.fn(() => ({ online: true })),
}));

jest.mock("@/core/api/client", () => ({
  apiClient: { appConfig: jest.fn() },
}));

import { validatePublicConfig } from "@/core/config";
import { DICT, translate, type I18nKey } from "@/core/i18n/dict";
import { parseDeepLink } from "@/core/security/deepLinks";
import { redactValue } from "@/core/security/secureLog";
import { compareSemver } from "@/core/version/VersionProvider";

describe("i18n dictionary, config validation, semver, deep links, and log redaction", () => {
  it("provides non-empty EN and UR copy for every dictionary key", () => {
    const keys = Object.keys(DICT) as I18nKey[];
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(translate(key, "en").trim().length).toBeGreaterThan(0);
      expect(translate(key, "ur").trim().length).toBeGreaterThan(0);
    }
  });

  it("validates public environment configuration strictly", () => {
    const valid = validatePublicConfig({
      EXPO_PUBLIC_API_URL: "https://dukaanos.pk/",
      EXPO_PUBLIC_SUPABASE_URL: "https://xyz.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      EXPO_PUBLIC_ED25519_PUBLIC_KEY: "0".repeat(64),
    });
    expect(valid.configured).toBe(true);
    expect(valid.config?.apiUrl).toBe("https://dukaanos.pk");

    const insecure = validatePublicConfig({
      EXPO_PUBLIC_API_URL: "http://dukaanos.pk",
      EXPO_PUBLIC_SUPABASE_URL: "not-a-url",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "short",
      EXPO_PUBLIC_ED25519_PUBLIC_KEY: "bad-key",
    });
    expect(insecure.configured).toBe(false);
    expect(insecure.errors.length).toBeGreaterThanOrEqual(4);
  });

  it("compares semantic versions accurately", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.2.0", "1.10.0")).toBe(-1);
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
    expect(compareSemver("1.0.1-rc1", "1.0.0")).toBe(1);
  });

  it("parses safe deep links and strips unsafe params", () => {
    expect(parseDeepLink("dukaanos://khata?filter=overdue")).toEqual({
      route: "/(tabs)/khata",
      params: { filter: "overdue" },
    });
    expect(parseDeepLink("dukaanos://khata?filter=DROP_TABLE")).toEqual({
      route: "/(tabs)/khata",
    });
    expect(parseDeepLink("https://dukaanos.pk/verify#payloadToken_12.sigPart_12345678901234567890")).toEqual({
      route: "/passport",
      params: { token: "payloadToken_12.sigPart_12345678901234567890" },
    });
    expect(parseDeepLink("dukaanos://xray?id=00000000-0000-4000-8000-000000000001")).toEqual({
      route: "/xray",
      params: { txId: "00000000-0000-4000-8000-000000000001" },
    });
    expect(parseDeepLink("javascript:alert(1)")).toBeNull();
  });

  it("redacts sensitive PII keys and Pakistani phone numbers in logs", () => {
    const out = redactValue({
      transcript: "Chhote Ali ko dedh pao cheeni",
      phone: "+923001234567",
      token: "secret-jwt",
      notes: "Call 0321-7654321 for wasooli",
      latencyMs: 142,
    }) as Record<string, unknown>;

    expect(out.transcript).toBe("[REDACTED]");
    expect(out.phone).toBe("[REDACTED]");
    expect(out.token).toBe("[REDACTED]");
    expect(out.notes).toBe("Call [PHONE] for wasooli");
    expect(out.latencyMs).toBe(142);
  });
});
