import { z } from "zod";

const ConfigSchema = z.object({
  apiUrl: z
    .string()
    .trim()
    .url("EXPO_PUBLIC_API_URL must be a valid URL")
    .refine(
      (u) => u.startsWith("https://") || u.startsWith("http://localhost") || u.startsWith("http://10.0.2.2"),
      "EXPO_PUBLIC_API_URL must use https:// outside local dev",
    )
    .transform((u) => u.replace(/\/$/, "")),
  supabaseUrl: z.string().trim().url("EXPO_PUBLIC_SUPABASE_URL must be a valid URL"),
  supabaseAnonKey: z.string().trim().min(10, "EXPO_PUBLIC_SUPABASE_ANON_KEY is required"),
  ed25519PublicKey: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/, "EXPO_PUBLIC_ED25519_PUBLIC_KEY must be a 64-char hex string"),
});

export type MobileConfig = z.infer<typeof ConfigSchema>;

export interface ConfigValidationResult {
  configured: boolean;
  config: MobileConfig | null;
  errors: string[];
}

export interface RawPublicEnv {
  EXPO_PUBLIC_API_URL?: string;
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  EXPO_PUBLIC_ED25519_PUBLIC_KEY?: string;
}

export function validatePublicConfig(raw: RawPublicEnv): ConfigValidationResult {
  const parsed = ConfigSchema.safeParse({
    apiUrl: raw.EXPO_PUBLIC_API_URL ?? "",
    supabaseUrl: raw.EXPO_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: raw.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
    ed25519PublicKey: raw.EXPO_PUBLIC_ED25519_PUBLIC_KEY ?? "",
  });
  if (parsed.success) {
    return { configured: true, config: parsed.data, errors: [] };
  }
  return {
    configured: false,
    config: null,
    errors: parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`),
  };
}

// Expo inlines process.env.EXPO_PUBLIC_* only via static property access.
const staticEnv: RawPublicEnv = {
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_ED25519_PUBLIC_KEY: process.env.EXPO_PUBLIC_ED25519_PUBLIC_KEY,
};

export const configStatus = validatePublicConfig(staticEnv);

export function requireMobileConfig(): MobileConfig {
  if (!configStatus.config) {
    throw new Error(`DukaanOS mobile configuration invalid:\n${configStatus.errors.join("\n")}`);
  }
  return configStatus.config;
}
