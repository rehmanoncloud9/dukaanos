const SENSITIVE_KEY_RE = /^(transcript|transcript_roman|phone|name|customer|customer_name|token|access_token|refresh_token|password|secret|authorization|cookie|email)$/i;
const PHONE_RE = /(?:\+?92|0)?3\d{2}[-\s]?\d{7}/g;

export function redactValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY_RE.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value.replace(PHONE_RE, "[PHONE]").slice(0, 160);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValue(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, k);
    }
    return out;
  }
  return value;
}

export function secureLog(event: string, meta?: Record<string, unknown>): void {
  if (typeof __DEV__ !== "undefined" && !__DEV__) return;
  if (meta) {
    console.info(`[dukaanos] ${event}`, redactValue(meta));
  } else {
    console.info(`[dukaanos] ${event}`);
  }
}
