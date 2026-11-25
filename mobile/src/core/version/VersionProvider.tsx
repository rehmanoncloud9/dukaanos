import * as Application from "expo-application";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { apiClient } from "@/core/api/client";
import type { AppConfigResponse } from "@/core/api/types";
import { configStatus } from "@/core/config";
import { useT } from "@/core/i18n/I18nProvider";
import { getKv, setKv } from "@/core/offline/db";
import { useOffline } from "@/core/offline/OfflineProvider";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, radii, spacing } from "@/core/theme/tokens";
import { PrimaryButton } from "@/core/ui/Buttons";

const APP_CONFIG_KV = "dukaanos.app_config";

export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n.replace(/[^\d]/g, ""), 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n.replace(/[^\d]/g, ""), 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

const DEFAULT_CONFIG: AppConfigResponse = {
  min_supported_app_version: "1.0.0",
  latest_app_version: "1.0.0",
  features: {
    voice_enabled: true,
    parchi_ocr_enabled: true,
    tts_enabled: true,
    offline_queue_enabled: true,
  },
  turnstile_site_key: null,
  verify_public_key: null,
};

interface VersionContextValue {
  appVersion: string;
  config: AppConfigResponse;
  updateRequired: boolean;
}

const VersionContext = createContext<VersionContextValue | null>(null);

function readCachedConfig(): AppConfigResponse {
  try {
    const raw = getKv(APP_CONFIG_KV);
    if (raw) return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AppConfigResponse>) };
  } catch {
    // Ignore corrupt cache.
  }
  return DEFAULT_CONFIG;
}

export function VersionProvider({ children }: { children: ReactNode }) {
  const { online } = useOffline();
  const { t } = useT();
  const appVersion = Application.nativeApplicationVersion ?? "1.0.0";
  const [config, setConfig] = useState<AppConfigResponse>(readCachedConfig);

  useEffect(() => {
    if (!online || !configStatus.configured) return;
    let active = true;
    void apiClient
      .appConfig()
      .then((res) => {
        if (!active) return;
        setConfig(res);
        setKv(APP_CONFIG_KV, JSON.stringify(res));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [online]);

  const updateRequired = useMemo(
    () => compareSemver(appVersion, config.min_supported_app_version) < 0,
    [appVersion, config.min_supported_app_version],
  );

  const value = useMemo(() => ({ appVersion, config, updateRequired }), [appVersion, config, updateRequired]);

  if (updateRequired) {
    return (
      <View style={styles.gate}>
        <View style={styles.card}>
          <Text style={styles.title}>{t("updateRequiredTitle")}</Text>
          <Text style={styles.body}>{t("updateRequiredBody")}</Text>
          <Text style={styles.meta}>
            Installed {appVersion} · Required {config.min_supported_app_version}
          </Text>
          <PrimaryButton
            onPress={() => void Linking.openURL("https://play.google.com/store/apps/details?id=pk.dukaanos.app")}
            style={styles.btn}
          >
            Update DukaanOS
          </PrimaryButton>
        </View>
      </View>
    );
  }

  return <VersionContext.Provider value={value}>{children}</VersionContext.Provider>;
}

export function useAppConfig() {
  const ctx = useContext(VersionContext);
  if (!ctx) throw new Error("useAppConfig must be used inside VersionProvider");
  return ctx;
}

export function useFeature(name: string): boolean {
  const { config } = useAppConfig();
  return config.features?.[name] !== false;
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    backgroundColor: colors.canvas,
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.xl,
  },
  title: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 22,
    color: colors.ink,
  },
  body: {
    marginTop: spacing.sm,
    fontFamily: fontFamilies.sans,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink2,
  },
  meta: {
    marginTop: spacing.md,
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    color: colors.ink3,
  },
  btn: {
    marginTop: spacing.lg,
  },
});
