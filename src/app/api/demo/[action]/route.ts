import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiError, handle, ok, parseJson } from "@/lib/api/http";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/server/auth";
import { enforceRateLimit, getClientIp } from "@/lib/server/ratelimit";
import { verifyTurnstile } from "@/lib/server/turnstile";
import { adminClient, rpc, userClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type Ctx = { params: Promise<{ action: string }> };

/** Constant-time compare that returns false (never throws) on length mismatch. */
function safeEqual(given: string | undefined | null, want: string | undefined | null): boolean {
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

function secretOk(given: string | undefined): boolean {
  return safeEqual(given, env.demoResetSecret());
}

/**
 * Judges at the venue share one NAT'd Wi-Fi IP, so the per-IP ceiling is sized for a room,
 * not a person. Turnstile (when configured) is the per-human gate.
 */
const SANDBOX_PER_IP_PER_HOUR = 60;

/** Owner of an isolated sandbox may reset/tamper their own sandbox; the stage shop needs DEMO_RESET_SECRET. */
async function authorize(req: Request, shopId: string, secret?: string) {
  if (secretOk(secret)) return "secret";
  const { token } = await requireUser(req);
  const shops = await rpc<Array<{ id: string; is_demo_shop: boolean; is_stage_shop: boolean }>>(userClient(token), "my_shops", {});
  const s = shops.find((x) => x.id === shopId);
  if (s && s.is_demo_shop && !s.is_stage_shop) return "own-sandbox";
  throw new ApiError("FORBIDDEN", "Stage shop is protected — DEMO_RESET_SECRET required");
}

const SandboxBody = z.object({ turnstile_token: z.string().optional() }).optional();
const ShopBody = z.object({ shop_id: z.string().uuid(), secret: z.string().optional() });

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { action } = await ctx.params;
  const admin = adminClient();

  if (action === "sandbox") {
    // Flow 1(a): 1-tap "Try Live Demo Shop" → fresh isolated judge account + seeded shop.
    const ip = getClientIp(req);
    await enforceRateLimit(`sandbox:${ip}`, SANDBOX_PER_IP_PER_HOUR, "1 hour");
    let turnstileToken: string | undefined;
    try {
      const raw = await req.json();
      const parsed = SandboxBody.safeParse(raw);
      if (parsed.success) turnstileToken = parsed.data?.turnstile_token;
    } catch {
      // empty body allowed when Turnstile is disabled
    }
    await verifyTurnstile(turnstileToken, ip);

    const email = `judge-${randomBytes(5).toString("hex")}@sandbox.dukaanos.pk`;
    const password = randomBytes(18).toString("base64url");
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { kind: "judge_sandbox" } });
    if (created.error || !created.data.user) throw new ApiError("SERVER_MISCONFIGURED", created.error?.message ?? "could not create sandbox user");
    const shopId = await rpc<string>(admin, "create_demo_shop", { p_user_id: created.data.user.id, p_kind: "sandbox" });
    return ok({ email, password, shop_id: shopId });
  }

  if (action === "reset") {
    const b = await parseJson(req, ShopBody);
    await enforceRateLimit(`demo_reset:${b.shop_id}`, 20, "1 hour");
    const via = await authorize(req, b.shop_id, b.secret);
    const t0 = Date.now();
    const res = await rpc(admin, "reset_demo_shop", { p_shop_id: b.shop_id });
    return ok({ ok: true, via, result: res, ms: Date.now() - t0 });
  }

  if (action === "tamper") {
    const b = await parseJson(req, ShopBody);
    await enforceRateLimit(`demo_tamper:${b.shop_id}`, 20, "1 hour");
    const via = await authorize(req, b.shop_id, b.secret);
    const res = await rpc(admin, "demo_tamper", { p_shop_id: b.shop_id });
    return ok({ ok: true, via, result: res });
  }

  if (action === "purge") {
    const expected = env.cronSecret();
    const auth = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!safeEqual(auth, expected)) {
      throw new ApiError("FORBIDDEN", "Valid CRON_SECRET required");
    }
    const res = await rpc(admin, "purge_stale_sandboxes", { p_older_than: "72 hours" });
    return ok({ ok: true, result: res });
  }

  throw new ApiError("BAD_REQUEST", `Unknown demo action "${action}"`, undefined, 404);
});
