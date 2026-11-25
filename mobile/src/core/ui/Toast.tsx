import * as Crypto from "expo-crypto";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, radii, spacing } from "@/core/theme/tokens";

export type ToastTone = "ok" | "warn" | "err" | "info";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

interface ToastContextValue {
  toasts: ToastItem[];
  toast: (message: string, tone?: ToastTone, action?: ToastAction) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const insets = useSafeAreaInsets();

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, tone: ToastTone = "info", action?: ToastAction) => {
    const id = Crypto.randomUUID();
    setToasts((cur) => [...cur.slice(-2), { id, message, tone, action }]);
    setTimeout(() => {
      setToasts((cur) => cur.filter((t) => t.id !== id));
    }, action ? 7000 : 3800);
  }, []);

  const value = useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 12 }]}>
        {toasts.map((item) => (
          <View
            key={item.id}
            accessibilityLiveRegion="polite"
            style={[
              styles.toast,
              item.tone === "ok"
                ? styles.ok
                : item.tone === "warn"
                  ? styles.warn
                  : item.tone === "err"
                    ? styles.err
                    : styles.info,
            ]}
          >
            <Text style={styles.msg} numberOfLines={3}>
              {item.message}
            </Text>
            {item.action ? (
              <Pressable
                onPress={() => {
                  dismiss(item.id);
                  item.action?.run();
                }}
                style={styles.actionBtn}
                accessibilityRole="button"
                accessibilityLabel={item.action.label}
              >
                <Text style={styles.actionText}>{item.action.label}</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 100,
    gap: spacing.xs,
  },
  toast: {
    minHeight: 46,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    shadowColor: "#000000",
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 4,
  },
  ok: { backgroundColor: colors.ink },
  info: { backgroundColor: colors.ink },
  warn: { backgroundColor: colors.amberInk },
  err: { backgroundColor: colors.udhaarInk },
  msg: {
    flex: 1,
    fontFamily: fontFamilies.sansMedium,
    fontSize: 13.5,
    color: colors.surface,
  },
  actionBtn: {
    minHeight: 36,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.16)",
    justifyContent: "center",
  },
  actionText: {
    fontFamily: fontFamilies.sansBold,
    fontSize: 13,
    color: colors.cashBright,
  },
});
