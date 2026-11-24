import { ApiError } from "@/lib/api/http";
import { env } from "@/lib/env";

/**
 * Verifies a Cloudflare Turnstile token server-side when TURNSTILE_SECRET_KEY is configured.
 * In local dev/CI where Turnstile is not configured, passes through cleanly.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<void> {
  const secret = env.turnstileSecretKey();
  if (!secret) return;

  if (!token || !token.trim()) {
    throw new ApiError("FORBIDDEN", "Bot verification required");
  }

  const body = new URLSearchParams({
    secret,
    response: token.trim(),
    remoteip: ip,
  });

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });

  if (!res.ok) {
    throw new ApiError("AI_UNAVAILABLE", "Verification service unavailable");
  }
  const data = (await res.json()) as { success?: boolean };
  if (!data.success) {
    throw new ApiError("FORBIDDEN", "Bot verification failed");
  }
}
