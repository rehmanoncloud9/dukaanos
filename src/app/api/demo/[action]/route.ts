import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiError, handle, ok, parseJson } from "@/lib/api/http";
import { env } from "@/lib/env";
import { adminClient, rpc, userClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type Ctx = { params: Promise<{ action: string }> };

// naive per-instance throttle so the public sandbox button can't be scripted into thousands of shops
const hits = new Map<string, number[]>();
function throttle(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new ApiError("RATE_LIMITED", "Too many demo shops from this network — try again in a few minutes");
  arr.push(now);
  hits.set(key, arr);
}

function secretOk(given: string | undefined): boolean {
  const want = env.demoResetSecret();
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Owner of an isolated sandbox may reset/tamper their own sandbox; the stage shop needs DEMO_RESET_SECRET. */
async function authorize(req: Request, shopId: string, secret?: string) {
  if (secretOk(secret)) return "secret";
  const auth = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!auth) throw new ApiError("FORBIDDEN", "DEMO_RESET_SECRET required");
  const shops = await rpc<Array<{ id: string; is_demo_shop: boolean; is_stage_shop: boolean }>>(userClient(auth), "my_shops", {});
  const s = shops.find((x) => x.id === shopId);
  if (s && s.is_demo_shop && !s.is_stage_shop) return "own-sandbox";
  throw new ApiError("FORBIDDEN", "Stage shop is protected — DEMO_RESET_SECRET required");
}

const ShopBody = z.object({ shop_id: z.string().uuid(), secret: z.string().optional() });

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { action } = await ctx.params;
  const admin = adminClient();

  if (action === "sandbox") {
    // Flow 1(a): 1-tap "Try Live Demo Shop" → fresh isolated judge account + seeded shop.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    throttle(ip, 12, 10 * 60_000);
    const email = `judge-${randomBytes(5).toString("hex")}@sandbox.dukaanos.pk`;
    const password = randomBytes(18).toString("base64url");
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { kind: "judge_sandbox" } });
    if (created.error || !created.data.user) throw new ApiError("SERVER_MISCONFIGURED", created.error?.message ?? "could not create sandbox user");
    const shopId = await rpc<string>(admin, "create_demo_shop", { p_user_id: created.data.user.id, p_kind: "sandbox" });
    return ok({ email, password, shop_id: shopId });
  }

  if (action === "reset") {
    const b = await parseJson(req, ShopBody);
    const via = await authorize(req, b.shop_id, b.secret);
    const t0 = Date.now();
    const res = await rpc(admin, "reset_demo_shop", { p_shop_id: b.shop_id });
    return ok({ ok: true, via, result: res, ms: Date.now() - t0 });
  }

  if (action === "tamper") {
    const b = await parseJson(req, ShopBody);
    const via = await authorize(req, b.shop_id, b.secret);
    const res = await rpc(admin, "demo_tamper", { p_shop_id: b.shop_id });
    return ok({ ok: true, via, result: res });
  }

  throw new ApiError("BAD_REQUEST", `Unknown demo action "${action}"`, undefined, 404);
});
