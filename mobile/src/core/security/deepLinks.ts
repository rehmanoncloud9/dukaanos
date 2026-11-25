import { z } from "zod";

const SafeFilterSchema = z.enum(["all", "overdue", "settled", "low"]).optional();

export type ParsedDeepLink =
  | { route: "/(tabs)"; params?: undefined }
  | { route: "/(tabs)/khata"; params?: { filter?: "all" | "overdue" | "settled" } }
  | { route: "/(tabs)/maal"; params?: { filter?: "all" | "low" } }
  | { route: "/passport"; params?: { token?: string } }
  | { route: "/xray"; params?: { txId?: string } }
  | { route: "/parchi"; params?: undefined };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{20,256}$/;

export function parseDeepLink(rawUrl: string): ParsedDeepLink | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "dukaanos:" && url.protocol !== "https:") return null;
    const normalizedPath = (url.protocol === "dukaanos:" ? `/${url.hostname}${url.pathname}` : url.pathname)
      .replace(/\/+/g, "/")
      .replace(/\/$/, "") || "/";

    if (normalizedPath === "/verify" || normalizedPath === "/passport") {
      const hashToken = url.hash.replace(/^#/, "").trim();
      if (hashToken && TOKEN_RE.test(hashToken)) {
        return { route: "/passport", params: { token: hashToken } };
      }
      return { route: "/passport" };
    }

    if (normalizedPath === "/khata") {
      const f = SafeFilterSchema.safeParse(url.searchParams.get("filter") ?? undefined);
      if (f.success && (f.data === "all" || f.data === "overdue" || f.data === "settled")) {
        return { route: "/(tabs)/khata", params: { filter: f.data } };
      }
      return { route: "/(tabs)/khata" };
    }

    if (normalizedPath === "/maal") {
      const f = SafeFilterSchema.safeParse(url.searchParams.get("filter") ?? undefined);
      if (f.success && (f.data === "all" || f.data === "low")) {
        return { route: "/(tabs)/maal", params: { filter: f.data } };
      }
      return { route: "/(tabs)/maal" };
    }

    if (normalizedPath === "/xray") {
      const txId = url.searchParams.get("id");
      if (txId && UUID_RE.test(txId)) {
        return { route: "/xray", params: { txId } };
      }
      return { route: "/xray" };
    }

    if (normalizedPath === "/parchi") {
      return { route: "/parchi" };
    }

    return { route: "/(tabs)" };
  } catch {
    return null;
  }
}
