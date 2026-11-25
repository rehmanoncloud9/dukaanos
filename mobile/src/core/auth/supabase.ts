import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { configStatus } from "@/core/config";
import { secureStorage } from "./storage";

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return configStatus.configured;
}

export function mobileSupabase(): SupabaseClient {
  if (!configStatus.config) {
    throw new Error("Supabase is not configured — set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.");
  }
  client ??= createClient(configStatus.config.supabaseUrl, configStatus.config.supabaseAnonKey, {
    auth: {
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

export async function getAccessToken(): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  const { data } = await mobileSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
