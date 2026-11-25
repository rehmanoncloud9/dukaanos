import type { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { apiClient, registerApiAuthHandlers, setApiShopId } from "@/core/api/client";
import { clearQueueAndCacheStorage, setKv } from "@/core/offline/db";
import { mobileQueryClient } from "@/core/state/queryClient";
import { mobileSupabase, supabaseConfigured } from "./supabase";

const MagicLinkParamsSchema = z.object({
  access_token: z.string().min(10).optional(),
  refresh_token: z.string().min(5).optional(),
  code: z.string().min(4).optional(),
  error_description: z.string().optional(),
});

export interface SessionContextValue {
  configured: boolean;
  ready: boolean;
  session: Session | null;
  user: User | null;
  signInSandbox: (turnstileToken?: string) => Promise<void>;
  signInPassword: (email: string, pin: string) => Promise<void>;
  signInMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function extractUrlParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const [withoutHash, hash] = url.split("#");
  const query = withoutHash.split("?")[1];
  for (const part of [query, hash]) {
    if (!part) continue;
    for (const pair of part.split("&")) {
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const k = decodeURIComponent(pair.slice(0, eq));
      const v = decodeURIComponent(pair.slice(eq + 1));
      out[k] = v;
    }
  }
  return out;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const configured = supabaseConfigured();
  const [ready, setReady] = useState(!configured);
  const [session, setSession] = useState<Session | null>(null);

  const handleAuthDeepLink = useCallback(
    async (url: string | null) => {
      if (!url || !configured) return;
      const raw = extractUrlParams(url);
      const parsed = MagicLinkParamsSchema.safeParse(raw);
      if (!parsed.success) return;
      const { access_token, refresh_token, code } = parsed.data;
      const sb = mobileSupabase();
      if (access_token && refresh_token) {
        await sb.auth.setSession({ access_token, refresh_token });
      } else if (code) {
        await sb.auth.exchangeCodeForSession(code);
      }
    },
    [configured],
  );

  useEffect(() => {
    if (!configured) {
      return;
    }
    const sb = mobileSupabase();
    void sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    void Linking.getInitialURL().then((url) => void handleAuthDeepLink(url));
    const subLink = Linking.addEventListener("url", (event) => {
      void handleAuthDeepLink(event.url);
    });
    return () => {
      sub.subscription.unsubscribe();
      subLink.remove();
    };
  }, [configured, handleAuthDeepLink]);

  useEffect(() => {
    registerApiAuthHandlers({
      onAuthExpired: () => {
        setSession(null);
      },
    });
    return () => registerApiAuthHandlers({});
  }, []);

  const signInSandbox = useCallback(async (turnstileToken?: string) => {
    const creds = await apiClient.demoSandbox(turnstileToken);
    setKv("dukaanos.shop", creds.shop_id);
    const { error } = await mobileSupabase().auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    });
    if (error) throw new Error(error.message);
  }, []);

  const signInPassword = useCallback(async (email: string, pin: string) => {
    const { error } = await mobileSupabase().auth.signInWithPassword({
      email: email.trim(),
      password: pin,
    });
    if (error) throw new Error(error.message);
  }, []);

  const signInMagicLink = useCallback(async (email: string) => {
    const redirectTo = Linking.createURL("/");
    const { error } = await mobileSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    if (configured) {
      await mobileSupabase().auth.signOut().catch(() => undefined);
    }
    setApiShopId(null);
    clearQueueAndCacheStorage();
    mobileQueryClient.clear();
    setSession(null);
  }, [configured]);

  const value = useMemo<SessionContextValue>(
    () => ({
      configured,
      ready,
      session,
      user: session?.user ?? null,
      signInSandbox,
      signInPassword,
      signInMagicLink,
      signOut,
    }),
    [configured, ready, session, signInSandbox, signInPassword, signInMagicLink, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
