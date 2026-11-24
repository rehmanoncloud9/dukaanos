import { createHash } from "node:crypto";
import { ApiError, bearer, shopIdFrom } from "@/lib/api/http";
import { adminClient, userClient } from "@/lib/supabase/server";

export interface AuthenticatedUser {
  userId: string;
  token: string;
  iat?: number;
}

interface CacheEntry {
  userId: string;
  iat?: number;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const MAX_CACHE_SIZE = 500;
const tokenCache = new Map<string, CacheEntry>();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseJwtClaims(token: string): { exp?: number; iat?: number } {
  const parts = token.split(".");
  if (parts.length !== 3) return {};
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(json) as { exp?: unknown; iat?: unknown };
    return {
      exp: typeof parsed.exp === "number" ? parsed.exp : undefined,
      iat: typeof parsed.iat === "number" ? parsed.iat : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Validates the Bearer JWT against Supabase Auth (with a <= 60s in-memory cache).
 * Rejects forged, malformed, or expired tokens with 401 AUTH_REQUIRED.
 */
export async function requireUser(req: Request): Promise<AuthenticatedUser> {
  const token = bearer(req);
  const claims = parseJwtClaims(token);
  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp !== undefined && claims.exp <= nowSec) {
    throw new ApiError("AUTH_REQUIRED", "Session expired — sign in again");
  }

  const key = hashToken(token);
  const now = Date.now();
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { userId: cached.userId, token, iat: cached.iat };
  }

  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    tokenCache.delete(key);
    throw new ApiError("AUTH_REQUIRED", "Invalid or expired session");
  }

  if (tokenCache.size >= MAX_CACHE_SIZE) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }
  const jwtExpMs = claims.exp ? claims.exp * 1000 : now + CACHE_TTL_MS;
  tokenCache.set(key, {
    userId: data.user.id,
    iat: claims.iat,
    expiresAt: Math.min(now + CACHE_TTL_MS, jwtExpMs),
  });

  return { userId: data.user.id, token, iat: claims.iat };
}

/** Authenticated + shop-scoped context for API route handlers. */
export async function requireShopContext(req: Request) {
  const user = await requireUser(req);
  const shopId = shopIdFrom(req);
  const sb = userClient(user.token);
  return { ...user, shopId, sb };
}

export function clearAuthCacheForTests() {
  tokenCache.clear();
}
