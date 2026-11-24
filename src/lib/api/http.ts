import { NextResponse } from "next/server";
import type { ZodType } from "zod";

/** Canonical DukaanOS error codes → HTTP status. */
export const ERROR_STATUS: Record<string, number> = {
  UDHAAR_REQUIRES_CUSTOMER: 400,
  NO_ITEMS: 400,
  INVALID_QTY: 400,
  INVALID_AMOUNT: 400,
  PRICE_REQUIRED: 400,
  NAME_REQUIRED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  BAD_REQUEST: 400,
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_A_DEMO_SHOP: 403,
  PRODUCT_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  TX_NOT_FOUND: 404,
  ALREADY_REVERSED: 409,
  CANNOT_REVERSE_REVERSAL: 409,
  AUDIO_TOO_LARGE: 413,
  IMAGE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  MATH_MISMATCH: 422,
  RATE_LIMITED: 429,
  CHAIN_BROKEN: 500,
  LEDGER_UNBALANCED: 500,
  IMMUTABLE_LEDGER: 500,
  SERVER_MISCONFIGURED: 500,
  AI_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
};

export class ApiError extends Error {
  constructor(
    public code: string,
    message?: string,
    public details?: unknown,
    public status = ERROR_STATUS[code] ?? 500,
  ) {
    super(message ?? code);
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details ?? null } }, { status: e.status });
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[api] unhandled", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: msg } }, { status: 500 });
}

/** Map a Postgres exception ("UDHAAR_REQUIRES_CUSTOMER", "PRODUCT_NOT_FOUND: …") to an ApiError. */
export function fromDbError(err: { message?: string; hint?: string | null; code?: string | null; details?: string | null }): ApiError {
  const message = err.message ?? "DB_ERROR";
  const code = message.split(":")[0].trim();
  if (ERROR_STATUS[code]) return new ApiError(code, message, err.hint ?? err.details ?? undefined);
  if (err.code === "42501" || /permission denied/i.test(message)) return new ApiError("FORBIDDEN", message);
  if (/JWT|token/i.test(message)) return new ApiError("AUTH_REQUIRED", message);
  return new ApiError("DB_ERROR", message, err.details ?? undefined, 500);
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError("BAD_REQUEST", "Body must be JSON");
  }
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError("BAD_REQUEST", "Invalid request body", r.error.issues);
  return r.data;
}

export function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new ApiError("AUTH_REQUIRED", "Sign in first");
  return m[1];
}

export function shopIdFrom(req: Request): string {
  const id = req.headers.get("x-shop-id") ?? new URL(req.url).searchParams.get("shop_id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError("BAD_REQUEST", "x-shop-id header required");
  return id;
}

/** Wrap a route handler body with uniform error handling. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      // Next.js control-flow signals (prerender bail-out, redirects…) must propagate untouched.
      if (e && typeof e === "object" && "digest" in e && /^(NEXT_|DYNAMIC_SERVER_USAGE|BAILOUT)/.test(String((e as { digest: unknown }).digest))) throw e;
      return errorResponse(e);
    }
  };
}
