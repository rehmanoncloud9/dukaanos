/** Server-side environment. Never import this from a client component. */

function opt(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  supabaseUrl: () => opt("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => opt("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => opt("SUPABASE_SERVICE_ROLE_KEY"),
  geminiKey: () => opt("GEMINI_API_KEY"),
  // Pinned late-2026 models (Dec 1 cutover-safe). Swappable without code changes.
  fastModel: () => opt("AI_FAST_MODEL", "gemini-3.5-flash-lite"),
  agentModel: () => opt("AI_AGENT_MODEL", "gemini-3.8-flash"),
  fallbackModel: () => opt("AI_FALLBACK_MODEL"),
  ttsModel: () => opt("AI_TTS_MODEL", "gemini-3.8-flash-lite-tts"),
  aiTimeoutMs: () => Number(opt("AI_TIMEOUT_MS", "6000")),
  ed25519PrivateKey: () => opt("ED25519_PRIVATE_KEY"),
  ed25519PublicKey: () => opt("NEXT_PUBLIC_ED25519_PUBLIC_KEY"),
  demoResetSecret: () => opt("DEMO_RESET_SECRET"),
  stageEmail: () => opt("STAGE_EMAIL", "stage@dukaanos.pk"),
  appUrl: () => opt("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
};

export function missingEnv(): string[] {
  const required: Array<[string, () => string]> = [
    ["NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", env.supabaseAnonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", env.supabaseServiceKey],
    ["GEMINI_API_KEY", env.geminiKey],
    ["ED25519_PRIVATE_KEY", env.ed25519PrivateKey],
    ["NEXT_PUBLIC_ED25519_PUBLIC_KEY", env.ed25519PublicKey],
    ["DEMO_RESET_SECRET", env.demoResetSecret],
  ];
  return required.filter(([, f]) => !f()).map(([n]) => n);
}
