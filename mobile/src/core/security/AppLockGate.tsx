import * as LocalAuthentication from "expo-local-authentication";
import { Lock } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { useT } from "@/core/i18n/I18nProvider";
import { getKv, setKv } from "@/core/offline/db";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, ICON_STROKE, radii, spacing } from "@/core/theme/tokens";
import { PrimaryButton } from "@/core/ui/Buttons";

const LOCK_KV_KEY = "dukaanos.app_lock";
const LOCK_GRACE_MS = 2 * 60 * 1000;

interface AppLockContextValue {
  enabled: boolean;
  setEnabled: (next: boolean) => Promise<boolean>;
  locked: boolean;
  unlock: () => Promise<boolean>;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [enabled, setEnabledState] = useState<boolean>(() => getKv(LOCK_KV_KEY) === "1");
  const [locked, setLocked] = useState(false);
  const backgroundAtRef = useRef<number | null>(null);

  const unlock = useCallback(async (): Promise<boolean> => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        setLocked(false);
        return true;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: t("unlockTitle"),
        cancelLabel: t("cancel"),
        disableDeviceFallback: false,
      });
      if (res.success) {
        setLocked(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [t]);

  const setEnabled = useCallback(async (next: boolean): Promise<boolean> => {
    if (next) {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) return false;
      const verified = await LocalAuthentication.authenticateAsync({
        promptMessage: t("unlockTitle"),
        disableDeviceFallback: false,
      });
      if (!verified.success) return false;
    }
    setKv(LOCK_KV_KEY, next ? "1" : "0");
    setEnabledState(next);
    if (!next) setLocked(false);
    return true;
  }, [t]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        if (backgroundAtRef.current === null) backgroundAtRef.current = Date.now();
      } else if (next === "active") {
        const leftAt = backgroundAtRef.current;
        backgroundAtRef.current = null;
        if (enabled && leftAt !== null && Date.now() - leftAt >= LOCK_GRACE_MS) {
          setLocked(true);
        }
      }
    });
    return () => sub.remove();
  }, [enabled]);

  const value = useMemo(() => ({ enabled, setEnabled, locked, unlock }), [enabled, setEnabled, locked, unlock]);

  return (
    <AppLockContext.Provider value={value}>
      {children}
      {locked ? (
        <View style={styles.overlay} accessibilityViewIsModal>
          <View style={styles.card}>
            <View style={styles.iconCircle}>
              <Lock size={24} color={colors.ink} strokeWidth={ICON_STROKE} />
            </View>
            <Text style={styles.title}>{t("unlockTitle")}</Text>
            <Text style={styles.sub}>Sirf Aap Ka Record — Zero FBR Linkage</Text>
            <PrimaryButton onPress={() => void unlock()} style={styles.btn}>
              {t("unlockAction")}
            </PrimaryButton>
          </View>
        </View>
      ) : null}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error("useAppLock must be used inside AppLockProvider");
  return ctx;
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.canvas,
    zIndex: 200,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderCard,
    padding: spacing.xxl,
    alignItems: "center",
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceSunken,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: spacing.lg,
    fontFamily: fontFamilies.sansBold,
    fontSize: 20,
    color: colors.ink,
  },
  sub: {
    marginTop: 6,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink2,
    textAlign: "center",
  },
  btn: {
    marginTop: spacing.xl,
    width: "100%",
  },
});
