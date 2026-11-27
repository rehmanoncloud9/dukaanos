import { z } from "zod";
import { listModelIds } from "@/lib/ai/models";
import { synthesizeUrdu } from "@/lib/ai/tts";
import { ApiError, bearer, handle, ok, parseJson } from "@/lib/api/http";
import { STARTER_KIRYANA_SKUS } from "@/lib/domain/starter-catalog";
import { env, missingEnv } from "@/lib/env";
import { requireShopContext } from "@/lib/server/auth";
import { adminClient, rpc, userClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type Ctx = { params: Promise<{ endpoint: string }> };

/**
 * GET /api/system/health — env completeness + Dec 1 cutover audit (are the pinned models live
 *                          for this key? any gemini-2.5 references configured?)
 * GET /api/system/shops  — shops the signed-in user belongs to
 */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { endpoint } = await ctx.params;
  if (endpoint === "health") {
    const pinned = { fast: env.fastModel(), agent: env.agentModel(), tts: env.ttsModel() };
    const hasGeminiKey = Boolean(env.geminiKey());
    let models: Record<string, boolean> | null = null;
    let modelError: string | null = null;
    if (hasGeminiKey) {
      try {
        const ids = new Set(await listModelIds());
        models = Object.fromEntries(Object.entries(pinned).filter(([, v]) => v).map(([k, v]) => [k, ids.has(v as string)]));
      } catch (e) {
        modelError = e instanceof Error ? e.message : String(e);
      }
    }
    const legacy = Object.values(pinned).filter((m) => m && /gemini-2\.5/.test(m));
    const coreModelsOk = !models || (models.fast !== false && models.agent !== false);
    return ok({
      ok: missingEnv().length === 0 && legacy.length === 0 && coreModelsOk,
      ai_billing_mode: env.aiBillingMode(),
      gemini_configured: hasGeminiKey,
      missing_env: missingEnv(),
      pinned_models: pinned,
      models_available: models,
      model_check_error: modelError,
      cutover_audit: { gemini_2_5_references: legacy.length, ok: legacy.length === 0 },
      time: new Date().toISOString(),
    });
  }
  if (endpoint === "shops") {
    return ok(await rpc(userClient(bearer(req)), "my_shops", {}));
  }
  throw new ApiError("BAD_REQUEST", `Unknown endpoint "${endpoint}"`, undefined, 404);
});

const NewShop = z.object({
  name: z.string().trim().min(2).max(80),
  owner_name: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(20).optional(),
  city: z.string().trim().max(60).optional(),
  seed_starter: z.boolean().optional(),
});

/**
 * POST /api/system/tts   — query-only Urdu readout (F-12). Returns audio/wav.
 * POST /api/system/shops — Flow 1(c): a new shopkeeper creates their own shop (owner membership).
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { endpoint } = await ctx.params;
  if (endpoint === "tts") {
    const { sb, shopId } = await requireShopContext(req);
    const memberships = await rpc<Array<{ id: string }>>(sb, "my_shops", {});
    if (!memberships.some((shop) => shop.id === shopId)) throw new ApiError("FORBIDDEN", "Shop membership required");
    const { text } = await parseJson(req, z.object({ text: z.string().trim().min(1).max(400) }));
    const r = await synthesizeUrdu(text, shopId);
    return new Response(new Uint8Array(r.audio), {
      headers: { "content-type": r.mimeType, "x-model": r.model, "x-latency-ms": String(r.latency_ms), "cache-control": "no-store" },
    });
  }
  if (endpoint === "shops") {
    const b = await parseJson(req, NewShop);
    const id = await rpc<string>(userClient(bearer(req)), "create_shop", {
      p_name: b.name, p_owner_name: b.owner_name ?? null, p_phone: b.phone ?? null, p_city: b.city ?? null,
    });
    if (b.seed_starter) {
      await adminClient()
        .from("products")
        .insert(STARTER_KIRYANA_SKUS.map((s) => ({ ...s, shop_id: id, stock_base_units: 0 })));
    }
    return ok({ shop_id: id });
  }
  throw new ApiError("BAD_REQUEST", `Unknown endpoint "${endpoint}"`, undefined, 404);
});
