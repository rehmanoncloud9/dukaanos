import { createHash } from "node:crypto";

function shortHash(value?: string | null): string | undefined {
  if (!value) return undefined;
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

export interface LogFields {
  requestId: string;
  route: string;
  method?: string;
  userId?: string | null;
  shopId?: string | null;
  code?: string;
  status?: number;
  ms?: number;
  extra?: Record<string, string | number | boolean | null>;
}

/** Structured JSON logger. Never logs transcripts, phone numbers, names, or secrets. */
export function logEvent(fields: LogFields) {
  const entry = {
    ts: new Date().toISOString(),
    req_id: fields.requestId,
    route: fields.route,
    method: fields.method,
    user_hash: shortHash(fields.userId),
    shop_hash: shortHash(fields.shopId),
    code: fields.code,
    status: fields.status,
    ms: fields.ms,
    ...(fields.extra ?? {}),
  };
  console.log(JSON.stringify(entry));
}
