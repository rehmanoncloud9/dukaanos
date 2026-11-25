import "@/core/crypto-polyfill";

import { QueryClientProvider } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/core/auth/SessionProvider";
import { I18nProvider } from "@/core/i18n/I18nProvider";
import { OfflineProvider } from "@/core/offline/OfflineProvider";
import { AppLockProvider } from "@/core/security/AppLockGate";
import { parseDeepLink } from "@/core/security/deepLinks";
import { AppErrorBoundary } from "@/core/security/ErrorBoundary";
import { mobileQueryClient } from "@/core/state/queryClient";
import { ShopProvider, useShop } from "@/core/state/ShopProvider";
import { useDukaanFonts } from "@/core/theme/fonts";
import { colors } from "@/core/theme/tokens";
import { ToastProvider } from "@/core/ui";
import { VersionProvider } from "@/core/version/VersionProvider";
import { MunshiProvider } from "@/features/munshi/MunshiProvider";

void SplashScreen.preventAutoHideAsync();

function RootNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const router = useRouter();
  const segments = useSegments();
  const incomingUrl = Linking.useURL();
  const { ready, user } = useSession();
  const { shops, shopsLoading, shopId } = useShop();
  const handledUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (fontsLoaded && ready) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, ready]);

  useEffect(() => {
    if (!fontsLoaded || !ready) return;

    const first = segments[0];
    const second = (segments as string[])[1];
    const inAuthGroup = first === "(auth)";

    if (!user) {
      if (first !== "passport" && (!inAuthGroup || second !== "login")) {
        router.replace("/(auth)/login");
      }
      return;
    }

    if (!shopsLoading && shops !== null && shops.length === 0 && !shopId) {
      if (!inAuthGroup || second !== "create-shop") {
        router.replace("/(auth)/create-shop");
      }
      return;
    }

    if (inAuthGroup && (shopId || (shops && shops.length > 0))) {
      router.replace("/(tabs)");
    }
  }, [fontsLoaded, ready, router, segments, shopId, shops, shopsLoading, user]);

  useEffect(() => {
    if (!ready || !incomingUrl) return;
    if (handledUrlRef.current === incomingUrl) return;
    if (incomingUrl.includes("access_token=") || incomingUrl.includes("refresh_token=") || incomingUrl.includes("code=")) {
      return;
    }
    const parsed = parseDeepLink(incomingUrl);
    if (!parsed) return;
    if (parsed.route !== "/passport" && (!user || !shopId)) return;
    handledUrlRef.current = incomingUrl;
    router.push({
      pathname: parsed.route as never,
      params: (parsed.params ?? undefined) as never,
    });
  }, [incomingUrl, ready, router, shopId, user]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="(auth)/login" />
      <Stack.Screen name="(auth)/create-shop" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="review" options={{ presentation: "card" }} />
      <Stack.Screen name="xray" options={{ presentation: "card" }} />
      <Stack.Screen name="settings" options={{ presentation: "card" }} />
      <Stack.Screen name="passport" options={{ presentation: "card" }} />
      <Stack.Screen name="parchi" options={{ presentation: "card" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const { loaded: fontsLoaded } = useDukaanFonts();

  return (
    <AppErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryClientProvider client={mobileQueryClient}>
            <I18nProvider>
              <ToastProvider>
                <OfflineProvider>
                  <VersionProvider>
                    <AppLockProvider>
                      <SessionProvider>
                        <ShopProvider>
                          <MunshiProvider>
                            <StatusBar style="dark" />
                            <RootNavigator fontsLoaded={fontsLoaded} />
                          </MunshiProvider>
                        </ShopProvider>
                      </SessionProvider>
                    </AppLockProvider>
                  </VersionProvider>
                </OfflineProvider>
              </ToastProvider>
            </I18nProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}
