import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, radii, spacing } from "@/core/theme/tokens";

export type PillTone = "neutral" | "cash" | "udhaar" | "maal" | "dark" | "amber" | "outline";

const TONE_STYLES: Record<PillTone, { bg: string; fg: string; border?: string }> = {
  neutral: { bg: colors.surfaceSunken, fg: colors.ink2 },
  cash: { bg: colors.cashBg, fg: colors.cashInk },
  udhaar: { bg: colors.udhaarBg, fg: colors.udhaarInk },
  maal: { bg: colors.maalBg, fg: colors.maal, border: "rgba(15, 118, 110, 0.22)" },
  dark: { bg: colors.ink, fg: colors.surface },
  amber: { bg: colors.amberBg, fg: colors.amberInk },
  outline: { bg: colors.surface, fg: colors.ink, border: colors.borderStrong },
};

export interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  mono?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function Pill({ children, tone = "neutral", mono = false, onPress, accessibilityLabel, style }: PillProps) {
  const palette = TONE_STYLES[tone];
  const content = (
    <View
      style={[
        styles.pill,
        { backgroundColor: palette.bg },
        palette.border ? { borderWidth: 1, borderColor: palette.border } : null,
        style,
      ]}
    >
      {typeof children === "string" || typeof children === "number" ? (
        <Text
          numberOfLines={1}
          style={[
            styles.text,
            { color: palette.fg },
            mono && styles.mono,
          ]}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === "string" ? children : undefined)}
      style={({ pressed }) => [styles.touchWrap, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touchWrap: {
    minHeight: 48,
    justifyContent: "center",
  },
  pill: {
    minHeight: 26,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  text: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 12,
    lineHeight: 16,
  },
  mono: {
    fontFamily: fontFamilies.monoSemi,
    fontSize: 11,
  },
  pressed: {
    opacity: 0.78,
  },
});
