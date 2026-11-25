import type { ReactNode } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, radii, spacing } from "@/core/theme/tokens";

export function Skeleton({ height = 60, style }: { height?: number; style?: ViewStyle }) {
  return <View style={[styles.skeleton, { height }, style]} />;
}

export function EmptyState({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function relTime(iso: string): string {
  const ms = new Date(iso).getTime();
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return "Just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-PK", { day: "numeric", month: "short" });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short" });
}

const styles = StyleSheet.create({
  skeleton: {
    borderRadius: radii.card,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    borderColor: colors.borderHairline,
  },
  emptyWrap: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  emptyTitle: {
    fontFamily: fontFamilies.sansMedium,
    fontSize: 15,
    color: colors.ink2,
    textAlign: "center",
  },
  emptySub: {
    marginTop: 4,
    fontFamily: fontFamilies.sans,
    fontSize: 13,
    color: colors.ink3,
    textAlign: "center",
  },
  emptyAction: {
    marginTop: spacing.md,
  },
});
