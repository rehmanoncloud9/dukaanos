import { handle, ok } from "@/lib/api/http";
import { env } from "@/lib/env";

/**
 * GET /api/app-config — public, cached 60s.
 * Used by web & mobile apps for version gating, Turnstile site key, and Ed25519 verify key.
 */
export const GET = handle(async () => {
  return ok(
    {
      min_supported_app_version: env.minSupportedAppVersion(),
      latest_app_version: env.latestAppVersion(),
      features: {
        voice_enabled: true,
        parchi_ocr_enabled: true,
        tts_enabled: true,
        offline_queue_enabled: true,
      },
      turnstile_site_key: env.turnstileSiteKey() || null,
      verify_public_key: env.ed25519PublicKey() || null,
    },
    {
      headers: {
        "cache-control": "public, max-age=60, s-maxage=60",
      },
    },
  );
});
