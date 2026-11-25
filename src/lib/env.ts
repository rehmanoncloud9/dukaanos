/** Server-side environment. Never import this from a client component. */

function opt(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function numOpt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const env = {
  isProd: () => process.env.NODE_ENV === "production",
  supabaseUrl: () => opt("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => opt("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => opt("SUPABASE_SERVICE_ROLE_KEY"),
  aiBillingMode: (): "free" | "billed" => (opt("AI_BILLING_MODE", "free") === "billed" ? "billed" : "free"),
  geminiKey: () => opt("GEMINI_API_KEY"),
  // Approved fast/agent routes. No generic fallback model is used in production.
  fastModel: () => opt("AI_FAST_MODEL", "gemini-3.5-flash-lite"),
  agentModel: () => opt("AI_AGENT_MODEL", "gemini-3.8-flash"),
  ttsModel: () => opt("AI_TTS_MODEL", "gemini-3.8-flash-lite-tts"),
  aiTimeoutMs: () => Number(opt("AI_TIMEOUT_MS", "6000")),
  ed25519PrivateKey: () => opt("ED25519_PRIVATE_KEY"),
  ed25519PublicKey: () => opt("NEXT_PUBLIC_ED25519_PUBLIC_KEY"),
  demoResetSecret: () => opt("DEMO_RESET_SECRET"),
  stageEmail: () => opt("STAGE_EMAIL", "stage@dukaanos.pk"),
  appUrl: () => opt("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
  turnstileSiteKey: () => opt("NEXT_PUBLIC_TURNSTILE_SITE_KEY"),
  turnstileSecretKey: () => opt("TURNSTILE_SECRET_KEY"),
  aiCapVoice: () => numOpt("AI_DAILY_CAP_VOICE", 400),
  aiCapParchi: () => numOpt("AI_DAILY_CAP_PARCHI", 30),
  aiCapQa: () => numOpt("AI_DAILY_CAP_QA", 60),
  aiCapTts: () => numOpt("AI_DAILY_CAP_TTS", 60),
  aiGlobalDailyPkrCap: () => numOpt("AI_GLOBAL_DAILY_PKR_CAP", 5000),
  aiUsdToPkrRate: () => numOpt("AI_USD_TO_PKR_RATE", 280),
  minSupportedAppVersion: () => opt("MIN_SUPPORTED_APP_VERSION", "1.0.0"),
  latestAppVersion: () => opt("LATEST_APP_VERSION", "1.0.0"),
  cronSecret: () => opt("CRON_SECRET"),
};

export function missingEnv(): string[] {
  const required: Array<[string, () => string]> = [
    ["NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", env.supabaseAnonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", env.supabaseServiceKey],
    ["ED25519_PRIVATE_KEY", env.ed25519PrivateKey],
    ["NEXT_PUBLIC_ED25519_PUBLIC_KEY", env.ed25519PublicKey],
    ["DEMO_RESET_SECRET", env.demoResetSecret],
  ];
  return required.filter(([, f]) => !f()).map(([n]) => n);
}
