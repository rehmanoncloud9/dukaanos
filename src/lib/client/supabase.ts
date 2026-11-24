"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Browser client: anon key only (safe to ship). The service-role key never leaves the server. */
export function browserSupabase(): SupabaseClient {
  if (!supabaseConfigured()) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "dukaanos-auth", detectSessionInUrl: true },
  });
  return client;
}

export async function accessToken(): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  const { data } = await browserSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
