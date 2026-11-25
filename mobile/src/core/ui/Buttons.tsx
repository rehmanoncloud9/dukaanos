import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, MIN_TARGET_DP, radii, spacing } from "@/core/theme/tokens";

export interface PrimaryButtonProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "ink" | "maal" | "cash" | "udhaar";
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function PrimaryButton({
  children,
  onPress,
  disabled = false,
  busy = false,
  tone = "ink",
  accessibilityLabel,
  style,
}: PrimaryButtonProps) {
  const bg =
    tone === "maal"
      ? colors.maal
      : tone === "cash"
        ? colors.cash
        : tone === "udhaar"
          ? colors.udhaar
          : colors.ink;
  const isDisabled = disabled || busy;

  return (
    <Pressable
      onPress={() => {
        if (isDisabled) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === "string" ? children : undefined)}
      accessibilityState={{ disabled: isDisabled, busy }}
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: bg },
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.surface} /> : null}
      {typeof children === "string" || typeof children === "number" ? (
        <Text numberOfLines={1} style={styles.primaryText}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

export interface SecondaryButtonProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function SecondaryButton({
  children,
  onPress,
  disabled = false,
  busy = false,
  accessibilityLabel,
  style,
}: SecondaryButtonProps) {
  const isDisabled = disabled || busy;
  return (
    <Pressable
      onPress={() => {
        if (isDisabled) return;
        void Haptics.selectionAsync();
        onPress?.();
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (typeof children === "string" ? children : undefined)}
      accessibilityState={{ disabled: isDisabled, busy }}
      style={({ pressed }) => [
        styles.secondary,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.ink} /> : null}
      {typeof children === "string" || typeof children === "number" ? (
        <Text numberOfLines={1} style={styles.secondaryText}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

export interface IconButtonProps {
  icon: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  tone?: "surface" | "sunken" | "dark";
  style?: ViewStyle;
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  disabled = false,
  tone = "sunken",
  style,
}: IconButtonProps) {
  const bg = tone === "dark" ? colors.ink : tone === "surface" ? colors.surface : colors.surfaceSunken;
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        void Haptics.selectionAsync();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.iconBtn,
        { backgroundColor: bg },
        tone === "surface" && styles.iconBorder,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.cta,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  primaryText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 16,
    color: colors.surface,
  },
  secondary: {
    minHeight: MIN_TARGET_DP,
    borderRadius: radii.cta,
    backgroundColor: colors.surfaceSunken,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  secondaryText: {
    fontFamily: fontFamilies.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  iconBtn: {
    width: MIN_TARGET_DP,
    height: MIN_TARGET_DP,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBorder: {
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  disabled: {
    opacity: 0.42,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.9,
  },
});
