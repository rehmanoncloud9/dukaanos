import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fontFamilies } from "@/core/theme/fonts";
import { colors, spacing, typography } from "@/core/theme/tokens";

export interface HeaderProps {
  title: string;
  onPressTitle?: () => void;
  onLongPressTitle?: () => void;
  titleAccessibilityLabel?: string;
  leftExtra?: ReactNode;
  right?: ReactNode;
}

export function Header({
  title,
  onPressTitle,
  onLongPressTitle,
  titleAccessibilityLabel,
  leftExtra,
  right,
}: HeaderProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.left}>
        {onPressTitle || onLongPressTitle ? (
          <Pressable
            onPress={onPressTitle}
            onLongPress={onLongPressTitle}
            delayLongPress={2000}
            accessibilityRole="button"
            accessibilityLabel={titleAccessibilityLabel ?? title}
            style={styles.titleTouch}
          >
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          </Pressable>
        ) : (
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        )}
        {leftExtra}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: colors.canvas,
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 0,
  },
  titleTouch: {
    minHeight: 48,
    justifyContent: "center",
    flexShrink: 1,
  },
  title: {
    fontFamily: fontFamilies.sansBold,
    fontSize: typography.tabTitle.fontSize,
    lineHeight: typography.tabTitle.lineHeight,
    letterSpacing: typography.tabTitle.letterSpacing,
    color: colors.ink,
    flexShrink: 1,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
});
